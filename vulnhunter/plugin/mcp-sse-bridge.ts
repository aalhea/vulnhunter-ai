/**
 * dsh-vulnhunter · mcp-sse-bridge
 *
 * 官方 @deepseek-ai/dsh-mcp-client 只支持 stdio / streamable-http 两种传输；
 * 本插件补上旧版 HTTP+SSE（legacy SSE）传输，让 Yakit MCP、first-miniapp 等
 * 只暴露 `/sse` 端点的服务可以直接接入 dsh。
 *
 * 契约与上游 mcp-client 对齐：
 * - 工具注册为 `mcp__<serverName>__<rawName>`，名字是 (serverName, rawName) 的纯函数；
 * - 断线自动重连：指数退避，连续失败 maxAttempts 次后放弃并注销工具；
 * - `notifications/tools/list_changed` 触发重同步；同步串行化避免两代交错；
 * - effect 作用域清理：dispose 断开连接并注销全部工具（HMR 热替换安全）。
 *
 * 有意做减法（相对上游）：不做图片入库投影、不支持 stdio、不校验 outputSchema ——
 * 文本类结果直接投影为 text block，图片等富内容以占位符呈现且原始数据保留在
 * canonical value 里供 Code Mode 使用。
 *
 * @module dsh-vulnhunter/mcp-sse-bridge
 */

import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import zSchema from '@deepseek-ai/schemastery'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { ListToolsResultSchema, ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-tools'

/** Cordis 插件名（loader 诊断用）。 */
export const name = 'mcp-sse-bridge'

/** 需要的前置服务：工具注册表。 */
export const inject = ['tools']

/** 单次工具调用默认超时（ms）。 */
const DEFAULT_TOOL_CALL_TIMEOUT_MS = 60_000

/** 合法 serverName，控制在公共工具名长度预算内。 */
const SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/

// ---- 配置 ----

/** 重连策略。 */
export interface ReconnectConfig {
  /** 断线后是否自动重连（默认 true）。 */
  enabled?: boolean
  /** 首次重连延迟 ms，之后逐次翻倍（默认 500）。 */
  initialDelayMs?: number
  /** 退避上限 ms；连接稳定超过该时长会重置失败计数（默认 30000）。 */
  maxDelayMs?: number
  /** 一轮断线内最大连续失败次数，超过即放弃并注销工具（默认 10）。 */
  maxAttempts?: number
}

/** 插件配置。 */
export interface Config {
  /** 工具名命名空间 `mcp__<serverName>__*`，全局唯一。 */
  serverName: string
  /** 旧版 SSE 端点，如 `http://127.0.0.1:11432/sse`。 */
  url: string
  /** 附加请求头（同时作用于 SSE 握手与 POST 消息）。 */
  headers: Record<string, string>
  /** 单次工具调用超时 ms。 */
  toolCallTimeoutMs: number
  /** 初始连接或首次工具同步失败时是否让插件加载失败。 */
  failOnStartupError: boolean
  /** 重连策略；缺省用内置默认。 */
  reconnect?: ReconnectConfig
}

const TIMER_LIMIT_MS = 2_147_483_647

const Reconnect: zSchema<ReconnectConfig> = zSchema.object({
  enabled: zSchema.boolean().default(true),
  initialDelayMs: zSchema.number().min(1).max(TIMER_LIMIT_MS).default(500),
  maxDelayMs: zSchema.number().min(1).max(TIMER_LIMIT_MS).default(30_000),
  maxAttempts: zSchema.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(10),
})

export const Config: zSchema<Config> = zSchema.object({
  serverName: zSchema.string().required().pattern(SERVER_NAME_PATTERN),
  url: zSchema.string().required(),
  headers: zSchema.dict(String).default({}),
  toolCallTimeoutMs: zSchema.number().min(1).max(TIMER_LIMIT_MS).default(DEFAULT_TOOL_CALL_TIMEOUT_MS),
  failOnStartupError: zSchema.boolean().default(false),
  reconnect: Reconnect,
}) as unknown as zSchema<Config>

type ResolvedPolicy = Required<ReconnectConfig>

function resolvePolicy(config: ReconnectConfig | undefined, label: string): ResolvedPolicy {
  const resolved = {
    enabled: config?.enabled ?? true,
    initialDelayMs: config?.initialDelayMs ?? 500,
    maxDelayMs: config?.maxDelayMs ?? 30_000,
    maxAttempts: config?.maxAttempts ?? 10,
  }
  if (resolved.initialDelayMs > resolved.maxDelayMs) {
    throw new Error(`${label}: reconnect.initialDelayMs 不能大于 maxDelayMs`)
  }
  return resolved
}

// ---- 工具名 ----

const MAX_PUBLIC_NAME_LENGTH = 64
const INVALID_NAME_CHARS = /[^A-Za-z0-9_-]/g
const HASH_LENGTH = 12

/**
 * 公共工具名是 (serverName, rawName) 的确定性纯函数；规范化造成信息丢失时
 * 追加 12 位十六进制身份哈希，保证不同 MCP 身份永不重名。
 */
function publicToolName(serverName: string, rawName: string): string {
  const joined = `mcp__${serverName}__${rawName}`
  const normalized = joined.replace(INVALID_NAME_CHARS, '_')
  if (normalized === joined && normalized.length <= MAX_PUBLIC_NAME_LENGTH) return normalized
  const hash = createHash('sha256').update(`${serverName}\0${rawName}`).digest('hex').slice(0, HASH_LENGTH)
  return `${normalized.slice(0, MAX_PUBLIC_NAME_LENGTH - HASH_LENGTH - 1)}_${hash}`
}

// ---- 结果投影 ----

/** 宽松的 tools/call 结果校验：结构合法性由本桥自检，不依赖 SDK 的严格 schema。 */
const LooseCallToolResult = z.record(z.string(), z.unknown())

/** 暴露给 Code Mode 的 canonical 值：保留原始 MCP content 数组。 */
interface McpResult {
  content: unknown[]
  structuredContent?: unknown
}

/** 网络信任边界：MCP 声明必填的字段在运行时可能缺失，一律带兜底读取。 */
interface ContentBlockLike {
  type?: string
  text?: string
  mimeType?: string
  data?: string
  name?: string
  uri?: string
}

/** 把 MCP content 数组折叠成单个文本串（占位符替代非文本块）。 */
function textOf(content: unknown[], toolName: string): string {
  const parts: string[] = []
  for (const value of content) {
    const block = (typeof value === 'object' && value !== null ? value : {}) as ContentBlockLike
    switch (block.type) {
      case 'text':
        if (block.text !== undefined) parts.push(block.text)
        break
      case 'image':
        parts.push(`[image unavailable: ${block.mimeType ?? 'unknown media type'}; raw data remains in canonical value]`)
        break
      case 'resource_link':
        parts.push(`Resource link: ${block.name ?? '(unnamed)'} (${block.uri ?? 'missing uri'})`)
        break
      case 'audio':
      case 'resource':
        parts.push(`[${block.type} content unsupported; raw data remains in canonical value]`)
        break
      default:
        parts.push(`[unsupported MCP content type: ${String(block.type)}]`)
    }
  }
  const text = parts.join('\n')
  return text.length > 0 ? text : `(${toolName} returned no model-visible content)`
}

// ---- 工具桥接 ----

type Disposers = Map<string, () => void>

/** 从 MCP inputSchema 构造 ToolRuntime parameters，防御性兜底空对象 schema。 */
function sanitizeParameters(candidate: unknown): Record<string, unknown> {
  if (typeof candidate === 'object' && candidate !== null && !Array.isArray(candidate)) {
    return candidate as Record<string, unknown>
  }
  return { type: 'object', properties: {}, additionalProperties: true }
}

function createDefinition(
  client: Client,
  publicName: string,
  rawName: string,
  description: string,
  inputSchema: unknown,
  toolCallTimeoutMs: number,
): ToolDefinition {
  const definition: ToolDefinition = {
    name: publicName,
    description,
    parameters: sanitizeParameters(inputSchema),
    output: {
      schema: {
        type: 'object',
        properties: { content: { type: 'array', items: {} }, structuredContent: {} },
        required: ['content'],
        additionalProperties: false,
      },
      render(_args: unknown, value: unknown): { type: 'text'; text: string }[] {
        const result = (typeof value === 'object' && value !== null ? value : {}) as Partial<McpResult>
        const content = Array.isArray(result.content) ? result.content : []
        return [{ type: 'text', text: textOf(content, rawName) }]
      },
    },
    async execute(args: unknown, exec: { signal: AbortSignal }) {
      // 模型可能输出非对象参数；回退 {} 让服务端给出具体的"缺少参数"错误供模型学习。
      const argsObj = (typeof args === 'object' && args !== null ? args : {}) as Record<string, unknown>
      const result = (await client.request(
        { method: 'tools/call', params: { name: rawName, arguments: argsObj } },
        LooseCallToolResult,
        { signal: exec.signal, timeout: toolCallTimeoutMs },
      )) as {
        content?: unknown
        structuredContent?: unknown
        isError?: boolean
        toolResult?: unknown
      }

      // 兼容旧式 toolResult 形状。
      if (!Array.isArray(result.content)) {
        const text = 'toolResult' in result ? JSON.stringify(result.toolResult) : '(no output)'
        if (result.isError === true) throw new Error(text)
        return { content: [{ type: 'text', text }] }
      }

      const content = result.content as unknown[]
      if (result.isError === true) throw new Error(textOf(content, rawName))
      const value: McpResult = { content }
      if (result.structuredContent !== undefined) value.structuredContent = result.structuredContent
      return value
    },
  }
  return definition
}

/** 分页拉取完整工具清单（绕过 SDK 的逐页校验缓存）。 */
async function listAllTools(client: Client) {
  const tools: { name: string; description?: string; inputSchema?: unknown }[] = []
  let cursor: string | undefined
  do {
    const response = await client.request(
      { method: 'tools/list', ...(cursor === undefined ? {} : { params: { cursor } }) },
      ListToolsResultSchema,
    )
    tools.push(...response.tools)
    cursor = response.nextCursor
  } while (cursor)
  return tools
}

/**
 * 两阶段同步：先取全量构建下一代定义（任何失败都保持上一代原样），再整体换装。
 * 注册冲突意味着有外来注册占了本服务的命名空间——整代回滚，绝不留半套。
 */
async function syncTools(
  client: Client,
  ctx: Context,
  label: string,
  serverName: string,
  toolCallTimeoutMs: number,
  previous: Disposers,
): Promise<Disposers> {
  const definitions = new Map<string, ToolDefinition>()
  for (const tool of await listAllTools(client)) {
    const publicName = publicToolName(serverName, tool.name)
    if (definitions.has(publicName)) {
      throw new Error(`${label}: 服务端重复列出工具 "${tool.name}" —— 无效工具清单`)
    }
    definitions.set(publicName, createDefinition(
      client, publicName, tool.name, tool.description ?? '', tool.inputSchema, toolCallTimeoutMs,
    ))
  }
  for (const dispose of previous.values()) dispose()
  const disposers: Disposers = new Map()
  try {
    for (const [publicName, definition] of definitions) {
      disposers.set(publicName, ctx.tools.register(definition))
    }
  } catch (error) {
    for (const dispose of disposers.values()) dispose()
    ctx.logger.error(`${label}: 工具注册失败，本代全部未注册: ${String(error)}`)
    return new Map()
  }
  return disposers
}

// ---- 传输 ----

/**
 * 构造旧版 SSE 传输。无附加头时走最简路径；带鉴权头时 POST 消息走 requestInit，
 * SSE 长连接流经自定义 fetch 注入——SDK 的 EventSourceInit 类型未声明 fetch 槽位，
 * 但其内部 EventSource 实现会消费该字段，故此处做一次局部类型豁免。
 */
function createTransport(config: Config): SSEClientTransport {
  const url = new URL(config.url)
  if (Object.keys(config.headers).length === 0) return new SSEClientTransport(url)
  const patchedFetch: typeof fetch = async (input, init) => {
    const incoming = init?.headers
    const merged = new Headers(
      incoming instanceof Headers
        ? Object.fromEntries(incoming)
        : (incoming as ConstructorParameters<typeof Headers>[0] | undefined),
    )
    for (const [key, value] of Object.entries(config.headers)) merged.set(key, value)
    return fetch(input, { ...init, headers: merged })
  }
  return new SSEClientTransport(url, {
    requestInit: { headers: { ...config.headers } },
    eventSourceInit: { fetch: patchedFetch } as unknown as EventSourceInit,
  })
}

// ---- 连接监督 ----

interface ConnectionHandle {
  ready: Promise<{ error?: unknown }>
  dispose(): Promise<void>
}

function startSupervision(ctx: Context, config: Config, policy: ResolvedPolicy): ConnectionHandle {
  const label = `mcp-sse-bridge(${config.serverName})`
  let disposed = false
  /** 当前代的客户端；退避等待期与最终放弃后为 undefined。 */
  let client: Client | undefined
  /** 本服务当前存活的注册项。 */
  let disposers: Disposers = new Map()
  let reconnectTimer: NodeJS.Timeout | undefined
  let failedAttempts = 0
  let connectedAt: number | undefined
  let firstAttemptError: unknown

  const isCurrent = (generation: Client): boolean => !disposed && client === generation

  /** 所有 syncTools 调用串行化，防止两代交换交错导致双重注销/泄漏。 */
  let syncChain: Promise<void> = Promise.resolve()
  function enqueueSync(generation: Client): Promise<void> {
    const run = syncChain.then(async () => {
      if (!isCurrent(generation)) return
      disposers = await syncTools(generation, ctx, label, config.serverName, config.toolCallTimeoutMs, disposers)
    })
    syncChain = run.catch(() => {})
    return run
  }

  function scheduleReconnect(): void {
    const lostEstablished = connectedAt !== undefined
    // 稳定运行超过一个退避窗口视为新一轮断线：重置预算，避免偶发抖动耗尽额度。
    if (connectedAt !== undefined && Date.now() - connectedAt >= policy.maxDelayMs) failedAttempts = 0
    connectedAt = undefined
    failedAttempts += 1
    if (!policy.enabled) {
      ctx.logger.error(`${label}: 连接${lostEstablished ? '丢失' : '失败'}且重连已禁用 —— 请 reload 插件或重启 Host`)
      return
    }
    if (failedAttempts > policy.maxAttempts) {
      syncChain = syncChain.then(() => {
        for (const dispose of disposers.values()) dispose()
        disposers = new Map()
      })
      ctx.logger.error(`${label}: 连续 ${policy.maxAttempts} 次重连失败，放弃 —— 工具已注销；reload 插件或重启 Host 可恢复`)
      return
    }
    const delayMs = Math.min(policy.maxDelayMs, policy.initialDelayMs * 2 ** (failedAttempts - 1))
    ctx.logger.warn(`${label}: ${lostEstablished ? '连接丢失' : '连接失败'}，${delayMs}ms 后重试 (${failedAttempts}/${policy.maxAttempts})`)
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined
      void connect()
    }, delayMs)
    reconnectTimer.unref?.()
  }

  async function connect(): Promise<void> {
    const generation = new Client({ name: 'dsh-mcp-sse-bridge', version: '0.1.0' }, { capabilities: {} })
    client = generation
    let settled = false
    let closedObserved = false
    generation.onclose = () => {
      closedObserved = true
      // 连接尝试尚未落定时由 catch/收尾路径统一处理，避免竞态双重调度。
      if (settled) {
        if (isCurrent(generation)) {
          client = undefined
          scheduleReconnect()
        }
      }
    }
    // 先挂通知处理器再 connect：初始同步期间到达的 list_changed 排在其后而非丢失。
    generation.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
      if (!isCurrent(generation)) return
      ctx.logger.info(`${label}: 工具清单变化，重新同步`)
      try {
        await enqueueSync(generation)
      } catch (error) {
        // 拉取阶段失败：上一代仍注册在册，继续服务最后一份可用清单。
        if (!disposed) ctx.logger.error(`${label}: 工具重同步失败: ${String(error)}`)
      }
    })
    try {
      await generation.connect(createTransport(config))
      if (closedObserved) {
        settled = true
        if (isCurrent(generation)) {
          client = undefined
          scheduleReconnect()
        }
        return
      }
      await enqueueSync(generation)
    } catch (error) {
      if (firstAttemptError === undefined) firstAttemptError = error
      if (isCurrent(generation)) ctx.logger.warn(`${label}: 连接尝试失败: ${String(error)}`)
      try { await generation.close() } catch { /* 传输层已消失 */ }
      settled = true
      if (!isCurrent(generation)) return
      client = undefined
      scheduleReconnect()
      return
    }
    settled = true
    if (closedObserved) {
      if (isCurrent(generation)) {
        client = undefined
        scheduleReconnect()
      }
      return
    }
    if (!isCurrent(generation)) return
    connectedAt = Date.now()
    if (failedAttempts > 0) {
      ctx.logger.info(`${label}: 已重连并重新同步工具 (${failedAttempts}/${policy.maxAttempts})`)
    }
  }

  const settling: Promise<void> = connect()

  const ready: Promise<{ error?: unknown }> = settling.then(() => (
    client !== undefined ? {} : { error: firstAttemptError ?? new Error(`${label}: 初始连接失败`) }
  ))

  return {
    ready,
    async dispose(): Promise<void> {
      disposed = true
      if (reconnectTimer !== undefined) {
        clearTimeout(reconnectTimer)
        reconnectTimer = undefined
      }
      const current = client
      client = undefined
      if (current !== undefined) {
        try { await current.close() } catch { /* 传输层已消失 */ }
      }
      // 等待排队中的同步排干，保证 disposers 终值稳定后再统一注销。
      await settling
      await syncChain
      for (const dispose of disposers.values()) dispose()
      disposers = new Map()
    },
  }
}

// ---- 插件入口 ----

/** 进程级 serverName 占用表：按 ctx.root 隔离，重名在加载期报错而非静默遮蔽。 */
const activeServerNames = new WeakMap<Context, Set<string>>()

/**
 * 连接一个旧版 SSE MCP 服务并把其工具发布到 ctx.tools。
 * 初始连接 + 首次工具同步完成后插件才算激活完成；failOnStartupError 决定
 * 失败时是拒绝激活还是进入重连循环。
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const label = `mcp-sse-bridge(${config.serverName})`
  const policy = resolvePolicy(config.reconnect, label)

  // 加载期报错的重名冲突：不影响先到的实例。
  ctx.effect(() => {
    let names = activeServerNames.get(ctx.root)
    if (!names) {
      names = new Set()
      activeServerNames.set(ctx.root, names)
    }
    if (names.has(config.serverName)) {
      throw new Error(`${label}: serverName "${config.serverName}" 已被另一个实例占用 —— 请在 cordis.yml 里改用唯一 serverName`)
    }
    names.add(config.serverName)
    return () => void names.delete(config.serverName)
  }, 'mcp-sse-bridge.serverName')

  const connection = startSupervision(ctx, config, policy)

  ctx.effect(() => () => void connection.dispose(), 'mcp-sse-bridge.connection')

  const outcome = await connection.ready
  if (outcome.error !== undefined && config.failOnStartupError) {
    throw new Error(`${label}: 初始连接或工具同步失败`, { cause: outcome.error })
  }
}
