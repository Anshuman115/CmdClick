export enum CursorKind {
  Unknown = 'unknown',
  ActionString = 'actionString',
  ServiceName = 'serviceName',
  MethodAccess = 'methodAccess',
  DefinitionSite = 'definitionSite',
}

export interface CursorContext {
  kind: CursorKind
  fullName: string
  targetKind: 'action' | 'service' | 'method' | 'definition' | ''
  isChained?: boolean
  chainObject?: string
  rawString?: string
}

const excludedThisProps = new Set(['broker', 'logger', 'actions', 'settings', 'metadata', 'schema', 'Promise'])

// Well-known JS/Node globals that are never CmdClick symbols
const excludedLocalVars = new Set([
  'console', 'JSON', 'Math', 'Object', 'Array', 'String', 'Number', 'Boolean',
  'Promise', 'Buffer', 'process', 'fs', 'path', 'os', 'http', 'https', 'url',
  'crypto', 'stream', 'events', 'util', 'assert', 'vm',
  'mongoose', 'axios', 'lodash', '_', 'moment', 'dayjs',
  'ctx', 'broker', 'logger', 'req', 'res', 'next', 'err', 'error',
])

export function detect(content: Uint8Array, line: number, col: number, serviceNamespace: string): CursorContext {
  const lines = new TextDecoder().decode(content).split('\n')
  const lineText = lines[line]
  if (lineText === undefined) {
    return unknown()
  }
  return detectStringLiteral(lineText, col, serviceNamespace) ??
    detectThisMethod(lineText, col, serviceNamespace) ??
    detectLocalVarMethod(lineText, col, serviceNamespace) ??
    detectDefinitionSite(lineText, col, serviceNamespace) ??
    unknown()
}

function detectStringLiteral(lineText: string, col: number, namespace: string): CursorContext | undefined {
  let i = 0
  while (i < lineText.length) {
    const quote = lineText[i]
    if (quote !== '"' && quote !== "'") {
      i += 1
      continue
    }
    const start = i
    i += 1
    while (i < lineText.length && lineText[i] !== quote) {
      i += lineText[i] === '\\' ? 2 : 1
    }
    if (i < lineText.length && col > start && col <= i) {
      const content = lineText.slice(start + 1, i)
      return analyzeString(content, col - start - 1, namespace)
    }
    i += 1
  }
  return undefined
}

function analyzeString(value: string, offset: number, namespace: string): CursorContext | undefined {
  const parts = value.split('.')
  if (parts.length < 2) {
    if (value.length > 0 && isValidIdentifier(value)) {
      return { kind: CursorKind.MethodAccess, fullName: `${namespace}.${value}`, targetKind: 'method', rawString: value }
    }
    return undefined
  }
  let pos = 0
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i] ?? ''
    if (offset >= pos && offset < pos + part.length) {
      const ctx = classifySegment(value, parts, i)
      ctx.rawString = value
      return ctx
    }
    pos += part.length + 1
  }
  return { kind: CursorKind.ActionString, fullName: value, targetKind: 'action', rawString: value }
}

function classifySegment(value: string, parts: string[], index: number): CursorContext {
  const first = parts[0] ?? ''
  const hasVersion = first.length >= 2 && first[0] === 'v' && isDigit(first[1] ?? '')
  if ((hasVersion && index === 1) || (!hasVersion && index === 0)) {
    return { kind: CursorKind.ServiceName, fullName: value, targetKind: 'service' }
  }
  return { kind: CursorKind.ActionString, fullName: value, targetKind: 'action' }
}

function detectThisMethod(lineText: string, col: number, namespace: string): CursorContext | undefined {
  const marker = 'this.'
  let searchFrom = 0

  while (searchFrom < lineText.length) {
    const start = lineText.indexOf(marker, searchFrom)
    if (start < 0) break

    const nameStart = start + marker.length
    const open = lineText.indexOf('(', nameStart)
    if (open < 0) break

    const raw = lineText.slice(nameStart, open).trim()

    if (raw.length > 0) {
      // Extract the last segment — handles both this.method() and this.obj.method()
      const dotIdx = raw.lastIndexOf('.')
      const methodName = dotIdx >= 0 ? raw.slice(dotIdx + 1) : raw
      const intermediary = dotIdx >= 0 ? raw.slice(0, dotIdx) : undefined

      if (methodName.length > 0 && !excludedThisProps.has(methodName)
        && (intermediary === undefined ? !excludedThisProps.has(methodName) : !excludedThisProps.has(intermediary))) {
        if (col >= start && col < open) {
          const result: CursorContext = { kind: CursorKind.MethodAccess, fullName: `${namespace}.${methodName}`, targetKind: 'method' }
          if (intermediary !== undefined) {
            result.isChained = true
            result.chainObject = intermediary
          }
          return result
        }
      }
    }

    searchFrom = open + 1
  }

  return undefined
}

function detectLocalVarMethod(lineText: string, col: number, namespace: string): CursorContext | undefined {
  // Matches: identifier.methodName(  where identifier is a local variable (no 'this.' prefix)
  // e.g. storageClient.archiveAsset(  notifyClient.sendAlert(  catalogClient.searchItems(
  const pattern = /\b([a-zA-Z_$][a-zA-Z0-9_$]*)\.([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(lineText)) !== null) {
    const varName = match[1] ?? ''
    const methodName = match[2] ?? ''
    const methodStart = match.index + varName.length + 1  // position of methodName in line
    const methodEnd = methodStart + methodName.length

    // Skip excluded globals and the 'this' keyword (handled by detectThisMethod)
    if (varName === 'this' || varName === 'await' || excludedLocalVars.has(varName)) continue
    // Skip if method name itself is excluded
    if (excludedThisProps.has(methodName)) continue
    // Skip very short identifiers that are likely loop vars (i, j, e, x, y)
    if (varName.length <= 1) continue

    if (col >= methodStart && col < methodEnd) {
      return {
        kind: CursorKind.MethodAccess,
        fullName: `${namespace}.${methodName}`,
        targetKind: 'method',
        isChained: true,
        chainObject: varName,
      }
    }
  }
  return undefined
}

function detectDefinitionSite(lineText: string, col: number, namespace: string): CursorContext | undefined {
  const trimmedStart = lineText.length - lineText.trimStart().length
  const trimmed = lineText.trim()
  const symbolName = definitionName(trimmed)
  if (symbolName === undefined) {
    return undefined
  }
  const nameStart = lineText.indexOf(symbolName, trimmedStart)
  if (col < nameStart || col >= nameStart + symbolName.length) {
    return undefined
  }
  return {
    kind: CursorKind.DefinitionSite,
    fullName: namespace.length === 0 ? symbolName : `${namespace}.${symbolName}`,
    targetKind: 'definition',
  }
}

function definitionName(trimmed: string): string | undefined {
  const colon = trimmed.indexOf(':')
  const paren = trimmed.indexOf('(')
  const boundary = colon >= 0 && (paren < 0 || colon < paren) ? colon : paren
  if (boundary <= 0) {
    return undefined
  }
  const before = stripAsyncPrefix(trimmed.slice(0, boundary)).trim()
  const unquoted = unquote(before)
  return unquoted.length === 0 || unquoted === 'handler' || !isDefinitionName(unquoted) ? undefined : unquoted
}

function isDigit(value: string): boolean {
  return value >= '0' && value <= '9'
}

function stripAsyncPrefix(value: string): string {
  const trimmed = value.trimStart()
  return trimmed.startsWith('async ') || trimmed.startsWith('async\t') ? trimmed.slice(5).trimStart() : value
}

function unquote(value: string): string {
  if (value.length >= 2) {
    const first = value[0]
    const last = value[value.length - 1]
    if ((first === '"' || first === "'") && first === last) {
      return value.slice(1, -1)
    }
  }
  return value
}

function isDefinitionName(value: string): boolean {
  for (const char of value) {
    if (char === '.' || char === ' ' || char === '\t') {
      return false
    }
  }
  return true
}

function isValidIdentifier(value: string): boolean {
  return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(value)
}

function unknown(): CursorContext {
  return { kind: CursorKind.Unknown, fullName: '', targetKind: '' }
}
