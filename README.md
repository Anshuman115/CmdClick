# CmdClick

![CmdClick Banner](banner.png)

**Code Intelligence for MoleculerJS.** Go to definition, usage counts, and mixin aware navigation for MoleculerJS microservice architectures.

VS Code treats a service call like `ctx.call("v1.orders.create")` as a plain string. It has no idea that string points to a real action defined in another file. CmdClick teaches it. Cmd+Click any service call to jump straight to the action definition, see how many times each method is used, and trace calls across services and mixins.

> **Alpha release.** This is an early version. Bugs are expected. If something doesn't navigate correctly, please [open an issue](https://github.com/Anshuman115/CmdClick/issues), it helps a lot.

---

## Features

### Cmd+Click on service calls

Click any service action string to jump directly to its definition:

```javascript
// Cmd+click on "create" opens the action definition
await ctx.call("v1.orders.create", data);

// Also works with:
this.broker.call("v1.catalog.getItem", { id });
ctx.broker.call("v1.inventory.checkStock", itemId);
ctx.emit("order.created", payload);
```

### Usage counts

Every action and method shows a clickable usage count above it:

```
        5 usages
async create(ctx) {
    // ...
}
```

Click the label to open a peek panel with all call sites across the codebase.

### Hook string navigation

Navigate from a hook string straight to the method it names:

```javascript
hooks: {
    before: {
        publish: ["validateInput", "checkQuota"]
        //          ^ Cmd+click goes to the method definition
    }
}
```

### Method call navigation

Navigate `this.method()` calls, chained client calls, and local variable client calls:

```javascript
const score = this.computeScore(data);          // Cmd+click to definition
await this.catalogClient.fetchItems(params);     // Cmd+click to class method definition
await notifyClient.sendAlert(params);            // Cmd+click to local var method
```

### Mixin aware navigation

CmdClick resolves MoleculerJS mixin chains. If `validateInput` is defined in a hooks mixin and mixed into several services, CmdClick navigates to the correct mixin file, shows usages from every consuming service, and handles symbols that get re registered across namespace boundaries.

### Service name navigation

Click the service name portion of a call string to open that service's file:

```javascript
await ctx.call("v1.orders.create");
//              ^ Click "orders" opens the service file
```

### Zero reference feedback

Clicking a definition that has no callers shows a clear notification instead of failing silently:

> `CmdClick: No usages found for "processWebhook"`

---

## Supported patterns

| Pattern | Action |
|---------|--------|
| `ctx.call("v1.service.action")` | Navigate to action definition |
| `this.broker.call("service.method")` | Navigate to method definition |
| `ctx.broker.call("service.method")` | Navigate to method definition |
| `ctx.emit("event.name")` | Navigate to event handler |
| `ctx.broadcast("event.name")` | Navigate to event handler |
| `this.methodName()` | Navigate to method in same service or mixin |
| `this.client.methodName()` | Navigate to class method definition |
| `localClient.methodName()` | Navigate to local variable client method |
| `hooks: { before: { action: ["method"] } }` | Navigate to method definition |
| Click on an action or method definition | See all usages via the count label |
| Click on a service name in a string | Navigate to the service file |

---

## How it works

This section explains the engine in two passes. First in plain language, then the technical detail underneath.

### The plain language version

The core problem: in Moleculer, you don't call a function by importing it. You call it by writing its name in a string, `ctx.call("payment.processOrder")`. JavaScript sees only a string. It has no idea that string is meant to reach a real function living in another file. CmdClick's whole job is to rebuild that missing connection.

It does this with three simple ideas.

**1. The phonebook.** On startup, CmdClick reads every `.js` file and writes down every thing your code defines, every action, event, method, and channel. Each one becomes an entry: the name, and where it lives (file and line). So `payment.processOrder` maps to `payment.service.js` line 4. This is the phonebook. Given a name, it hands back the exact location. That's what powers go to definition: you click a call string, CmdClick looks the name up in the phonebook, and jumps you there.

**2. The sticky notes.** While reading your files, CmdClick also writes down every attempt to call something, every `ctx.call(...)`, `ctx.emit(...)`, and `this.method()`. Each one is a sticky note saying "this file, this line, tried to reach this name." These are temporary. As soon as each note is matched to a real phonebook entry, the note's job is done.

**3. The usage list.** Every time a sticky note gets matched to a real definition, CmdClick records it in a second table: for each definition, the full list of places that call it. So `payment.processOrder` maps to every file and line that calls it. This is what powers usage counts and the peek panel: given a definition, hand back all its callers instantly.

The tricky part, and the reason CmdClick exists at all, is the matching step. A call like `this.notifyUser()` doesn't say which service it belongs to, so CmdClick first works out the current file's own service name, then combines them before looking up. A mixin method physically lives in one file but gets used inside another service, so CmdClick copies it into the right service's name before matching. Event names can be listened for in several services at once. All of this is work a normal language does for free through imports, but Moleculer's string based calls push it onto the tool.

A quick way to hold it in your head: the phonebook answers "where is this defined?", the usage list answers "who calls this?", and the sticky notes are just the scratch paper used to build the usage list during the scan, then thrown away.

### The technical version

**Parsing.** Every `.js` file is parsed with [acorn](https://github.com/acornjs/acorn) into an AST. No regex is used for code analysis in the indexer. Service files are detected by a `module.exports = { ... }` object literal; the namespace is derived from the `name` and `version` properties (`v${version}.${name}`, or bare `name` when unversioned). Actions, events, methods, and channels are extracted as symbols. Calls (`ctx.call`/`emit`/`broadcast`, `this.method()`, chained and local variable method calls, hook strings) are extracted as references.

**The symbol store (the phonebook).** An in memory `Map<string, Symbol>` keyed by fully qualified name. A `Symbol` carries its name, namespace, kind, file, line, and an id. Exact match lookup is O(1). This backs go to definition on the happy path.

**The inverted index (the usage list).** A `Map<number, Location[]>` keyed by symbol id, value is the list of call site locations pointing at that symbol. Populated during reference resolution. Fetching all references for a symbol is O(1). This backs usage counts and find all references.

**The string pool.** A string interning table mapping every distinct file path and symbol name to a stable integer id and back, so heavy strings aren't stored repeatedly.

**Reference resolution (matching sticky notes to the phonebook).** Raw references collected during the scan are resolved against the phonebook: exact fully qualified names match directly; `this.method()` references are resolved by first finding the calling file's own namespace, then combining; event short names are matched against known event symbols; mixin provided symbols are re namespaced into their consuming service before matching. Resolved references are written into the inverted index.

**Mixin resolution.** After the first parse pass, mixin symbols are copied into the namespace of each consuming service, so a method defined in a mixin file is findable under the service that mixes it in. Same name collisions between a service and its mixin are resolved in favor of the service's own definition.

**File watching.** [Chokidar](https://github.com/paulmillr/chokidar) watches the workspace. On save or change, the affected file is re indexed and the in memory index updated, with a short suppression window to avoid double processing a single save.

**Transport.** A hand rolled JSON-RPC layer over stdio (`Content-Length` framed messages), no `vscode-languageserver` dependency. The server implements initialize, document sync, definition, references, and codeLens.

**Caching.** On repeat navigation the full symbol list is cached and only rebuilt when a file actually changes, so back to back clicks don't re scan the workspace.

---

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `cmdclick.enable` | `true` | Enable or disable the CmdClick language server |

---

## Requirements

- VS Code 1.75.0 or later
- A MoleculerJS project with `.service.js` and/or `.mixin.js` files

---

## Installation

### From the VS Code Marketplace

Search for **CmdClick** in the Extensions panel, or install via:

```bash
code --install-extension Anshuman115.cmd-click
```

### From VSIX (local build)

```bash
git clone https://github.com/Anshuman115/CmdClick.git
cd CmdClick
make install
```

Then reload VS Code (`Cmd+Shift+P`, then "Reload Window").

Check the Output channel (`View`, `Output`, `CmdClick`) to confirm indexing.

---

## Tech stack

- **TypeScript** (strict mode)
- **Acorn**, JavaScript AST parser
- **Chokidar**, file system watcher
- Hand rolled **JSON-RPC** transport over stdio

---

## License

Apache 2.0 © Anshuman Tripathy