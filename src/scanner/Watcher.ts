import { Index } from '../index/Index'
import { Scanner } from './Scanner'

interface CloseableWatcher {
  on(event: 'change' | 'add' | 'unlink', listener: (filePath: string) => void): CloseableWatcher
  close(): Promise<void>
}

export class Watcher {
  private watcher: CloseableWatcher | undefined
  private readonly suppressed = new Map<string, ReturnType<typeof setTimeout>>()

  constructor(
    private readonly scanner: Scanner,
    private readonly index: Index,
  ) {}

  watch(rootPath: string): void {
    void import('chokidar').then((module) => {
      const watcher = module.default.watch(rootPath, {
        ignored: (filePath: string) => ignoredPath(filePath),
        ignoreInitial: true,
      }) as unknown as CloseableWatcher
      watcher.on('change', (filePath) => this.reindex(filePath))
      watcher.on('add', (filePath) => this.reindex(filePath))
      watcher.on('unlink', (filePath) => {
        const fileId = this.index.stringPool().intern(filePath)
        this.index.deleteByFile(fileId)
      })
      this.watcher = watcher
    })
  }

  close(): void {
    void this.watcher?.close()
    this.watcher = undefined
  }

  suppressFile(filePath: string, durationMs = 300): void {
    const existing = this.suppressed.get(filePath)
    if (existing !== undefined) clearTimeout(existing)
    this.suppressed.set(filePath, setTimeout(() => {
      this.suppressed.delete(filePath)
    }, durationMs))
  }

  private reindex(filePath: string): void {
    if (!filePath.endsWith('.js')) {
      return
    }
    if (this.suppressed.has(filePath)) return
    this.scanner.parseFile(filePath)
  }
}

function ignoredPath(filePath: string): boolean {
  return filePath.includes('/.git/') ||
    filePath.includes('/node_modules/') ||
    filePath.includes('/dist/') ||
    filePath.includes('/build/') ||
    filePath.includes('/coverage/')
}
