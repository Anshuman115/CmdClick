import fs from 'node:fs'
import path from 'node:path'
import { Index } from '../index/Index'
import type { Parser } from '../parser/Parser'
import { ReferenceKind, SymbolKind, type ParseResult, type Reference, type UnresolvedMixin } from '../types/types'

interface PendingReference {
  fullName: string
  kind: ReferenceKind
  fileId: number
  line: number
  column: number
}

export class Scanner {
  constructor(
    private readonly parsers: Parser[],
    private readonly index: Index,
  ) {}

  scan(rootPath: string): void {
    const files = this.collectFiles(rootPath)
    const mixins: UnresolvedMixin[] = []
    const refs: PendingReference[] = []

    for (const filePath of files) {
      const { result, references } = this.parseFileSymbolsOnly(filePath)
      mixins.push(...result.unresolvedMixins)
      refs.push(...references)
    }

    this.resolveMixins(mixins)

    for (const ref of refs) {
      const fullName = this.resolveReferenceName(ref)
      this.index.addReference(fullName, { fileId: ref.fileId, line: ref.line, column: ref.column })
    }
  }

  parseFile(filePath: string): ParseResult {
    const parser = this.findParser(filePath)
    if (parser === undefined) {
      throw new Error(`no parser for ${filePath}`)
    }
    const content = fs.readFileSync(filePath)
    const result = parser.parse(filePath, content)
    const fileId = this.index.stringPool().intern(filePath)
    this.index.deleteByFile(fileId)
    for (const symbol of result.symbols) {
      symbol.fileId = fileId
      symbol.sourceFileId = fileId
      this.index.insert(symbol)
    }
    // Re-run mixin resolution so cross-mixin __self__ refs resolve correctly
    this.resolveMixins(result.unresolvedMixins)
    for (const ref of result.references) {
      ref.location.fileId = fileId
      const pending: PendingReference = {
        fullName: ref.fullName,
        kind: ref.kind,
        fileId,
        line: ref.location.line,
        column: ref.location.column,
      }
      const resolvedName = this.resolveReferenceName(pending)
      this.index.addReference(resolvedName, ref.location)
    }
    return result
  }

  findNamespaceForFile(filePath: string): string {
    const fileId = this.index.stringPool().intern(filePath)
    const symbols = this.index.symbolsByFile(fileId)
    if (symbols.length > 0) {
      return symbols[0]?.namespace ?? ''
    }
    const parser = this.findParser(filePath)
    if (parser === undefined) {
      return ''
    }
    try {
      return parser.namespace(filePath, fs.readFileSync(filePath))
    } catch {
      return ''
    }
  }

  private parseFileSymbolsOnly(filePath: string): { result: ParseResult; references: PendingReference[] } {
    const parser = this.findParser(filePath)
    if (parser === undefined) {
      throw new Error(`no parser for ${filePath}`)
    }
    try {
      const result = parser.parse(filePath, fs.readFileSync(filePath))
      const fileId = this.index.stringPool().intern(filePath)
      for (const symbol of result.symbols) {
        symbol.fileId = fileId
        symbol.sourceFileId = fileId
        this.index.insert(symbol)
      }
      return {
        result,
        references: result.references.map((ref) => ({
          fullName: ref.fullName,
          kind: ref.kind,
          fileId,
          line: ref.location.line,
          column: ref.location.column,
        })),
      }
    } catch {
      return { result: { symbols: [], references: [], unresolvedMixins: [], errors: [] }, references: [] }
    }
  }

  private resolveMixins(mixins: UnresolvedMixin[]): void {
    for (const mixin of mixins) {
      const mixinFilePath = resolveRequirePath(mixin.sourceFile, mixin.requirePath)
      if (mixinFilePath.length === 0) {
        continue
      }
      const sourceNamespace = this.findNamespaceForFile(mixin.sourceFile)
      if (sourceNamespace.length === 0) {
        continue
      }
      const sourceFileId = this.index.stringPool().intern(mixin.sourceFile)
      const mixinFileId = this.index.stringPool().intern(mixinFilePath)
      for (const symbol of this.index.symbolsByFile(mixinFileId)) {
        const fullName = `${sourceNamespace}.${symbol.name}`
        if (this.index.lookup(fullName) !== undefined) {
          continue
        }
        this.index.insert({
          ...symbol,
          id: 0,
          fullName,
          namespace: sourceNamespace,
          fileId: sourceFileId,
          sourceFileId: symbol.sourceFileId,
        })
      }
    }
  }

  private resolveReferenceName(ref: PendingReference): string {
    if (ref.fullName.startsWith('__self__.')) {
      const methodName = ref.fullName.slice('__self__.'.length)
      const filePath = this.index.stringPool().get(ref.fileId)
      const namespace = filePath.length > 0 ? this.findNamespaceForFile(filePath) : ''
      return namespace.length === 0 ? ref.fullName : `${namespace}.${methodName}`
    }
    // Event references: find the event symbol by name since events are stored as namespace.eventName
    if (ref.kind === ReferenceKind.Emit || ref.kind === ReferenceKind.Broadcast) {
      for (const symbol of this.index.prefixSearch('')) {
        if (symbol.kind === SymbolKind.Event && symbol.name === ref.fullName) {
          return symbol.fullName
        }
      }
    }
    return ref.fullName
  }

  private collectFiles(rootPath: string): string[] {
    const results: string[] = []
    const skipDirs = new Set(['node_modules', '.git', '.vscode', 'dist', 'build', 'coverage'])
    const visit = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          if (!skipDirs.has(entry.name)) {
            visit(fullPath)
          }
          continue
        }
        if (this.matchesParser(fullPath)) {
          results.push(fullPath)
        }
      }
    }
    visit(rootPath)
    return results
  }

  private matchesParser(filePath: string): boolean {
    return this.findParser(filePath) !== undefined
  }

  private findParser(filePath: string): Parser | undefined {
    return this.parsers.find((parser) => parser.filePatterns().some((suffix) => filePath.endsWith(suffix)))
  }
}

function resolveRequirePath(sourceFile: string, requirePath: string): string {
  if (requirePath.length === 0) {
    return ''
  }
  const resolved = path.resolve(path.dirname(sourceFile), requirePath)
  if (fs.existsSync(resolved)) {
    return resolved
  }
  const withJs = resolved.endsWith('.js') ? resolved : `${resolved}.js`
  return fs.existsSync(withJs) ? withJs : ''
}
