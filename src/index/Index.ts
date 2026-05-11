import { TrieMap } from 'mnemonist'
import { InvertedIndex } from './InvertedIndex'
import { StringPool } from './StringPool'
import type { IndexStats, Location, Symbol } from '../types/types'

export class Index {
  private readonly pool = new StringPool()
  private readonly symbols = new Map<string, Symbol>()
  private readonly byFile = new Map<number, string[]>()
  private readonly radix = new TrieMap<string, Symbol>()
  private readonly refs = new InvertedIndex()

  stringPool(): StringPool {
    return this.pool
  }

  insert(symbol: Symbol): Error | undefined {
    if (symbol.fullName.length === 0) {
      return new Error('symbol fullName cannot be empty')
    }
    if (this.symbols.has(symbol.fullName)) {
      return new Error(`symbol already exists: ${symbol.fullName}`)
    }

    const id = this.pool.intern(symbol.fullName)
    symbol.id = id
    this.symbols.set(symbol.fullName, symbol)
    this.byFile.set(symbol.fileId, [...(this.byFile.get(symbol.fileId) ?? []), symbol.fullName])
    this.radix.set(symbol.fullName, symbol)
    return undefined
  }

  delete(fullName: string): void {
    const symbol = this.symbols.get(fullName)
    if (symbol === undefined) {
      return
    }

    this.symbols.delete(fullName)
    this.radix.delete(fullName)
    this.refs.deleteAll(symbol.id)

    const names = this.byFile.get(symbol.fileId) ?? []
    const next = names.filter((name) => name !== fullName)
    if (next.length === 0) {
      this.byFile.delete(symbol.fileId)
      return
    }
    this.byFile.set(symbol.fileId, next)
  }

  deleteByFile(fileId: number): void {
    const names = this.byFile.get(fileId) ?? []
    for (const fullName of names) {
      const symbol = this.symbols.get(fullName)
      if (symbol !== undefined) {
        this.refs.deleteAll(symbol.id)
      }
      this.symbols.delete(fullName)
      this.radix.delete(fullName)
    }
    this.byFile.delete(fileId)
    // Also remove references FROM this file (stored under other symbols)
    this.refs.deleteByFileId(fileId)
  }

  lookup(fullName: string): Symbol | undefined {
    return this.symbols.get(fullName)
  }

  prefixSearch(prefix: string): Symbol[] {
    return this.radix.find(prefix).map((entry) => entry[1])
  }

  addReference(fullName: string, location: Location): Error | undefined {
    const symbol = this.symbols.get(fullName)
    if (symbol === undefined) {
      return new Error(`cannot add reference: symbol ${fullName} not found`)
    }
    this.refs.add(symbol.id, location)
    return undefined
  }

  findReferences(fullName: string): Location[] {
    const symbol = this.symbols.get(fullName)
    return symbol === undefined ? [] : this.refs.lookup(symbol.id)
  }

  symbolsByFile(fileId: number): Symbol[] {
    const names = this.byFile.get(fileId) ?? []
    return names.flatMap((name) => {
      const symbol = this.symbols.get(name)
      return symbol === undefined ? [] : [symbol]
    })
  }

  stats(): IndexStats {
    let referenceCount = 0
    for (const symbol of this.symbols.values()) {
      referenceCount += this.refs.count(symbol.id)
    }
    return {
      symbolCount: this.symbols.size,
      fileCount: this.byFile.size,
      referenceCount,
    }
  }

  allFileIds(): IterableIterator<number> {
    return this.byFile.keys()
  }
}
