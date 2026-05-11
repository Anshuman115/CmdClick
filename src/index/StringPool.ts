export class StringPool {
  private readonly strings: string[] = ['']
  private readonly lookup = new Map<string, number>()

  intern(value: string): number {
    const existing = this.lookup.get(value)
    if (existing !== undefined) {
      return existing
    }
    const id = this.strings.length
    this.strings.push(value)
    this.lookup.set(value, id)
    return id
  }

  get(id: number): string {
    return this.strings[id] ?? ''
  }

  len(): number {
    return this.strings.length - 1
  }
}
