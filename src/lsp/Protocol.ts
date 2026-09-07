export interface RequestMessage {
  jsonrpc: string
  id?: unknown
  method: string
  params?: unknown
}

export interface Position {
  line: number
  character: number
}

export interface Range {
  start: Position
  end: Position
}

export interface Location {
  uri: string
  range: Range
}

export interface LocationLink {
  originSelectionRange?: Range
  targetUri: string
  targetRange: Range
  targetSelectionRange: Range
}

export interface InitializeParams {
  rootUri?: string
}

export interface ServerCapabilities {
  textDocumentSync: number
  definitionProvider: boolean
  referencesProvider?: boolean
  hoverProvider: boolean
  codeLensProvider: { resolveProvider: boolean }
}

export interface InitializeResult {
  capabilities: ServerCapabilities
}

export interface TextDocumentIdentifier {
  uri: string
}

export interface TextDocumentPositionParams {
  textDocument: TextDocumentIdentifier
  position: Position
}

export interface ReferenceParams extends TextDocumentPositionParams {
  context?: { includeDeclaration?: boolean }
}

export interface CodeLensParams {
  textDocument: TextDocumentIdentifier
}

export interface CodeLens {
  range: Range
  command?: {
    title: string
    command: string
    arguments?: unknown[]
  }
}

export interface DidOpenTextDocumentParams {
  textDocument: {
    uri: string
    text: string
  }
}

export interface DidChangeTextDocumentParams {
  textDocument: {
    uri: string
    version: number
  }
  contentChanges: Array<{ text: string }>
}

export interface DidSaveTextDocumentParams {
  textDocument: TextDocumentIdentifier
}

export interface RPCError {
  code: number
  message: string
}

export const ErrorCodes = {
  Parse: -32700,
  MethodNotFound: -32601,
} as const
