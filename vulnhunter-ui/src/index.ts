/**
 * Host loader entry for the vulnhunter UI plugin.
 * Registers HTTP routes for the vulnhunter data service (targets, skills,
 * env, state, artifacts) by reading from the dsh-vulnhunter project directory.
 */
import { access, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { connect } from 'node:net'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Dirent } from 'node:fs'
import { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'

/** Routes the vulnhunter data service registers. */
const VULNHUNTER_API_PREFIX = '/vulnhunter-api'

/** Plugin config. */
export interface Config {
  /** Root path to the dsh-vulnhunter project directory. */
  vulnhunterRoot: string
  /** Tools directory for CLI existence checks. */
  toolsRoot?: string
}

/** Name of the services this plugin injects. */
export const inject = ['webServer']

/** Reads the vulnhunter data directory and registers HTTP routes.
 * @param ctx - Host plugin context.
 * @param config - Plugin config with paths to vulnhunter data.
 */
export function apply(ctx: Context, config: Config): void {
  const root = config.vulnhunterRoot
  const artifactsDir = join(root, 'demo', 'artifacts')
  const skillsDir = join(root, 'skills')
  const toolsRoot = config.toolsRoot ?? '<TOOLS_DIR>'
  const policyFile = join(root, 'config', 'ui-tools.json')

  /** Static catalog of the dsh-vulnhunter tool layer (mirrors src/{ledger,recontools,pipeline}.ts). */
  const TOOL_CATALOG = [
    { name: 'ledger_add', group: '账本', desc: '向攻击面账本新增记录' },
    { name: 'ledger_update', group: '账本', desc: '更新条目状态/证据/备注' },
    { name: 'ledger_state', group: '账本', desc: '读回目标账本全量' },
    { name: 'vuln_report', group: '报告', desc: '按严重性生成漏洞报告' },
    { name: 'recon_pipeline', group: '侦察', desc: '五步流水线编排（断点续跑）' },
    { name: 'recon_status', group: '侦察', desc: '流水线运行历史与结论' },
    { name: 'recon_enscan', group: '侦察', desc: '公司资产测绘' },
    { name: 'recon_amass', group: '侦察', desc: '被动子域枚举' },
    { name: 'recon_gogo', group: '侦察', desc: '端口扫描 + 服务指纹' },
    { name: 'recon_httpx', group: '侦察', desc: '存活探测 + Web 指纹' },
    { name: 'recon_intel', group: '侦察', desc: 'fofa/shodan 被动情报' },
  ] as const

  /** Tool governance state persisted next to the vulnhunter project. */
  interface ToolPolicy { disabled: string[]; instructions: Record<string, string> }

  const readPolicy = async (): Promise<ToolPolicy> => {
    try {
      const raw = await readFile(policyFile, 'utf8')
      const parsed = JSON.parse(raw) as Partial<ToolPolicy>
      return {
        disabled: Array.isArray(parsed.disabled) ? parsed.disabled.filter(s => typeof s === 'string') : [],
        instructions: parsed.instructions !== undefined && typeof parsed.instructions === 'object'
          ? Object.fromEntries(Object.entries(parsed.instructions).filter(([, v]) => typeof v === 'string'))
          : {},
      }
    } catch { return { disabled: [], instructions: {} } }
  }

  const writePolicy = async (policy: ToolPolicy): Promise<void> => {
    await mkdir(join(root, 'config'), { recursive: true })
    await writeFile(policyFile, `${JSON.stringify(policy, null, 2)}\n`, 'utf8')
  }

  /** List targets from artifacts directory. */
  const listTargets = async (): Promise<readonly Record<string, unknown>[]> => {
    const entries: Record<string, unknown>[] = []
    let dir: string[]
    try {
      dir = await readdir(artifactsDir)
    } catch { return [] }
    for (const target of dir) {
      const statePath = join(artifactsDir, target, 'state.json')
      try {
        const raw = await readFile(statePath, 'utf8')
        const state = JSON.parse(raw) as { ledger?: unknown[]; runs?: unknown[] }
        const ledger = (state.ledger ?? []) as { status?: string }[]
        const runs = (state.runs ?? []) as { startedAt?: string }[]
        const lastRun = runs.length > 0 ? runs[runs.length - 1]?.startedAt ?? '' : ''
        entries.push({
          target,
          ledger: ledger.length,
          confirmed: ledger.filter(i => i.status === '已证实').length,
          runs: runs.length,
          lastRun,
        })
      } catch { /* skip targets without state.json */ }
    }
    return entries
  }

  /** Check if a file exists. */
  const fileExists = async (p: string): Promise<boolean> => {
    try { await access(p); return true } catch { return false }
  }

  /** Check if a TCP port is open (for MCP service probes). */
  const portOpen = (port: number): Promise<boolean> =>
    new Promise(resolve => {
      const s = connect(port, '127.0.0.1')
      s.once('connect', () => { s.destroy(); resolve(true) })
      s.once('error', () => resolve(false))
      s.setTimeout(1200, () => { s.destroy(); resolve(false) })
    })

  /** Build environment status. */
  const envCheck = async (): Promise<Record<string, unknown>> => {
    const toolNames = ['enscan', 'amass', 'gogo', 'httpx']
    const tools = await Promise.all(toolNames.map(async name => {
      const path = join(toolsRoot, name, `${name}.exe`)
      const ok = await fileExists(path)
      return { name, ok, path }
    }))
    const [yakit, miniapp, dshWeb] = await Promise.all([11432, 4554, 3080].map(portOpen))
    return {
      tools,
      services: [
        { name: 'dsh web', ok: dshWeb, note: '127.0.0.1:3080' },
        { name: 'yakit mcp', ok: yakit, note: '127.0.0.1:11432/sse' },
        { name: 'first-miniapp mcp', ok: miniapp, note: '127.0.0.1:4554/sse' },
      ],
      keys: {
        fofa: Boolean(process.env.FOFA_KEY),
        shodan: Boolean(process.env.SHODAN_KEY),
        deepseek: Boolean(process.env.DEEEPSEEK_API_KEY ?? process.env.DEEPSEEK_API_KEY),
      },
    }
  }

  /** Read and parse a target's state.json. */
  const readState = async (target: string): Promise<Record<string, unknown> | null> => {
    const safeTarget = target.replace(/[^A-Za-z0-9_-]/g, '_')
    const statePath = join(artifactsDir, safeTarget, 'state.json')
    try {
      const raw = await readFile(statePath, 'utf8')
      return JSON.parse(raw) as Record<string, unknown>
    } catch { return null }
  }

  /** List artifacts for a target directory. */
  const listArtifacts = async (target: string): Promise<readonly { file: string; size: number }[]> => {
    const safeTarget = target.replace(/[^A-Za-z0-9_-]/g, '_')
    const targetDir = join(artifactsDir, safeTarget)
    const results: { file: string; size: number }[] = []
    const walk = async (dir: string, prefix: string): Promise<void> => {
      let entries: Dirent[]
      try { entries = await readdir(dir, { withFileTypes: true }) } catch { return }
      for (const entry of entries) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) {
          await walk(full, `${prefix}${entry.name}/`)
        } else {
          const s = await stat(full)
          results.push({ file: `${prefix}${entry.name}`, size: s.size })
        }
      }
    }
    await walk(targetDir, '')
    return results
  }

  /** JSON response helper. */
  const jsonResponse = (res: ServerResponse, data: unknown, status = 200): void => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify(data))
  }

  /** Error response helper. */
  const errorResponse = (res: ServerResponse, message: string, status = 404): void => {
    jsonResponse(res, { error: message }, status)
  }

  /** Route handler: dispatches based on URL path. */
  const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
    const path = url.pathname.slice(VULNHUNTER_API_PREFIX.length)
    const target = url.searchParams.get('target') ?? ''

    try {
      switch (path) {
        case '/tools':
        case '/tools/': {
          const policy = await readPolicy()
          jsonResponse(res, { tools: TOOL_CATALOG, policy })
          break
        }
        case '/tools/policy':
        case '/tools/policy/': {
          if (req.method !== 'POST') { errorResponse(res, 'POST required', 405); break }
          const body = await new Promise<string>((resolve, reject) => {
            const chunks: Buffer[] = []
            let size = 0
            req.on('data', (chunk: Buffer) => {
              size += chunk.length
              if (size > 1_000_000) { reject(new Error('body too large')); req.destroy(); return }
              chunks.push(chunk)
            })
            req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
            req.on('error', reject)
          })
          const patch = JSON.parse(body) as Partial<ToolPolicy>
          const current = await readPolicy()
          const next: ToolPolicy = {
            disabled: Array.isArray(patch.disabled)
              ? patch.disabled.filter(s => typeof s === 'string')
              : current.disabled,
            instructions: patch.instructions !== undefined && typeof patch.instructions === 'object'
              ? Object.fromEntries(Object.entries(patch.instructions).filter(([, v]) => typeof v === 'string'))
              : current.instructions,
          }
          await writePolicy(next)
          jsonResponse(res, { ok: true, policy: next })
          break
        }
        case '/targets':
        case '/targets/': {
          const targets = await listTargets()
          jsonResponse(res, targets)
          break
        }
        case '/skills':
        case '/skills/': {
          let dir: string[]
          try { dir = await readdir(skillsDir) } catch { dir = [] }
          const skills = dir.filter(e => !e.startsWith('.'))
          jsonResponse(res, skills)
          break
        }
        case '/env':
        case '/env/': {
          const env = await envCheck()
          jsonResponse(res, env)
          break
        }
        case '/state':
        case '/state/': {
          if (!target) { errorResponse(res, 'target parameter required', 400); break }
          const state = await readState(target)
          if (!state) { errorResponse(res, 'target not found'); break }
          jsonResponse(res, state)
          break
        }
        case '/artifacts':
        case '/artifacts/': {
          if (!target) { errorResponse(res, 'target parameter required', 400); break }
          const artifacts = await listArtifacts(target)
          jsonResponse(res, artifacts)
          break
        }
        default: {
          errorResponse(res, 'not found', 404)
        }
      }
    } catch (err) {
      jsonResponse(res, { error: String(err) }, 500)
    }
  }

  const route = {
    kind: 'prefix' as const,
    path: VULNHUNTER_API_PREFIX,
    handler,
  }

  ctx.effect(() => ctx.webServer.register(route), 'ui-vulnhunter: data routes')
}