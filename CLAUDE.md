# CLAUDE.md — Project Context for Claude

## What is this?

CmdClick is a VS Code extension providing MoleculerJS code intelligence (Go-to-Definition,
Find Usages, CodeLens). It uses a custom LSP server written in TypeScript.

## Repository Structure

```
extension.js          — VS Code extension client (activates LSP, status bar, commands)
src/main.ts           — LSP server entry point (stdio transport)
src/lsp/Server.ts     — JSON-RPC message router
src/lsp/Handlers.ts   — Definition, references, CodeLens handlers
src/lsp/Cursor.ts     — Cursor position analysis (string literals, this.method, definitions)
src/lsp/Protocol.ts   — LSP type definitions
src/lsp/Transport.ts  — JSON-RPC reader/writer
src/scanner/Scanner.ts — Bulk file indexer + single-file re-indexer
src/scanner/Watcher.ts — Chokidar-based file watcher
src/parser/moleculer/MoleculerParser.ts — AST parser (acorn) for Moleculer service files
src/parser/moleculer/ASTVisitor.ts      — AST traversal helpers
src/index/Index.ts         — Symbol store (Map + radix trie)
src/index/InvertedIndex.ts — Reference store (symbol ID → locations)
src/index/StringPool.ts    — String interning for file paths
src/types/types.ts         — Shared type definitions
test/fixtures/             — Test service files
```

## Build & Test

```bash
make build      # npx tsc
make test       # npx vitest run src
make install    # Build + install .vsix to VS Code
```

## Important Conventions

1. **No regex parsing** — all code analysis uses acorn AST
2. **Hand-rolled JSON-RPC** — no vscode-languageserver dependency on the server side
3. **Mixin namespaces** — each nameless mixin gets `__mixin_<filename>_<hash>__` to avoid collisions
4. **`__self__` references** — `this.method()` calls are stored as `__self__.method`, resolved at scan time
5. **Class support** — non-service `.js` files (factories, utils) have class methods extracted
6. **Chained calls** — `this.obj.method()` prefers class-based definitions via `findClassSymbolByName`
7. **File watcher** — saves trigger re-indexing with mixin re-resolution (`resolveMixins`)

## What NOT to change

- Don't add vscode-languageserver as a dependency — the server is intentionally hand-rolled
- Don't switch to regex-based parsing — acorn AST is the foundation
- Don't remove the radix trie — it powers prefix search for autocomplete (future feature)
