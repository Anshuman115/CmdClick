import { parse } from 'acorn'

export interface Position {
  line: number
  column: number
}

export interface SourceLocation {
  start: Position
  end: Position
}

export interface AstNode {
  type: string
  start: number
  end: number
  loc?: SourceLocation | null
  [key: string]: unknown
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function isNode(value: unknown): value is AstNode {
  return isRecord(value) && typeof value.type === 'string' && typeof value.start === 'number' && typeof value.end === 'number'
}

export function parseJavaScript(content: string): AstNode {
  try {
    return parse(content, {
      ecmaVersion: 'latest',
      sourceType: 'script',
      locations: true,
      allowHashBang: true,
    }) as unknown as AstNode
  } catch {
    return parse(content, {
      ecmaVersion: 'latest',
      sourceType: 'module',
      locations: true,
      allowHashBang: true,
    }) as unknown as AstNode
  }
}

export function walkAst(root: AstNode, visit: (node: AstNode) => void): void {
  visit(root)
  for (const child of childNodes(root)) {
    walkAst(child, visit)
  }
}

export function childNodes(node: AstNode): AstNode[] {
  const children: AstNode[] = []
  for (const [key, value] of Object.entries(node)) {
    if (key === 'type' || key === 'start' || key === 'end' || key === 'loc' || key === 'range') {
      continue
    }
    if (isNode(value)) {
      children.push(value)
      continue
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        if (isNode(item)) {
          children.push(item)
        }
      }
    }
  }
  return children
}

export function nodeProp(node: AstNode, key: string): unknown {
  return node[key]
}

export function nodeLine(node: AstNode): number {
  return node.loc?.start.line === undefined ? 0 : node.loc.start.line - 1
}

export function nodeColumn(node: AstNode): number {
  return node.loc?.start.column ?? 0
}

export function identifierName(node: unknown): string | undefined {
  return isNode(node) && node.type === 'Identifier' && typeof nodeProp(node, 'name') === 'string'
    ? nodeProp(node, 'name') as string
    : undefined
}

export function literalString(node: unknown): string | undefined {
  if (!isNode(node) || node.type !== 'Literal') {
    return undefined
  }
  const value = nodeProp(node, 'value')
  return typeof value === 'string' ? value : undefined
}

export function literalNumber(node: unknown): number | undefined {
  if (!isNode(node) || node.type !== 'Literal') {
    return undefined
  }
  const value = nodeProp(node, 'value')
  return typeof value === 'number' ? value : undefined
}

export function propertyName(property: AstNode): string | undefined {
  const key = nodeProp(property, 'key')
  return identifierName(key) ?? literalString(key) ?? (literalNumber(key) !== undefined ? String(literalNumber(key)) : undefined)
}

export function propertyValue(property: AstNode): AstNode | undefined {
  const value = nodeProp(property, 'value')
  return isNode(value) ? value : undefined
}

export function objectProperties(node: AstNode | undefined): AstNode[] {
  if (node === undefined || node.type !== 'ObjectExpression') {
    return []
  }
  const properties = nodeProp(node, 'properties')
  if (!Array.isArray(properties)) {
    return []
  }
  return properties.filter(isNode).filter((property) => property.type === 'Property')
}

export function arrayElements(node: AstNode | undefined): AstNode[] {
  if (node === undefined || node.type !== 'ArrayExpression') {
    return []
  }
  const elements = nodeProp(node, 'elements')
  if (!Array.isArray(elements)) {
    return []
  }
  return elements.filter(isNode)
}
