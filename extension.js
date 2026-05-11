// CmdClick — VS Code extension client
//
// This file launches the TypeScript LSP server and connects VS Code to it.
// All intelligence lives in cmdclick-js. This is just the bridge.

const vscode = require('vscode')
const { LanguageClient, TransportKind } = require('vscode-languageclient/node')
const path = require('path')
const fs = require('fs')

/** @type {LanguageClient} */
let client

/** @type {vscode.StatusBarItem} */
let statusBar

/**
 * VS Code calls this when the extension activates.
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
    // Check if enabled
    const config = vscode.workspace.getConfiguration('cmdclick')
    if (!config.get('enable', true)) {
        return
    }

    // Create status bar item
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

    // Configure the language server
    const serverOptions = {
        run: { command: process.execPath, args: [serverModule], transport: TransportKind.stdio },
        debug: { command: process.execPath, args: [serverModule], transport: TransportKind.stdio }
    }

    const clientOptions = {
        documentSelector: [
            { scheme: 'file', language: 'javascript' }
        ],
        outputChannelName: 'CmdClick',
        // Send didSave notifications so the server can re-index
        synchronize: {
            fileEvents: vscode.workspace.createFileSystemWatcher('**/*.{service,mixin}.js')
        },
        // Middleware intercepts definition requests. When CmdClick finds
        // a Moleculer symbol, it returns results directly — preventing
        // VS Code from also querying the built-in JS definition provider
        // and creating duplicate "Definitions (2)" popups.
        //
        // How this works:
        // - next() sends the request to the CmdClick LSP server
        // - If it returns results, return them and stop the provider chain
        // - If it returns null/empty, let the built-in JS provider handle it
        middleware: {
            provideDefinition: async (document, position, token, next) => {
                const result = await next(document, position, token)
                if (result) {
                    if (Array.isArray(result) && result.length > 0) {
                        return result
                    }
                    if (!Array.isArray(result)) {
                        return result
                    }
                }
                // CmdClick returned null/empty → let built-in JS handle it
                return undefined
            }
        }
    }

    // Create and start the client
    client = new LanguageClient(
        'cmdclick',
        'CmdClick',
        serverOptions,
        clientOptions
    )

    // Register the showReferences command (used by CodeLens)
    const showRefsCmd = vscode.commands.registerCommand('cmdclick.showReferences', (uri, position, locations = []) => {
        const parsedUri = vscode.Uri.parse(uri)
        const pos = new vscode.Position(position.line, position.character)
        const refs = locations.map(loc => {
            return new vscode.Location(
                vscode.Uri.parse(loc.uri),
                new vscode.Range(
                    new vscode.Position(loc.range.start.line, loc.range.start.character),
                    new vscode.Position(loc.range.end.line, loc.range.end.character)
                )
            )
        })
        vscode.commands.executeCommand('editor.action.showReferences', parsedUri, pos, refs)
    })
    context.subscriptions.push(showRefsCmd)

    // Start the language client — start() returns a promise in v8+
    client.start().then(() => {
        statusBar.text = '$(sync~spin) CmdClick: Indexing...'
        statusBar.tooltip = 'CmdClick — indexing workspace'

        client.onNotification('cmdclick/indexReady', (params) => {
            statusBar.text = '$(check) CmdClick: Ready'
            statusBar.tooltip = `${params.fileCount} files indexed`
        })

        // Listen for custom server notification: cmdclick/showReferences
        // The server sends this when clicking on a definition site — it contains
        // the reference locations (call-sites). We trigger VS Code's native
        // references panel, which shows ONLY the call sites without the definition.
        client.onNotification('cmdclick/showReferences', (params) => {
            const uri = vscode.Uri.parse(params.uri)
            const pos = new vscode.Position(params.position.line, params.position.character)
            const locations = (params.locations || []).map(loc => {
                return new vscode.Location(
                    vscode.Uri.parse(loc.uri),
                    new vscode.Range(
                        new vscode.Position(loc.range.start.line, loc.range.start.character),
                        new vscode.Position(loc.range.end.line, loc.range.end.character)
                    )
                )
            })
            if (locations.length > 0) {
                vscode.commands.executeCommand('editor.action.showReferences', uri, pos, locations)
            }
        })

        client.onNotification('cmdclick/noReferences', (params) => {
            vscode.window.showInformationMessage(`CmdClick: No references found for "${params.symbolName}"`)
        })
    }).catch((err) => {
        statusBar.text = '$(error) CmdClick: Offline'
        statusBar.tooltip = `CmdClick failed: ${err.message}`
    })

    context.subscriptions.push(client)
}

/**
 * VS Code calls this when the extension deactivates.
 */
function deactivate() {
    if (client) {
        return client.stop()
    }
}

module.exports = { activate, deactivate }
