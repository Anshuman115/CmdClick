# Changelog

All notable changes to **CmdClick** will be documented in this file.

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
