import type { Location } from '../types/types'

export class InvertedIndex {
  private readonly refs = new Map<number, Location[]>()

  add(symbolId: number, location: Location): void {
    const existing = this.refs.get(symbolId) ?? []
    existing.push(location)
    this.refs.set(symbolId, existing)
  }

  delete(symbolId: number, location: Location): void {
    const existing = this.refs.get(symbolId)
    if (existing === undefined) {
      return
    }
    const next = existing.filter((item) => {
      return item.fileId !== location.fileId || item.line !== location.line || item.column !== location.column
    })
    if (next.length === 0) {
      this.refs.delete(symbolId)
      return
    }
    this.refs.set(symbolId, next)
  }

  deleteAll(symbolId: number): void {
    this.refs.delete(symbolId)
  }

  lookup(symbolId: number): Location[] {
    const existing = this.refs.get(symbolId)
    return existing === undefined ? [] : existing.map((item) => ({ ...item }))
  }

  count(symbolId: number): number {
    return this.refs.get(symbolId)?.length ?? 0
  }

  deleteByFileId(fileId: number): void {
    for (const [symbolId, locations] of this.refs) {
      const next = locations.filter((loc) => loc.fileId !== fileId)
      if (next.length === 0) {
        this.refs.delete(symbolId)
      } else if (next.length !== locations.length) {
        this.refs.set(symbolId, next)
      }
    }
  }
}
