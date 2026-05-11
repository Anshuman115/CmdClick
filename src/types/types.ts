export enum SymbolKind {
  Action = 'action',
  Event = 'event',
  Method = 'method',
  Channel = 'channel',
}

export interface Symbol {
  id: number
  name: string
  fullName: string
  namespace: string
  kind: SymbolKind
  fileId: number
  sourceFileId: number
  line: number
  column: number
  sourceLang: string
}

export interface Location {
  fileId: number
  line: number
  column: number
}

export enum ReferenceKind {
  Call = 'call',
  Emit = 'emit',
  Broadcast = 'broadcast',
}

export interface Reference {
  fullName: string
  location: Location
  kind: ReferenceKind
}

export interface ParseError {
  line: number
  message: string
}

export interface ParseResult {
  symbols: Symbol[]
  references: Reference[]
  unresolvedMixins: UnresolvedMixin[]
  errors: ParseError[]
}

export interface UnresolvedMixin {
  mixinName: string
  requirePath: string
  sourceFile: string
}

export interface IndexStats {
  symbolCount: number
  fileCount: number
  referenceCount: number
}
