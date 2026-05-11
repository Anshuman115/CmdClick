# AGENTS.md — AI Contributor Guide

## Project Overview

CmdClick is a VS Code extension that provides code intelligence for MoleculerJS microservice architectures.
It implements a custom Language Server Protocol (LSP) server in TypeScript that indexes service actions,
methods, hooks, and references across `.js` files.

## Architecture

```
extension.js  →  LSP Client (vscode-languageclient)
                     ↕  JSON-RPC over stdio
src/main.ts   →  LSP Server
                     ↓
src/lsp/       →  Server.ts (router), Handlers.ts (feature logic), Cursor.ts (position detection)
src/scanner/   →  Scanner.ts (bulk indexing), Watcher.ts (live re-indexing via chokidar)
src/parser/    →  MoleculerParser.ts (AST-based extraction using acorn)
src/index/     →  Index.ts (symbol store + radix trie), InvertedIndex.ts (reference store)
```

## Code Style

- **TypeScript strict mode** — no `any`, no implicit returns
- **No classes except where structurally required** (Index, Scanner, Handlers, Server)
- **Functional helpers** — pure functions preferred for AST visitors and cursor detection
- **No external LSP library** — hand-rolled JSON-RPC transport over stdio
- **Tests** — colocated `*.test.ts` files using vitest

## Key Patterns

- Symbols are stored as `namespace.name` (e.g. `v1.orders.create`)
- Mixin symbols use file-derived namespaces: `__mixin_<stem>_<hash>__`
- References use `__self__` prefix for same-file calls, resolved at scan time
- Chained calls (`this.obj.method()`) prefer class-based definitions over mixin re-registrations

## Commands

```bash
make build           # Compile TypeScript
make test            # Run vitest
make package         # Build .vsix
make install         # Install to VS Code
make clean           # Remove dist/ and .vsix files
```
