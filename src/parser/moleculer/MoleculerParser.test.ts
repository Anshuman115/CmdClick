import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { ReferenceKind, SymbolKind } from '../../types/types'
import { MoleculerParser } from './MoleculerParser'

const fixtures = path.resolve(process.cwd(), 'test/fixtures')

function parseFixture(name: string) {
  const parser = new MoleculerParser()
  const filePath = path.join(fixtures, name)
  return parser.parse(filePath, fs.readFileSync(filePath))
}

describe('MoleculerParser', () => {
  it('extracts symbols and references from service files using acorn AST', () => {
    const result = parseFixture('media.service.js')
    expect(result.symbols.map((item) => item.fullName)).toEqual([
      'v1.media.transcode',
      'v1.media.upload',
      'v1.media.calculateSize',
    ])
    expect(result.symbols.map((item) => item.kind)).toEqual([
      SymbolKind.Action,
      SymbolKind.Action,
      SymbolKind.Method,
    ])
    expect(result.references).toEqual(expect.arrayContaining([
      expect.objectContaining({ fullName: 'v1.authors.getProfile', kind: ReferenceKind.Call }),
      expect.objectContaining({ fullName: 'media.uploaded', kind: ReferenceKind.Emit }),
      expect.objectContaining({ fullName: '__self__.calculateSize', kind: ReferenceKind.Call }),
    ]))
  })

  it('extracts mixins and chained ctx call references', () => {
    const result = parseFixture('article.service.js')
    expect(result.unresolvedMixins).toEqual([{
      mixinName: 'RendererMixin',
      requirePath: './renderer.mixin.js',
      sourceFile: path.join(fixtures, 'article.service.js'),
    }])
    expect(result.references).toEqual(expect.arrayContaining([
      expect.objectContaining({ fullName: 'v1.media.transcode', kind: ReferenceKind.Call }),
      expect.objectContaining({ fullName: 'v1.media.upload', kind: ReferenceKind.Call }),
    ]))
    expect(result.references.filter((ref) => ref.fullName === 'v1.media.transcode')).toHaveLength(2)
  })

  it('does not crash on spread, computed properties, or optional chaining', () => {
    const parser = new MoleculerParser()
    const result = parser.parse('/tmp/notify.mixin.js', new TextEncoder().encode(`
      const extra = {}
      module.exports = {
        ...extra,
        ["computedAction"]: { handler(ctx) { return ctx?.params } },
        actions: {
          optionalCall: { handler(ctx) { return ctx?.call?.("v1.catalog.searchItems") } }
        }
      }
    `))
    const optionalCallSymbol = result.symbols.find((s) => s.name === 'optionalCall')
    expect(optionalCallSymbol).toBeDefined()
    expect(optionalCallSymbol?.namespace.startsWith('__mixin_')).toBe(true)
    expect(result.references).toEqual(expect.arrayContaining([
      expect.objectContaining({ fullName: 'v1.catalog.searchItems' }),
    ]))
  })
})
