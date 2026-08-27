/**
 * 本地工具定义转换器。
 *
 * 为什么不用 @deepseek-ai/dsh-tools 的 defineTool：它的 output.schema 走自研
 * "value schema DSL"，不支持 required 等标准 JSON Schema 关键字；而本插件的
 * 输出契约与上游 dsh-mcp-client 一致（canonical 值 + 原生 JSON Schema）。
 * 上游 mcp-client 同样绕过 defineTool、直接构造 ToolDefinition 注册 —— 本文件
 * 只是把「参数简写 → 标准 JSON Schema」的样板集中到一处。
 */

import type { ToolDefinition } from '@deepseek-ai/dsh-tools'

/** 参数简写规格。 */
export interface VhParam {
  type: 'string' | 'number' | 'boolean' | 'array'
  description: string
  required?: boolean
}

type InferOne<P extends VhParam> =
  P['type'] extends 'array' ? string[]
  : P['type'] extends 'number' ? number
  : P['type'] extends 'boolean' ? boolean
  : string

/** 由参数简写推导 execute 的 args 类型；未标 required 的字段带 undefined。 */
export type InferArgs<P extends Record<string, VhParam>> = {
  [K in keyof P]-?: P[K]['required'] extends true ? InferOne<P[K]> : InferOne<P[K]> | undefined
}

export interface VhToolDef<P extends Record<string, VhParam>> {
  name: string
  description: string
  parameters: P
  output: {
    /** 原生 JSON Schema（描述 canonical 返回值），原样透传给 ToolRuntime。 */
    schema: Record<string, unknown>
    render: (args: unknown, value: unknown) => Array<{ type: 'text'; text: string }>
  }
  execute: (args: InferArgs<P>, exec: { signal: AbortSignal }) => Promise<unknown>
}

/** 组装标准 ToolDefinition：参数简写 → JSON Schema，其余原样透传。 */
export function vhDefineTool<P extends Record<string, VhParam>>(def: VhToolDef<P>): ToolDefinition {
  const properties: Record<string, unknown> = {}
  const required: string[] = []
  for (const [key, param] of Object.entries(def.parameters)) {
    properties[key] = param.type === 'array'
      ? { type: 'array', items: { type: 'string' }, description: param.description }
      : { type: param.type, description: param.description }
    if (param.required === true) required.push(key)
  }
  return {
    name: def.name,
    description: def.description,
    parameters: {
      type: 'object',
      properties,
      ...(required.length > 0 ? { required } : {}),
      additionalProperties: false,
    },
    output: def.output,
    execute: def.execute as ToolDefinition['execute'],
  }
}
