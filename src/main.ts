import fs from 'node:fs'
import path from 'node:path'
import { Index } from './index/Index'
import { MoleculerParser } from './parser/moleculer/MoleculerParser'
import { Scanner } from './scanner/Scanner'
import { Server } from './lsp/Server'
import type { ParseResult } from './types/types'

const parser = new MoleculerParser()

async function main(args: string[]): Promise<void> {
  if (args[0] === '--version') {
    process.stdout.write('CmdClick JS 0.1.0\n')
    return
  }
  if (args[0] === '--debug-parse') {
    const filePath = args[1]
    if (filePath === undefined) {
      throw new Error('usage: cmdclick --debug-parse <file>')
    }
    debugParse(filePath)
    return
  }
  if (args[0] === '--coverage') {
    const rootPath = args[1]
    if (rootPath === undefined) {
      throw new Error('usage: cmdclick --coverage <root>')
    }
    coverage(rootPath)
    return
  }

  const server = new Server(process.stdin, process.stdout)
  await server.run()
}

function debugParse(filePath: string): void {
  const result = parser.parse(filePath, fs.readFileSync(filePath))
  process.stdout.write(`FILE: ${filePath}\n`)
  writeParseResult(result)
}

function writeParseResult(result: ParseResult): void {
  process.stdout.write('SYMBOLS\n')
  for (const symbol of result.symbols) {
    process.stdout.write(`  ${symbol.fullName} [${symbol.kind}] (line ${symbol.line + 1}, col ${symbol.column + 1})\n`)
  }
  process.stdout.write('REFERENCES\n')
  for (const ref of result.references) {
    process.stdout.write(`  ${ref.fullName} [${ref.kind}] (line ${ref.location.line + 1}, col ${ref.location.column + 1})\n`)
  }
  process.stdout.write('MIXINS\n')
  for (const mixin of result.unresolvedMixins) {
    process.stdout.write(`  ${mixin.mixinName} -> ${mixin.requirePath}\n`)
  }
  if (result.errors.length > 0) {
    process.stdout.write('ERRORS\n')
    for (const error of result.errors) {
      process.stdout.write(`  line ${error.line + 1}: ${error.message}\n`)
    }
  }
}

function coverage(rootPath: string): void {
  const files = collectFiles(rootPath)
  let parsed = 0
  const failures: string[] = []
  for (const filePath of files) {
    try {
      parser.parse(filePath, fs.readFileSync(filePath))
      parsed += 1
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      failures.push(`${filePath}: ${message}`)
    }
  }

  const index = new Index()
  const scanner = new Scanner([parser], index)
  scanner.scan(rootPath)
  const stats = index.stats()
  const percent = files.length === 0 ? 100 : Math.round((parsed / files.length) * 10000) / 100

  process.stdout.write('CmdClick JS coverage\n')
  process.stdout.write(`Files: ${files.length}\n`)
  process.stdout.write(`Parsed: ${parsed}\n`)
  process.stdout.write(`Failed: ${failures.length}\n`)
  process.stdout.write(`Symbols: ${stats.symbolCount}\n`)
  process.stdout.write(`References: ${stats.referenceCount}\n`)
  process.stdout.write(`Coverage: ${percent}%\n`)
  if (failures.length > 0) {
    process.stdout.write('Failures:\n')
    for (const failure of failures) {
      process.stdout.write(`  ${failure}\n`)
    }
  }
}

function collectFiles(rootPath: string): string[] {
  const results: string[] = []
  const skipDirs = new Set(['node_modules', '.git', '.vscode', 'dist', 'build', 'coverage'])
  const visit = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (!skipDirs.has(entry.name)) {
          visit(fullPath)
        }
        continue
      }
      if (parser.filePatterns().some((suffix) => fullPath.endsWith(suffix))) {
        results.push(fullPath)
      }
    }
  }
  visit(rootPath)
  return results
}

main(process.argv.slice(2)).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`[CmdClick] ${message}\n`)
  process.exit(1)
})
