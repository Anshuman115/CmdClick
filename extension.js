// CmdClick — VS Code extension client
//
// This file launches the TypeScript LSP server and connects VS Code to it.
// All intelligence lives in src/. This is just the bridge.

const vscode = require('vscode')
const { LanguageClient, TransportKind } = require('vscode-languageclient/node')
const path = require('path')
const fs = require('fs')

/** @type {LanguageClient} */
let client

/** @type {vscode.StatusBarItem} */
let statusBar

// ---------------------------------------------------------------------------
// Click vs hover detection
//
// When the user Cmd+Clicks, VS Code fires onDidChangeTextEditorSelection
// BEFORE sending textDocument/definition. Hover never changes selection.
// We capture the timestamp of the last selection change to tell them apart.
// ---------------------------------------------------------------------------

let lastSelectionChangeMs = 0

vscode.window.onDidChangeTextEditorSelection(() => {
  lastSelectionChangeMs = Date.now()
})

// ---------------------------------------------------------------------------
// Navigation breadcrumb state
// Tracks the last "from" position so CodeLens popup auto-selects it.
// ---------------------------------------------------------------------------

/** @type {{uri: string, line: number} | null} */
let lastFromPosition = null

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  const config = vscode.workspace.getConfiguration('cmdclick')
  if (!config.get('enable', true)) {
    return
  }

  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100)
  statusBar.text = '$(sync~spin) CmdClick: Indexing...'
  statusBar.tooltip = 'CmdClick — MoleculerJS code navigation'
  statusBar.show()
  context.subscriptions.push(statusBar)

  const serverModule = context.asAbsolutePath(path.join('dist', 'main.js'))
  if (!fs.existsSync(serverModule)) {
    statusBar.text = '$(error) CmdClick: Offline'
    statusBar.tooltip = `CmdClick server not found: ${serverModule}`
    vscode.window.showErrorMessage(statusBar.tooltip)
    return
  }

  const serverOptions = {
    run: { command: process.execPath, args: [serverModule], transport: TransportKind.stdio },
    debug: { command: process.execPath, args: [serverModule], transport: TransportKind.stdio }
  }

  const clientOptions = {
    documentSelector: [{ scheme: 'file', language: 'javascript' }],
    outputChannelName: 'CmdClick',
    synchronize: {
      fileEvents: vscode.workspace.createFileSystemWatcher('**/*.{service,mixin}.js')
    },
    middleware: {
      // -----------------------------------------------------------------------
      // Definition middleware
      //
      // Case A — server returns a location: user clicked a call site.
      //   Record from-position and navigate.
      //
      // Case B — server returns null: definition-site, hover, or unknown symbol.
      //   Check if the selection changed recently (within 300ms).
      //   YES → it was a real click on a definition site → fetch our usages
      //         and show the same popup as CodeLens. Return self-location to
      //         prevent VS Code from also running built-in providers.
      //   NO  → it was a hover → return undefined, no popup.
      // -----------------------------------------------------------------------
      provideDefinition: async (document, position, token, next) => {
        // Capture click state BEFORE the async server round-trip
        const wasClick = Date.now() - lastSelectionChangeMs < 300

        const result = await next(document, position, token)

        const hasResult = result && (Array.isArray(result) ? result.length > 0 : true)

        if (hasResult) {
          // Call-site click — record from-position for CodeLens pre-select
          lastFromPosition = {
            uri: document.uri.toString(),
            line: position.line,
          }
          return result
        }

        // Null result — distinguish click from hover
        if (!wasClick) {
          // Hover — return undefined so built-in handles its own preview
          return undefined
        }

        // Real click on definition site — show our usages popup
        try {
          const refs = await client.sendRequest('textDocument/references', {
            textDocument: { uri: document.uri.toString() },
            position: { line: position.line, character: position.character },
            context: { includeDeclaration: false },
          })

          if (refs && refs.length > 0) {
            const locations = refs.map(loc => new vscode.Location(
              vscode.Uri.parse(loc.uri),
              new vscode.Range(
                new vscode.Position(loc.range.start.line, loc.range.start.character),
                new vscode.Position(loc.range.end.line, loc.range.end.character)
              )
            ))

            const sorted = sortRefsWithFromFirst(locations, lastFromPosition)

            setTimeout(() => {
              vscode.commands.executeCommand(
                'editor.action.showReferences',
                document.uri,
                position,
                sorted
              )
            }, 0)

            // Return self-location to prevent VS Code from also running built-in
            // providers (which would show the "References (N)" panel with duplicates).
            return [new vscode.Location(document.uri, new vscode.Position(position.line, position.character))]
          }
        } catch (_) {
          // server unavailable or no refs — fall through
        }

        return undefined
      },

      // -----------------------------------------------------------------------
      // References middleware
      // When our server returns refs, use them exclusively.
      // Returning our results prevents VS Code from merging with built-in.
      // -----------------------------------------------------------------------
      provideReferences: async (document, position, context, token, next) => {
        const result = await next(document, position, context, token)
        if (result && result.length > 0) {
          return result
        }
        return undefined
      },
    }
  }

  client = new LanguageClient('cmdclick', 'CmdClick', serverOptions, clientOptions)

  // Register the showReferences command (used by CodeLens)
  const showRefsCmd = vscode.commands.registerCommand('cmdclick.showReferences', (uri, position, locations = []) => {
    const parsedUri = vscode.Uri.parse(uri)
    const pos = new vscode.Position(position.line, position.character)
    const refs = locations.map(loc => new vscode.Location(
      vscode.Uri.parse(loc.uri),
      new vscode.Range(
        new vscode.Position(loc.range.start.line, loc.range.start.character),
        new vscode.Position(loc.range.end.line, loc.range.end.character)
      )
    ))

    // Sort so the "from" location appears first — peek panel pre-selects it
    const sorted = sortRefsWithFromFirst(refs, lastFromPosition)

    vscode.commands.executeCommand('editor.action.showReferences', parsedUri, pos, sorted)
  })
  context.subscriptions.push(showRefsCmd)

  client.start().then(() => {
    statusBar.text = '$(sync~spin) CmdClick: Indexing...'
    statusBar.tooltip = 'CmdClick — indexing workspace'

    client.onNotification('cmdclick/indexReady', (params) => {
      statusBar.text = '$(check) CmdClick'
      statusBar.tooltip = `${params.fileCount} files indexed`
    })

    client.onNotification('cmdclick/noReferences', (params) => {
      vscode.window.showInformationMessage(`CmdClick: No usages found for "${params.symbolName}"`)
    })
  }).catch((err) => {
    statusBar.text = '$(error) CmdClick: Offline'
    statusBar.tooltip = `CmdClick failed: ${err.message}`
  })

  context.subscriptions.push(client)
}

/**
 * Sort locations so the one matching `from` appears first.
 * The peek panel pre-selects the first entry.
 * @param {vscode.Location[]} refs
 * @param {{uri: string, line: number} | null} from
 * @returns {vscode.Location[]}
 */
function sortRefsWithFromFirst(refs, from) {
  if (!from || refs.length <= 1) return refs

  const idx = refs.findIndex(loc =>
    loc.uri.toString() === from.uri && loc.range.start.line === from.line
  )

  if (idx <= 0) return refs

  const sorted = [...refs]
  const [match] = sorted.splice(idx, 1)
  sorted.unshift(match)
  return sorted
}

function deactivate() {
  if (client) {
    return client.stop()
  }
}

module.exports = { activate, deactivate }
