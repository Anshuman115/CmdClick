import fs from 'node:fs'
import path from 'node:path'
import { Readable, Writable } from 'node:stream'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { Index } from '../index/Index'
import { MoleculerParser } from '../parser/moleculer/MoleculerParser'
import { Scanner } from '../scanner/Scanner'
import { Watcher } from '../scanner/Watcher'
import { detect, CursorKind } from './Cursor'
import { Handlers } from './Handlers'
import { Server } from './Server'
import { Transport } from './Transport'

const fixtures = path.resolve(process.cwd(), 'test/fixtures')

describe('Cursor', () => {
  it('detects call strings and excludes this.broker from method detection', () => {
    const content = new TextEncoder().encode('await this.broker.call("v1.media.transcode")\nreturn this.calculateSize(bytes)')
    expect(detect(content, 0, 39, 'v1.media').kind).toBe(CursorKind.ActionString)
    expect(detect(content, 0, 11, 'v1.media').kind).toBe(CursorKind.Unknown)
    expect(detect(content, 1, 13, 'v1.media')).toEqual({
      kind: CursorKind.MethodAccess,
      fullName: 'v1.media.calculateSize',
      targetKind: 'method',
    })
  })
})

describe('Transport', () => {
  it('reads and writes hand-rolled JSON-RPC messages', async () => {
    const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }))
    const readable = Readable.from([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body])
    const output = new CaptureWritable()
    const transport = new Transport(readable, output)
    await expect(transport.readMessage()).resolves.toEqual(body)

    transport.writeResponse(1, { ok: true })
    expect(decodeMessages(output.text())).toEqual([{ jsonrpc: '2.0', id: 1, result: { ok: true } }])
  })
})

describe('Watcher', () => {
  it('constructs and closes without an active watcher', () => {
    const index = new Index()
    const watcher = new Watcher(new Scanner([new MoleculerParser()], index), index)
    expect(() => watcher.close()).not.toThrow()
  })
})

describe('Handlers', () => {
  it('resolves definitions and references through the scanned index', () => {
    const { handlers, output } = createHandlers()
    const articlePath = path.join(fixtures, 'article.service.js')
    const content = fs.readFileSync(articlePath, 'utf8')
    const cursor = positionOf(content, 'v1.media.transcode')

    handlers.handleDefinition(1, {
      textDocument: { uri: pathToFileURL(articlePath).toString() },
      position: cursor,
    }, true)

    const [definition] = decodeMessages(output.text())
    const record = asRecord(definition)
    const result = asRecord(record.result)
    expect(result.uri).toBe(pathToFileURL(path.join(fixtures, 'media.service.js')).toString())
  })

  it('uses resolved mixin symbols when counting CodeLens references', () => {
    const { handlers, index, output } = createHandlers()
    const mixinPath = path.join(fixtures, 'renderer.mixin.js')
    const mixinId = index.stringPool().intern(mixinPath)
    const firstMixinSymbol = index.symbolsByFile(mixinId)[0]
    expect(firstMixinSymbol?.namespace).toBe('RendererMixin')
    if (firstMixinSymbol !== undefined) {
      index.addReference(firstMixinSymbol.fullName, { fileId: mixinId, line: 1, column: 1 })
    }

    handlers.handleCodeLens(2, { textDocument: { uri: pathToFileURL(mixinPath).toString() } })

    const [message] = decodeMessages(output.text())
    const result = asArray(asRecord(message).result)
    expect(result.length).toBeGreaterThan(0)
    expect(asRecord(asRecord(result[0]).command).title).toBe('1 usages')
  })
})

describe('Server', () => {
  it('advertises the expected LSP capabilities', () => {
    const output = new CaptureWritable()
    const server = new Server(Readable.from([]), output)
    server.dispatch({
      jsonrpc: '2.0',
      id: 9,
      method: 'initialize',
      params: { rootUri: pathToFileURL(fixtures).toString() },
    })
    const [message] = decodeMessages(output.text())
    const capabilities = asRecord(asRecord(asRecord(message).result).capabilities)
    expect(capabilities.definitionProvider).toBe(true)
    expect(capabilities.hoverProvider).toBe(false)

  })
})

function createHandlers(): { handlers: Handlers; index: Index; output: CaptureWritable } {
  const index = new Index()
  const scanner = new Scanner([new MoleculerParser()], index)
  scanner.scan(fixtures)
  const output = new CaptureWritable()
  const watcher = new Watcher(scanner, index)
  const handlers = new Handlers(index, scanner, new Transport(Readable.from([]), output), watcher)
  return { handlers, index, output }
}

class CaptureWritable extends Writable {
  private readonly chunks: Buffer[] = []

  override _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    callback()
  }

  text(): string {
    return Buffer.concat(this.chunks).toString('utf8')
  }
}

function decodeMessages(content: string): unknown[] {
  const messages: unknown[] = []
  let offset = 0
  while (offset < content.length) {
    const headerEnd = content.indexOf('\r\n\r\n', offset)
    if (headerEnd < 0) {
      break
    }
    const header = content.slice(offset, headerEnd)
    const length = contentLength(header)
    const bodyStart = headerEnd + 4
    const bodyEnd = bodyStart + length
    messages.push(JSON.parse(content.slice(bodyStart, bodyEnd)) as unknown)
    offset = bodyEnd
  }
  return messages
}

function contentLength(header: string): number {
  for (const line of header.split('\r\n')) {
    const [name, value] = line.split(':', 2)
    if (name === 'Content-Length' && value !== undefined) {
      return Number.parseInt(value.trim(), 10)
    }
  }
  throw new Error('missing Content-Length')
}

function positionOf(content: string, needle: string): { line: number; character: number } {
  const absolute = content.indexOf(needle)
  if (absolute < 0) {
    throw new Error(`missing fixture text: ${needle}`)
  }
  const before = content.slice(0, absolute)
  const lines = before.split('\n')
  return {
    line: lines.length - 1,
    character: (lines.at(-1) ?? '').length + 1,
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('expected object')
  }
  return value as Record<string, unknown>
}

function asArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error('expected array')
  }
  return value
}
