import type { ParseResult } from '../types/types'

export interface Parser {
  parse(filePath: string, content: Uint8Array): ParseResult
  filePatterns(): string[]
  language(): string
  namespace(filePath: string, content: Uint8Array): string
}
