import { describe, expect, it } from 'vitest'
import { Index } from './Index'
import { InvertedIndex } from './InvertedIndex'
import { StringPool } from './StringPool'
import { SymbolKind, type Symbol } from '../types/types'

function symbol(fullName: string, fileId: number): Symbol {
  return {
    id: 0,
    name: fullName.split('.').at(-1) ?? fullName,
    fullName,
    namespace: 'v1.test',
    kind: SymbolKind.Action,
    fileId,
    sourceFileId: fileId,
    line: 1,
    column: 2,
    sourceLang: 'moleculerjs',
  }
}

describe('Index', () => {
  it('deduplicates strings in StringPool', () => {
    const pool = new StringPool()
    const first = pool.intern('/tmp/media.service.js')
    const second = pool.intern('/tmp/media.service.js')
    expect(first).toBe(second)
    expect(pool.get(first)).toBe('/tmp/media.service.js')
    expect(pool.len()).toBe(1)
  })

  it('stores and removes locations in InvertedIndex', () => {
    const refs = new InvertedIndex()
    refs.add(7, { fileId: 1, line: 2, column: 3 })
    refs.add(7, { fileId: 1, line: 4, column: 5 })
    expect(refs.count(7)).toBe(2)
    refs.delete(7, { fileId: 1, line: 2, column: 3 })
    expect(refs.lookup(7)).toEqual([{ fileId: 1, line: 4, column: 5 }])
    refs.deleteAll(7)
    expect(refs.lookup(7)).toEqual([])
  })

  it('inserts, looks up, searches prefixes, and deletes by file', () => {
    const index = new Index()
    expect(index.insert(symbol('v1.media.transcode', 1))).toBeUndefined()
    expect(index.insert(symbol('v1.media.upload', 1))).toBeUndefined()
    expect(index.insert(symbol('v1.authors.getProfile', 2))).toBeUndefined()

    expect(index.lookup('v1.media.transcode')?.line).toBe(1)
    expect(index.prefixSearch('v1.media')).toHaveLength(2)
    expect(index.symbolsByFile(1)).toHaveLength(2)

    index.deleteByFile(1)
    expect(index.lookup('v1.media.transcode')).toBeUndefined()
    expect(index.lookup('v1.authors.getProfile')).toBeDefined()
  })

  it('tracks references by symbol id', () => {
    const index = new Index()
    index.insert(symbol('v1.authors.getProfile', 1))
    expect(index.addReference('v1.authors.getProfile', { fileId: 2, line: 4, column: 12 })).toBeUndefined()
    expect(index.findReferences('v1.authors.getProfile')).toEqual([{ fileId: 2, line: 4, column: 12 }])
    expect(index.stats()).toEqual({ symbolCount: 1, fileCount: 1, referenceCount: 1 })
  })
})
