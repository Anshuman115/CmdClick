import type { Readable, Writable } from 'node:stream'
import type { RPCError } from './Protocol'

export class Transport {
  private buffer = Buffer.alloc(0)
  private readonly iterator: AsyncIterator<Buffer>

  constructor(
    readable: Readable,
    private readonly writable: Writable,
  ) {
    this.iterator = readable[Symbol.asyncIterator]() as AsyncIterator<Buffer>
  }

  async readMessage(): Promise<Buffer | undefined> {
    while (true) {
      const parsed = this.tryReadMessage()
      if (parsed !== undefined) {
        return parsed
      }
      const next = await this.iterator.next()
      if (next.done === true) {
        return undefined
      }
      this.buffer = Buffer.concat([this.buffer, next.value])
    }
  }

  writeResponse(id: unknown, result: unknown, error?: RPCError): void {
    if (error !== undefined) {
      this.writeMessage(Buffer.from(JSON.stringify({ jsonrpc: '2.0', id, error })))
      return
    }
    this.writeMessage(Buffer.from(JSON.stringify({ jsonrpc: '2.0', id, result })))
  }

  writeNotification(method: string, params: unknown): void {
    this.writeMessage(Buffer.from(JSON.stringify({ jsonrpc: '2.0', method, params })))
  }

  writeMessage(body: Buffer): void {
    this.writable.write(`Content-Length: ${body.length}\r\n\r\n`)
    this.writable.write(body)
  }

  private tryReadMessage(): Buffer | undefined {
    const headerEnd = this.buffer.indexOf('\r\n\r\n')
    if (headerEnd < 0) {
      return undefined
    }
    const header = this.buffer.subarray(0, headerEnd).toString('utf8')
    const contentLength = parseContentLength(header)
    const bodyStart = headerEnd + 4
    const bodyEnd = bodyStart + contentLength
    if (this.buffer.length < bodyEnd) {
      return undefined
    }
    const body = this.buffer.subarray(bodyStart, bodyEnd)
    this.buffer = this.buffer.subarray(bodyEnd)
    return body
  }
}

function parseContentLength(header: string): number {
  for (const line of header.split('\r\n')) {
    const [name, rawValue] = line.split(':', 2)
    if (name?.toLowerCase() === 'content-length' && rawValue !== undefined) {
      return Number.parseInt(rawValue.trim(), 10)
    }
  }
  throw new Error('missing Content-Length header')
}
