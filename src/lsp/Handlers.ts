import fs from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Index } from '../index/Index'
import { Scanner } from '../scanner/Scanner'
import { Watcher } from '../scanner/Watcher'
import { SymbolKind, type Location as IndexLocation, type Symbol } from '../types/types'
import { CursorKind, detect } from './Cursor'
import type {
  CodeLens,
  CodeLensParams,
  DidChangeTextDocumentParams,
  DidOpenTextDocumentParams,
  DidSaveTextDocumentParams,
  Location,
  Position,
  ReferenceParams,
  TextDocumentPositionParams,
} from './Protocol'
import { Transport } from './Transport'

export class Handlers {
  private readonly documents = new Map<string, Uint8Array>()

  constructor(
    private readonly index: Index,
    private readonly scanner: Scanner,
    private readonly transport: Transport,
    private readonly watcher: Watcher,
  ) {}

  handleDidOpen(params: DidOpenTextDocumentParams): void {
    this.documents.set(params.textDocument.uri, new TextEncoder().encode(params.textDocument.text))
  }

  handleDidChange(params: DidChangeTextDocumentParams): void {
    const latest = params.contentChanges.at(-1)
    if (latest !== undefined) {
      this.documents.set(params.textDocument.uri, new TextEncoder().encode(latest.text))
    }
  }

  handleDidClose(uri: string): void {
    // Remove cached content when VS Code closes a file to prevent unbounded memory growth
    this.documents.delete(uri)
  }

  handleDidSave(params: DidSaveTextDocumentParams): void {
    const filePath = uriToPath(params.textDocument.uri)
    try {
      this.scanner.parseFile(filePath)
      this.watcher.suppressFile(filePath, 300)
      this.documents.delete(params.textDocument.uri)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      process.stderr.write(`[CmdClick] parse error: ${message}\n`)
    }
  }

  handleDefinition(id: unknown, params: TextDocumentPositionParams, scanComplete: boolean): void {
    if (!scanComplete) {
      this.transport.writeResponse(id, null)
      return
    }

    const resolved = this.resolveSymbolAt(params)
    if (resolved === undefined) {
      this.transport.writeResponse(id, null)
      return
    }

    if (resolved.kind === CursorKind.ServiceName) {
      this.transport.writeResponse(id, this.findServiceFile(resolved.fullName))
      return
    }

    if (resolved.kind === CursorKind.DefinitionSite) {
      const refs = this.findAllReferencesForSymbol(resolved.symbol)
      if (refs.length === 0) {
        this.transport.writeNotification('cmdclick/noReferences', {
          symbolName: resolved.symbol.name,
        })
      }
      this.transport.writeResponse(id, null)
      return
    }

    this.transport.writeResponse(id, this.symbolLocation(resolved.symbol))
  }

  handleReferences(id: unknown, params: ReferenceParams, scanComplete: boolean): void {
    if (!scanComplete) {
      this.transport.writeResponse(id, [])
      return
    }
    const resolved = this.resolveSymbolAt(params)
    if (resolved === undefined || resolved.kind === CursorKind.ServiceName) {
      this.transport.writeResponse(id, [])
      return
    }
    this.transport.writeResponse(
      id,
      this.findAllReferencesForSymbol(resolved.symbol).map((location) => this.toLspLocation(location)),
    )
  }

  handleCodeLens(id: unknown, params: CodeLensParams, scanComplete: boolean): void {
    if (!scanComplete) {
      this.transport.writeResponse(id, [])
      return
    }
    const filePath = uriToPath(params.textDocument.uri)
    const fileId = this.index.stringPool().intern(filePath)
    const lenses: CodeLens[] = []

    // Build a name→symbols lookup once for this call to avoid O(N²) scan
    const nameToSymbols = this.buildNameIndex()

    for (const symbol of this.index.symbolsByFile(fileId)) {
      if (symbol.sourceFileId !== 0 && symbol.sourceFileId !== symbol.fileId) {
        continue
      }
      const refs = this.findAllReferencesForSymbolFast(symbol, nameToSymbols)
        .map((location) => this.toLspLocation(location))
      if (refs.length === 0) {
        continue
      }
      const position = { line: symbol.line, character: symbol.column }
      lenses.push({
        range: {
          start: position,
          end: { line: symbol.line, character: symbol.column + symbol.name.length },
        },
        command: {
          title: `${refs.length} usages`,
          command: 'cmdclick.showReferences',
          arguments: [params.textDocument.uri, position, refs],
        },
      })
    }

    this.transport.writeResponse(id, lenses)
  }

  findAllReferencesForSymbol(symbol: Symbol): IndexLocation[] {
    return this.findAllReferencesForSymbolFast(symbol, this.buildNameIndex())
  }

  private buildNameIndex(): Map<string, Symbol[]> {
    const nameToSymbols = new Map<string, Symbol[]>()
    for (const candidate of this.index.getAllSymbols()) {
      const list = nameToSymbols.get(candidate.name) ?? []
      list.push(candidate)
      nameToSymbols.set(candidate.name, list)
    }
    return nameToSymbols
  }

  private findAllReferencesForSymbolFast(symbol: Symbol, nameToSymbols: Map<string, Symbol[]>): IndexLocation[] {
    const locations = [...this.index.findReferences(symbol.fullName)]
    for (const candidate of nameToSymbols.get(symbol.name) ?? []) {
      if (candidate.fullName !== symbol.fullName) {
        locations.push(...this.index.findReferences(candidate.fullName))
      }
    }
    return dedupeLocations(locations)
  }

  findBestSymbolByName(methodName: string): Symbol | undefined {
    let best: Symbol | undefined
    for (const candidate of this.index.getAllSymbols()) {
      if (candidate.name !== methodName) {
        continue
      }
      if (best === undefined) {
        best = candidate
      }
      if (!candidate.namespace.startsWith('__mixin_')) {
        return candidate
      }
    }
    return best
  }

  private findClassSymbolByName(methodName: string): Symbol | undefined {
    const pool = this.index.stringPool()
    for (const candidate of this.index.getAllSymbols()) {
      if (candidate.name !== methodName) continue
      const filePath = pool.get(candidate.sourceFileId || candidate.fileId)
      if (!filePath.endsWith('.service.js') && !filePath.endsWith('.mixin.js') && !filePath.endsWith('.mixins.js')) {
        return candidate
      }
    }
    return undefined
  }


  private findEventByRawString(rawString: string): Symbol | undefined {
    for (const candidate of this.index.getAllSymbols()) {
      if (candidate.kind === SymbolKind.Event && candidate.name === rawString) {
        return candidate
      }
    }
    return undefined
  }

  private resolveSymbolAt(params: TextDocumentPositionParams): ResolvedSymbol | undefined {
    const filePath = uriToPath(params.textDocument.uri)
    const content = this.contentFor(params.textDocument.uri, filePath)
    if (content === undefined) {
      return undefined
    }
    const namespace = this.getServiceNamespace(filePath)
    const context = detect(content, params.position.line, params.position.character, namespace)
    if (context.kind === CursorKind.Unknown) {
      return undefined
    }
    // Event strings contain dots (e.g. "feed.syncContent") that look like service.action.
    // Try matching the full raw string as an event name before splitting by segment.
    if (context.rawString !== undefined) {
      const eventSymbol = this.findEventByRawString(context.rawString)
      if (eventSymbol !== undefined) {
        return { kind: context.kind, fullName: eventSymbol.fullName, symbol: eventSymbol }
      }
    }
    if (context.kind === CursorKind.ServiceName) {
      return {
        kind: context.kind,
        fullName: context.fullName,
        symbol: emptyServiceSymbol(context.fullName),
      }
    }
    const name = shortName(context.fullName)
    let symbol: Symbol | undefined
    if (context.isChained) {
      // Chained calls (this.obj.method) — prefer class-based definitions over mixin re-registrations
      symbol = this.findClassSymbolByName(name) ?? this.findBestSymbolByName(name)
    } else {
      symbol = this.index.lookup(context.fullName) ?? this.findBestSymbolByName(name)
    }
    return symbol === undefined ? undefined : {
      kind: context.kind,
      fullName: context.fullName,
      symbol,
    }
  }

  private contentFor(uri: string, filePath: string): Uint8Array | undefined {
    const cached = this.documents.get(uri)
    if (cached !== undefined) {
      return cached
    }
    try {
      return fs.readFileSync(filePath)
    } catch {
      return undefined
    }
  }

  private getServiceNamespace(filePath: string): string {
    const fileId = this.index.stringPool().intern(filePath)
    const symbols = this.index.symbolsByFile(fileId)
    if (symbols.length > 0) {
      return symbols[0]?.namespace ?? ''
    }
    return this.scanner.findNamespaceForFile(filePath)
  }

  private findServiceFile(fullName: string): Location | null {
    const namespace = serviceNamespaceFromFullName(fullName)
    if (namespace.length === 0) {
      return null
    }
    // Try exact namespace match first
    for (const symbol of this.index.getAllSymbols()) {
      if (symbol.namespace === namespace) {
        return {
          uri: pathToUri(this.index.stringPool().get(symbol.fileId)),
          range: zeroRange(),
        }
      }
    }
    // Fallback: search for a .service.js file whose name contains the service name
    const serviceName = extractServiceName(namespace)
    if (serviceName.length > 0) {
      const pool = this.index.stringPool()
      for (const fileId of this.index.allFileIds()) {
        const filePath = pool.get(fileId)
        if (filePath.endsWith('.service.js') && filePath.toLowerCase().includes(serviceName.toLowerCase())) {
          return { uri: pathToUri(filePath), range: zeroRange() }
        }
      }
    }
    return null
  }

  private symbolLocation(symbol: Symbol): Location {
    const sourceFileId = symbol.sourceFileId === 0 ? symbol.fileId : symbol.sourceFileId
    const line = symbol.line
    const start = { line, character: symbol.column }
    return {
      uri: pathToUri(this.index.stringPool().get(sourceFileId)),
      range: {
        start,
        end: { line, character: symbol.column + symbol.name.length },
      },
    }
  }

  private toLspLocation(location: IndexLocation): Location {
    const start = { line: location.line, character: location.column }
    return {
      uri: pathToUri(this.index.stringPool().get(location.fileId)),
      range: {
        start,
        end: start,
      },
    }
  }
}

interface ResolvedSymbol {
  kind: CursorKind
  fullName: string
  symbol: Symbol
}

function uriToPath(uri: string): string {
  return fileURLToPath(uri)
}

function pathToUri(filePath: string): string {
  return pathToFileURL(filePath).toString()
}

function shortName(fullName: string): string {
  const dot = fullName.lastIndexOf('.')
  return dot < 0 ? fullName : fullName.slice(dot + 1)
}

function serviceNamespaceFromFullName(fullName: string): string {
  const parts = fullName.split('.')
  if (parts.length < 2) {
    return ''
  }
  return parts.slice(0, -1).join('.')
}

function extractServiceName(namespace: string): string {
  const parts = namespace.split('.')
  const first = parts[0] ?? ''
  // Skip version prefix (v1, v2, etc.)
  if (first.length >= 2 && first[0] === 'v' && first.charCodeAt(1) >= 48 && first.charCodeAt(1) <= 57) {
    return parts.slice(1).join('.')
  }
  return namespace
}

function zeroRange(): { start: Position; end: Position } {
  return {
    start: { line: 0, character: 0 },
    end: { line: 0, character: 0 },
  }
}

function dedupeLocations(locations: IndexLocation[]): IndexLocation[] {
  const seen = new Set<string>()
  const result: IndexLocation[] = []
  for (const location of locations) {
    const key = `${location.fileId}:${location.line}:${location.column}`
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    result.push(location)
  }
  return result
}

function emptyServiceSymbol(fullName: string): Symbol {
  return {
    id: 0,
    name: shortName(fullName),
    fullName,
    namespace: '',
    kind: SymbolKind.Action,
    fileId: 0,
    sourceFileId: 0,
    line: 0,
    column: 0,
    sourceLang: 'moleculerjs',
  }
}
