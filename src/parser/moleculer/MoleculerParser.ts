import type { Parser } from '../Parser'
import { ReferenceKind, SymbolKind, type ParseResult, type Reference, type Symbol, type UnresolvedMixin } from '../../types/types'
import {
  arrayElements,
  identifierName,
  isNode,
  literalNumber,
  literalString,
  nodeColumn,
  nodeLine,
  nodeProp,
  objectProperties,
  parseJavaScript,
  propertyName,
  propertyValue,
  walkAst,
  type AstNode,
} from './ASTVisitor'

const thisExclusions = new Set(['broker', 'logger', 'actions', 'settings', 'metadata', 'schema', 'Promise'])

export class MoleculerParser implements Parser {
  parse(filePath: string, content: Uint8Array): ParseResult {
    const text = new TextDecoder().decode(content)
    const ast = parseJavaScript(text)
    const serviceObject = findModuleExportsObject(ast)
    if (serviceObject === undefined) {
      return this.parseNonServiceFile(filePath, ast)
    }

    const namespace = this.namespaceFromObject(filePath, serviceObject)
    return {
      symbols: this.extractSymbols(serviceObject, namespace),
      references: [...this.extractReferences(ast), ...this.extractHookReferences(serviceObject)],
      unresolvedMixins: this.extractMixins(serviceObject, filePath, this.extractRequireMap(ast)),
      errors: [],
    }
  }

  filePatterns(): string[] {
    return ['.js']
  }

  language(): string {
    return 'moleculerjs'
  }

  namespace(filePath: string, content: Uint8Array): string {
    const text = new TextDecoder().decode(content)
    const ast = parseJavaScript(text)
    const serviceObject = findModuleExportsObject(ast)
    return serviceObject === undefined ? '' : this.namespaceFromObject(filePath, serviceObject)
  }

  private parseNonServiceFile(filePath: string, ast: AstNode): ParseResult {
    const namespace = mixinNamespaceFromPath(filePath)
    const symbols: Symbol[] = []
    const references = this.extractReferences(ast)
    walkAst(ast, (node) => {
      if (node.type === 'ClassDeclaration' || node.type === 'ClassExpression') {
        const body = nodeProp(node, 'body')
        if (!isNode(body)) return
        const bodyList = nodeProp(body, 'body')
        if (!Array.isArray(bodyList)) return
        for (const member of bodyList) {
          if (!isNode(member) || member.type !== 'MethodDefinition') continue
          const key = nodeProp(member, 'key')
          if (!isNode(key)) continue
          const name = identifierName(key)
          if (name === undefined || name === 'constructor') continue
          symbols.push({
            id: 0,
            fullName: `${namespace}.${name}`,
            name,
            namespace,
            kind: SymbolKind.Method,
            line: nodeLine(key),
            column: nodeColumn(key),
            fileId: 0,
            sourceFileId: 0,
            sourceLang: 'js',
          })
        }
      }
    })
    return { symbols, references, unresolvedMixins: [], errors: [] }
  }

  private namespaceFromObject(filePath: string, serviceObject: AstNode): string {
    const name = literalString(findObjectPropertyValue(serviceObject, 'name')) ?? ''
    const version = literalNumber(findObjectPropertyValue(serviceObject, 'version')) ?? 0
    if (name.length === 0) {
      return mixinNamespaceFromPath(filePath)
    }
    return version > 0 ? `v${version}.${name}` : name
  }

  private extractRequireMap(ast: AstNode): Map<string, string> {
    const requireMap = new Map<string, string>()
    walkAst(ast, (node) => {
      if (node.type !== 'VariableDeclarator') {
        return
      }
      const id = identifierName(nodeProp(node, 'id'))
      const init = nodeProp(node, 'init')
      if (id === undefined || !isRequireCall(init)) {
        return
      }
      const requirePath = firstStringArgument(init)
      if (requirePath !== undefined) {
        requireMap.set(id, requirePath)
      }
    })
    return requireMap
  }

  private extractMixins(serviceObject: AstNode, filePath: string, requireMap: Map<string, string>): UnresolvedMixin[] {
    const mixinsValue = findObjectPropertyValue(serviceObject, 'mixins')
    return arrayElements(mixinsValue).flatMap((element) => {
      const mixinName = identifierName(element)
      if (mixinName === undefined) {
        return []
      }
      return [{
        mixinName,
        requirePath: requireMap.get(mixinName) ?? '',
        sourceFile: filePath,
      }]
    })
  }

  private extractSymbols(serviceObject: AstNode, namespace: string): Symbol[] {
    const blocks: Array<[string, SymbolKind]> = [
      ['actions', SymbolKind.Action],
      ['events', SymbolKind.Event],
      ['methods', SymbolKind.Method],
      ['channels', SymbolKind.Channel],
    ]
    return blocks.flatMap(([blockName, kind]) => {
      const block = findObjectPropertyValue(serviceObject, blockName)
      return objectProperties(block).flatMap((property) => {
        const name = propertyName(property)
        if (name === undefined || name === 'handler') {
          return []
        }
        return [{
          id: 0,
          name,
          fullName: `${namespace}.${name}`,
          namespace,
          kind,
          fileId: 0,
          sourceFileId: 0,
          line: nodeLine(property),
          column: propertyKeyColumn(property),
          sourceLang: 'moleculerjs',
        }]
      })
    })
  }

  private extractReferences(ast: AstNode): Reference[] {
    const references: Reference[] = []
    walkAst(ast, (node) => {
      if (node.type !== 'CallExpression') {
        return
      }
      const callee = nodeProp(node, 'callee')
      if (!isNode(callee) || callee.type !== 'MemberExpression') {
        return
      }
      const memberName = memberPropertyName(callee)
      if (memberName === undefined) {
        return
      }

      if (memberName === 'call' || memberName === 'emit' || memberName === 'broadcast') {
        const target = firstStringArgument(node)
        if (target === undefined || !isMoleculerCaller(nodeProp(callee, 'object'))) {
          return
        }
        references.push({
          fullName: target,
          location: argumentLocation(node),
          kind: referenceKind(memberName),
        })
        return
      }

      const object = nodeProp(callee, 'object')
      if (isNode(object) && object.type === 'ThisExpression' && !thisExclusions.has(memberName)) {
        const prop = nodeProp(callee, 'property')
        const locNode = isNode(prop) ? prop : callee
        references.push({
          fullName: `__self__.${memberName}`,
          location: {
            fileId: 0,
            line: nodeLine(locNode),
            column: nodeColumn(locNode),
          },
          kind: ReferenceKind.Call,
        })
      }

      // this.obj.method() — chained member access (e.g. this.client.processEvent())
      if (isNode(object) && object.type === 'MemberExpression') {
        const innerObject = nodeProp(object, 'object')
        const intermediary = memberPropertyName(object)
        if (isNode(innerObject) && innerObject.type === 'ThisExpression'
          && intermediary !== undefined && !thisExclusions.has(intermediary)) {
          const prop = nodeProp(callee, 'property')
          const locNode = isNode(prop) ? prop : callee
          references.push({
            fullName: `__self__.${memberName}`,
            location: {
              fileId: 0,
              line: nodeLine(locNode),
              column: nodeColumn(locNode),
            },
            kind: ReferenceKind.Call,
          })
        }
      }
    })
    return references
  }

  private extractHookReferences(serviceObject: AstNode): Reference[] {
    const references: Reference[] = []
    const hooksValue = findObjectPropertyValue(serviceObject, 'hooks')
    if (hooksValue === undefined) {
      return references
    }
    for (const phase of ['before', 'after', 'error']) {
      const phaseValue = findObjectPropertyValue(hooksValue, phase)
      if (phaseValue === undefined) {
        continue
      }
      for (const actionProp of objectProperties(phaseValue)) {
        const hookValue = propertyValue(actionProp)
        if (hookValue === undefined) {
          continue
        }
        if (hookValue.type === 'ArrayExpression') {
          for (const element of arrayElements(hookValue)) {
            const methodName = literalString(element)
            if (methodName !== undefined && methodName.length > 0 && !methodName.includes('.')) {
              references.push({
                fullName: `__self__.${methodName}`,
                location: { fileId: 0, line: nodeLine(element), column: nodeColumn(element) },
                kind: ReferenceKind.Call,
              })
            }
          }
        } else {
          const methodName = literalString(hookValue)
          if (methodName !== undefined && methodName.length > 0 && !methodName.includes('.')) {
            references.push({
              fullName: `__self__.${methodName}`,
              location: { fileId: 0, line: nodeLine(hookValue), column: nodeColumn(hookValue) },
              kind: ReferenceKind.Call,
            })
          }
        }
      }
    }
    return references
  }
}

function mixinNamespaceFromPath(filePath: string): string {
  const base = filePath.split('/').pop() ?? ''
  const stem = base.replace(/\.mixins?\.js$/, '').replace(/\.js$/, '')
  // Use a simple hash of the full path to disambiguate files with the same basename
  let hash = 0
  for (let i = 0; i < filePath.length; i++) {
    hash = ((hash << 5) - hash + filePath.charCodeAt(i)) | 0
  }
  const tag = Math.abs(hash).toString(36)
  return `__mixin_${stem}_${tag}__`
}

function emptyResult(): ParseResult {
  return {
    symbols: [],
    references: [],
    unresolvedMixins: [],
    errors: [],
  }
}

function findModuleExportsObject(ast: AstNode): AstNode | undefined {
  let found: AstNode | undefined
  walkAst(ast, (node) => {
    if (found !== undefined || node.type !== 'AssignmentExpression') {
      return
    }
    const left = nodeProp(node, 'left')
    const right = nodeProp(node, 'right')
    if (isModuleExports(left) && isNode(right) && right.type === 'ObjectExpression') {
      found = right
    }
  })
  return found
}

function isModuleExports(value: unknown): boolean {
  if (!isNode(value) || value.type !== 'MemberExpression') {
    return false
  }
  return identifierName(nodeProp(value, 'object')) === 'module' && memberPropertyName(value) === 'exports'
}

function findObjectPropertyValue(objectNode: AstNode, name: string): AstNode | undefined {
  for (const property of objectProperties(objectNode)) {
    if (propertyName(property) === name) {
      return propertyValue(property)
    }
  }
  return undefined
}

function propertyKeyColumn(property: AstNode): number {
  const key = nodeProp(property, 'key')
  return isNode(key) ? nodeColumn(key) : nodeColumn(property)
}

function isRequireCall(value: unknown): value is AstNode {
  if (!isNode(value) || value.type !== 'CallExpression') {
    return false
  }
  return identifierName(nodeProp(value, 'callee')) === 'require'
}

function firstStringArgument(callNode: AstNode): string | undefined {
  const args = nodeProp(callNode, 'arguments')
  if (!Array.isArray(args)) {
    return undefined
  }
  return literalString(args[0])
}

function firstArgumentNode(callNode: AstNode): AstNode | undefined {
  const args = nodeProp(callNode, 'arguments')
  return Array.isArray(args) && isNode(args[0]) ? args[0] : undefined
}

function memberPropertyName(memberExpression: AstNode): string | undefined {
  return identifierName(nodeProp(memberExpression, 'property')) ?? literalString(nodeProp(memberExpression, 'property'))
}

function isMoleculerCaller(value: unknown): boolean {
  if (!isNode(value)) {
    return false
  }
  const direct = identifierName(value)
  if (direct === 'ctx' || direct === 'broker') {
    return true
  }
  if (value.type !== 'MemberExpression') {
    return false
  }
  const object = nodeProp(value, 'object')
  const prop = memberPropertyName(value)
  // this.broker
  if (isNode(object) && object.type === 'ThisExpression' && prop === 'broker') {
    return true
  }
  // ctx.broker
  if (identifierName(object) === 'ctx' && prop === 'broker') {
    return true
  }
  return false
}

function referenceKind(methodName: string): ReferenceKind {
  if (methodName === 'emit') {
    return ReferenceKind.Emit
  }
  if (methodName === 'broadcast') {
    return ReferenceKind.Broadcast
  }
  return ReferenceKind.Call
}

function argumentLocation(callNode: AstNode): { fileId: number; line: number; column: number } {
  const firstArg = firstArgumentNode(callNode)
  return {
    fileId: 0,
    line: firstArg === undefined ? nodeLine(callNode) : nodeLine(firstArg),
    column: firstArg === undefined ? nodeColumn(callNode) : nodeColumn(firstArg),
  }
}
