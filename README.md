# CmdClick

**Code Intelligence for MoleculerJS** — Go-to-Definition, Find Usages, and CodeLens for MoleculerJS microservice architectures.

VS Code treats service calls like `ctx.call("v1.orders.create")` as plain strings. CmdClick understands them as navigable symbols — Cmd+Click to jump to the action definition, see usage counts above every method, and trace calls across services and mixins.

## Features

### ⚡ Cmd+Click on Service Calls

Click on any service action string to jump directly to its definition:

```javascript
// Cmd+click on "create" → opens the action definition
await ctx.call("v1.orders.create", data);

// Also works with:
this.broker.call("v1.catalog.getItem", { id });
ctx.broker.call("v1.inventory.checkStock", itemId);
ctx.emit("order.created", payload);
```

### 📊 CodeLens — Usage Counts

Every action and method shows a clickable usage count:

```
        5 usages
async create(ctx) {
    // ...
}
```

Click the label to open a peek panel with all call sites across the codebase.

### 🔗 Hook String Navigation

Navigate from hook strings directly to the method definition:

```javascript
hooks: {
    before: {
        publish: ["validateInput", "checkQuota"]
        //          ^ Cmd+click → goes to the method definition
    }
}
```

### 🔄 Method Call Navigation

Navigate `this.method()` and chained calls, including local variable client calls:

```javascript
const score = this.computeScore(data);              // Cmd+click → definition
await this.catalogClient.fetchItems(params);        // Cmd+click → class method definition
await notifyClient.sendAlert(params);               // Cmd+click → local var method
```

### 🧩 Mixin-Aware Navigation

CmdClick resolves MoleculerJS mixin chains. If `validateInput` is defined in a hooks mixin and mixed into multiple services, CmdClick:

- Navigates to the **correct mixin file** (not a random one)
- Shows usages from **all consuming services**
- Handles re-registered symbols across namespace boundaries

### 🏷️ Service Name Navigation

Click on the service name portion to navigate to the service file:

```javascript
await ctx.call("v1.orders.create");
//              ^ Click "orders" → opens the service file
```

### 💬 Zero-Reference Feedback

Clicking a definition with no callers shows a clear notification instead of failing silently:

> `CmdClick: No usages found for "processWebhook"`

## Supported Patterns

| Pattern | Action |
|---------|--------|
| `ctx.call("v1.service.action")` | Navigate to action definition |
| `this.broker.call("service.method")` | Navigate to method definition |
| `ctx.broker.call("service.method")` | Navigate to method definition |
| `ctx.emit("event.name")` | Navigate to event handler |
| `ctx.broadcast("event.name")` | Navigate to event handler |
| `this.methodName()` | Navigate to method in same service/mixin |
| `this.client.methodName()` | Navigate to class method definition |
| `localClient.methodName()` | Navigate to local variable client method |
| `hooks: { before: { action: ["method"] } }` | Navigate to method definition |
| Click on action/method definition | See all usages via CodeLens |
| Click on service name in string | Navigate to service file |

## How It Works

1. **On startup**, CmdClick scans your workspace for `.js` files
2. Each file is parsed using [acorn](https://github.com/acornjs/acorn) (a JavaScript AST parser — no regex)
3. Actions, methods, hooks, and service calls are extracted and indexed in-memory
4. Mixin chains are resolved so symbols can be found across service boundaries
5. File changes are watched in real-time — edits are re-indexed automatically

**Performance:** Indexes 181 files in ~900ms, 22,856 symbols in under 2 seconds.

## Test Coverage

Tested against production MoleculerJS codebases:

| Repo | Symbols | References | Pass Rate |
|------|---------|------------|-----------|
| Service A (181 files) | 2,972 | 1,345 | **99.1%** |
| Service B (476 files) | 22,856 | 6,511 | **99.7%** |

Zero navigation failures across both repos.

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `cmdclick.enable` | `true` | Enable/disable the CmdClick language server |

## Requirements

- VS Code 1.75.0 or later
- A MoleculerJS project with `.service.js` and/or `.mixin.js` files

## Installation

### From VS Code Marketplace

Search for **CmdClick** in the Extensions panel, or install via:

```bash
code --install-extension anshuman115.cmdclick
```

### From VSIX (local build)

```bash
git clone https://github.com/anshuman115/Codewire.git
cd CmdClick
make install
```

Then reload VS Code (`Cmd+Shift+P` → "Reload Window").

Check the Output channel (`View → Output → CmdClick`) to confirm indexing.

## Running the Test Suite

```bash
# Unit tests
make test

# Automated integration test (generates test-report.html)
node auto-test.js --root=/path/to/your/project/src

# Live visual dashboard (streams results to browser)
node visual-test.js --root=/path/to/your/project/src --no-vscode
```

## Tech Stack

- **TypeScript** (strict mode)
- **Acorn** — JavaScript AST parser
- **Chokidar** — file system watcher
- **Mnemonist** — radix trie for prefix search
- Hand-rolled **JSON-RPC** transport over stdio

## License

Apache 2.0 © Anshuman Tripathy
