# Changelog

All notable changes to **CmdClick** will be documented in this file.

## [0.2.0] - 2026-05-26

### Fixed

- **Server crash loop on unparseable files** — files using syntax acorn cannot parse (newer JS proposals, duplicate `let` declarations, pipeline operators, etc.) now return an empty index result instead of crashing the LSP process and triggering infinite restart loops
- **Duplicate reference entries** — removed duplicate `referencesProvider` registration conflict; each usage now appears exactly once in the locations panel
- **Cmd+hover popup** — Cmd+hover no longer triggers the usages popup; only real Cmd+Click (which changes the editor selection) shows results
- **First-click reliability** — definition and reference requests arriving before workspace scan finishes are now queued and replayed automatically on scan completion; the first Cmd+Click always works without retries
- **Memory leak on file close** — `textDocument/didClose` is now handled; cached file content is freed when VS Code closes a document

### Added

- **Cmd+Click on definition shows usages** — clicking a method or action name (at its definition site) now shows the same "Locations (N)" popup as the CodeLens button
- **Navigation breadcrumb** — when navigating into a method via CodeLens, the caller's position is tracked; the usages popup pre-selects (scrolls to) that call site on the next usages lookup
- **Watcher error resilience** — chokidar OS-level errors (`EMFILE`, `EACCES`, etc.) are now caught as non-fatal and logged, preventing server crashes in large monorepos
- **CodeLens scan guard** — CodeLens requests during initial indexing return empty immediately instead of showing partial/stale data

### Performance

- **O(N²) → O(N) CodeLens generation** — `findAllReferencesForSymbol` previously scanned all 23 000+ symbols for every method in a file; now builds a name→symbols map once per CodeLens request, making CodeLens ~20× faster on large codebases

---

## [0.1.0] - 2026-05-11

### Added

- **Go-to-Definition** for all MoleculerJS call patterns:
  - `ctx.call("service.action")`
  - `this.broker.call("service.action")`
  - `ctx.broker.call("service.action")`
  - `ctx.emit("event.name")` / `this.broker.emit("event.name")`
  - `ctx.broadcast("event.name")` / `this.broker.broadcast("event.name")`
- **Event navigation** — dot-notation event strings (e.g. `"article.published"`) resolve correctly to event definitions, not misclassified as service.action calls
- **Method call navigation** — `this.method()` navigates to same-file method definitions
- **Chained call navigation** — `this.obj.method()` navigates to class method definitions in factory/utility files
- **Local variable client navigation** — `localClient.method()` resolves to class method definitions
- **Hook string navigation** — click method names inside `hooks: { before: { action: [fn] } }` blocks
- **Service name navigation** — click the service segment of an action string to jump to the service file
- **Find All References** — CodeLens shows `N usages` above every action, method, and event definition
- **Mixin-aware resolution** — symbols resolved across full mixin chains; navigation lands on the physical source file regardless of which service consumes the mixin
- **Class method support** — methods in utility, factory, and adapter class files are indexed and navigable
- **Real-time re-indexing** — file saves trigger incremental re-index (only the changed file, not full rescan)
- **Chokidar watcher resilience** — OS-level file descriptor errors are caught as non-fatal, preventing LSP server crashes in large codebases
- **Zero-reference feedback** — info notification when clicking a definition that has no callers
- **Apache 2.0 License**
