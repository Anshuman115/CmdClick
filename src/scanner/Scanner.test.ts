import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { Index } from '../index/Index'
import { MoleculerParser } from '../parser/moleculer/MoleculerParser'
import { Scanner } from './Scanner'

const fixtures = path.resolve(process.cwd(), 'test/fixtures')

describe('Scanner', () => {
  it('indexes fixtures, resolves mixins, and inserts references', () => {
    const index = new Index()
    const scanner = new Scanner([new MoleculerParser()], index)
    scanner.scan(fixtures)

    expect(index.lookup('v1.media.transcode')).toBeDefined()
    expect(index.lookup('v1.articles.convertMarkdown')).toBeDefined()
    expect(index.lookup('v1.articles.stripHtml')).toBeDefined()
    expect(index.findReferences('v1.authors.getProfile')).toHaveLength(2)
    expect(index.findReferences('v1.media.transcode')).toHaveLength(2)
    expect(index.stats().symbolCount).toBeGreaterThanOrEqual(11)
  })

  it('keeps service-namespace mixin symbols when the mixin file is deleted by file id', () => {
    const index = new Index()
    const scanner = new Scanner([new MoleculerParser()], index)
    scanner.scan(fixtures)

    const mixinPath = path.join(fixtures, 'renderer.mixin.js')
    const servicePath = path.join(fixtures, 'article.service.js')
    const mixinFileId = index.stringPool().intern(mixinPath)
    const serviceFileId = index.stringPool().intern(servicePath)
    const resolved = index.lookup('v1.articles.convertMarkdown')

    expect(resolved?.fileId).toBe(serviceFileId)
    expect(resolved?.sourceFileId).toBe(mixinFileId)

    index.deleteByFile(mixinFileId)
    expect(index.lookup('RendererMixin.convertMarkdown')).toBeUndefined()
    expect(index.lookup('v1.articles.convertMarkdown')).toBeDefined()
  })
})
