import { fileURLToPath } from 'node:url'
import type { Readable, Writable } from 'node:stream'
import { Index } from '../index/Index'
import { MoleculerParser } from '../parser/moleculer/MoleculerParser'
import { Scanner } from '../scanner/Scanner'
import { Watcher } from '../scanner/Watcher'
import { Handlers } from './Handlers'
import type {
  CodeLensParams,
  DidChangeTextDocumentParams,
  DidOpenTextDocumentParams,
  DidSaveTextDocumentParams,
  InitializeParams,
  InitializeResult,
  ReferenceParams,
  RequestMessage,
  TextDocumentPositionParams,
} from './Protocol'
import { ErrorCodes } from './Protocol'
import { Transport } from './Transport'

export class Server {
  private readonly index: Index
  private readonly scanner: Scanner
  private readonly watcher: Watcher
  private readonly transport: Transport
  private readonly handlers: Handlers
  private rootPath = process.cwd()
  private scanComplete = false
  private readonly pendingRequests: RequestMessage[] = []

  constructor(readable: Readable, writable: Writable) {
    this.index = new Index()
    this.scanner = new Scanner([new MoleculerParser()], this.index)
    this.watcher = new Watcher(this.scanner, this.index)
    this.transport = new Transport(readable, writable)
    this.handlers = new Handlers(this.index, this.scanner, this.transport, this.watcher)
  }

  async run(): Promise<void> {
    while (true) {
      const body = await this.transport.readMessage()
      if (body === undefined) {
        return
      }
      let message: RequestMessage
      try {
        message = JSON.parse(body.toString('utf8')) as RequestMessage
      } catch {
        this.transport.writeResponse(null, null, { code: ErrorCodes.Parse, message: 'invalid JSON-RPC message' })
        continue
      }
      this.dispatch(message)
    }
  }

  dispatch(message: RequestMessage): void {
    switch (message.method) {
      case 'initialize':
        this.handleInitialize(message.id, asInitializeParams(message.params))
        return
      case 'initialized':
        this.handleInitialized()
        return
      case 'shutdown':
        this.transport.writeResponse(message.id, null)
        return
      case 'exit':
        this.watcher.close()
        process.exit(0)
      case 'textDocument/didOpen':
        this.handlers.handleDidOpen(asDidOpenParams(message.params))
        return
      case 'textDocument/didChange':
        this.handlers.handleDidChange(asDidChangeParams(message.params))
        return
      case 'textDocument/didSave':
        this.handlers.handleDidSave(asDidSaveParams(message.params))
        return
      case 'textDocument/didClose': {
        const record = isRecord(message.params) && isRecord((message.params as Record<string, unknown>).textDocument)
          ? (message.params as Record<string, unknown>)
          : {}
        const tdClose = isRecord(record.textDocument) ? record.textDocument : {}
        const closeUri = typeof tdClose.uri === 'string' ? tdClose.uri : ''
        if (closeUri.length > 0) this.handlers.handleDidClose(closeUri)
        return
      }
      case 'textDocument/definition':
      case 'textDocument/references':
        if (!this.scanComplete) {
          this.pendingRequests.push(message)
        } else {
          if (message.method === 'textDocument/definition') {
            this.handlers.handleDefinition(message.id, asTextDocumentPositionParams(message.params), true)
          } else {
            this.handlers.handleReferences(message.id, asReferenceParams(message.params), true)
          }
        }
        return
      case 'textDocument/codeLens':
        this.handlers.handleCodeLens(message.id, asCodeLensParams(message.params), this.scanComplete)
        return

      case 'textDocument/hover':
        this.transport.writeResponse(message.id, null)
        return
      default:
        if (message.id !== undefined) {
          this.transport.writeResponse(message.id, null, { code: ErrorCodes.MethodNotFound, message: `method not found: ${message.method}` })
        }
    }
  }

  handleInitialize(id: unknown, params: InitializeParams): void {
    if (params.rootUri !== undefined && params.rootUri.length > 0) {
      this.rootPath = fileURLToPath(params.rootUri)
    }
    const result: InitializeResult = {
      capabilities: {
        textDocumentSync: 1,
        definitionProvider: true,
        referencesProvider: true,
        hoverProvider: false,
        codeLensProvider: { resolveProvider: false },
      },
    }
    this.transport.writeResponse(id, result)
  }

  handleInitialized(): void {
    setTimeout(() => {
      try {
        process.stderr.write(`[CmdClick] Starting index scan: ${this.rootPath}\n`)
        const startMs = Date.now()
        this.scanner.scan(this.rootPath)
        const scanMs = Date.now() - startMs
        this.watcher.watch(this.rootPath)
        this.scanComplete = true
        for (const pending of this.pendingRequests.splice(0)) {
          this.dispatch(pending)
        }
        const stats = this.index.stats()
        let eventCount = 0
        for (const s of this.index.getAllSymbols()) {
          if (s.kind === 'event') eventCount++
        }
        process.stderr.write(`[CmdClick] Scan complete in ${scanMs}ms\n`)
        process.stderr.write(`[CmdClick]   Files:      ${stats.fileCount}\n`)
        process.stderr.write(`[CmdClick]   Symbols:    ${stats.symbolCount}\n`)
        process.stderr.write(`[CmdClick]   References: ${stats.referenceCount}\n`)
        process.stderr.write(`[CmdClick]   Events:     ${eventCount}\n`)
        process.stderr.write(`[CmdClick] File watcher active\n`)
        this.transport.writeNotification('cmdclick/indexReady', {
          symbolCount: stats.symbolCount,
          fileCount: stats.fileCount,
          refCount: stats.referenceCount,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        process.stderr.write(`[CmdClick] scan error: ${message}\n`)
      }
    }, 0)
  }
}

function asInitializeParams(value: unknown): InitializeParams {
  return isRecord(value) && typeof value.rootUri === 'string' ? { rootUri: value.rootUri } : {}
}

function asTextDocumentPositionParams(value: unknown): TextDocumentPositionParams {
  const record = requireRecord(value, 'text document position params')
  const textDocument = requireRecord(record.textDocument, 'textDocument')
  const position = requireRecord(record.position, 'position')
  return {
    textDocument: { uri: requireString(textDocument.uri, 'uri') },
    position: {
      line: requireNumber(position.line, 'line'),
      character: requireNumber(position.character, 'character'),
    },
  }
}

function asReferenceParams(value: unknown): ReferenceParams {
  return asTextDocumentPositionParams(value)
}

function asCodeLensParams(value: unknown): CodeLensParams {
  const record = requireRecord(value, 'code lens params')
  const textDocument = requireRecord(record.textDocument, 'textDocument')
  return { textDocument: { uri: requireString(textDocument.uri, 'uri') } }
}

function asDidOpenParams(value: unknown): DidOpenTextDocumentParams {
  const record = requireRecord(value, 'didOpen params')
  const textDocument = requireRecord(record.textDocument, 'textDocument')
  return {
    textDocument: {
      uri: requireString(textDocument.uri, 'uri'),
      text: requireString(textDocument.text, 'text'),
    },
  }
}

function asDidChangeParams(value: unknown): DidChangeTextDocumentParams {
  const record = requireRecord(value, 'didChange params')
  const textDocument = requireRecord(record.textDocument, 'textDocument')
  const changes = Array.isArray(record.contentChanges) ? record.contentChanges : []
  return {
    textDocument: {
      uri: requireString(textDocument.uri, 'uri'),
      version: typeof textDocument.version === 'number' ? textDocument.version : 0,
    },
    contentChanges: changes.flatMap((change) => isRecord(change) && typeof change.text === 'string' ? [{ text: change.text }] : []),
  }
}

function asDidSaveParams(value: unknown): DidSaveTextDocumentParams {
  const record = requireRecord(value, 'didSave params')
  const textDocument = requireRecord(record.textDocument, 'textDocument')
  return { textDocument: { uri: requireString(textDocument.uri, 'uri') } }
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`invalid ${label}`)
  }
  return value
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new Error(`invalid ${label}`)
  }
  return value
}

function requireNumber(value: unknown, label: string): number {
  if (typeof value !== 'number') {
    throw new Error(`invalid ${label}`)
  }
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
