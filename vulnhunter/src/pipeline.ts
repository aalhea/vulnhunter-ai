/**
 * 侦察流水线状态机（方案 §5.A 的 P1 落地）。
 *
 * - 五步链条顺序固定，支持任意选段（steps:"1,2,4"）；缺上游产物时该步失败并
 *   给出明确的补跑提示，绝不凭空编造输入；
 * - 每步运行记录落 state.json（跨会话断点续跑的基础）；
 * - ③→④ 之间的 url-build 是确定性合并：gogo 已判定 URL ∪ 子域裸域名；
 * - 所有步骤与独立 recon_* 工具执行同一套 scope 护栏，出界 fail-closed；
 * - ask/auto/step 三档由 agent 在对话层遵守；工具本身 fail-fast，不静默续跑。
 */

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { extractHost, hostAllowed, ipAllowed, loadScope, type LoadedScope } from './scope.ts'
import { vhDefineTool } from './tooldef.ts'
import { loadState, saveState, type StepRun, type TargetState } from './store.ts'
import { artifactsRootOf, cliPath, readTextIfExists, resolveInvocation, runCli, tail, targetDir, writeArtifact } from './util.ts'
import type { ReconEnv } from './recontools.ts'

/** 步骤依赖声明：选段执行前检查所需输入是否可用。 */
const STEP_DEPS: Record<number, string> = {
  1: '需要 --company',
  2: '需要 --domain',
  3: '需要 --cidrs（scope.cidr 内的 IP/CIDR 清单）',
  4: '自动接力：gogo urls ∪ 子域清单',
  5: '',
}

interface StepOutcome {
  seq: number
  stepId: string
  summary: string
}

/** 合法域名形态；用于把 CLI stdout 里的日志行/表头挡在外面。 */
const DOMAIN_LINE_RE = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/

function toDomainLines(text: string): string[] {
  return text.split('\n').map(s => s.trim().toLowerCase()).filter(s => DOMAIN_LINE_RE.test(s))
}

export function pipelineTools(env: ReconEnv): ToolDefinition[] {
  const root = () => artifactsRootOf(env.artifactsRoot)

  // ---- scope 护栏：流水线与独立工具执行同一套规则，出界 fail-closed ----

  async function currentScope(): Promise<LoadedScope | undefined> {
    if (env.scopeFile.trim() === '') return undefined
    return await loadScope(env.scopeFile)
  }

  function assertHosts(scope: LoadedScope | undefined, hosts: string[]): void {
    const violations = hosts.filter(host => !hostAllowed(scope, host))
    if (violations.length > 0) {
      throw new Error(`scope 护栏拦截：以下目标不在授权范围内（scope=${scope?.path ?? '未配置'}）：${violations.join(', ')}`)
    }
  }

  function assertCidrs(scope: LoadedScope | undefined, cidrs: string[]): void {
    if (cidrs.length === 0) throw new Error('目标清单为空')
    const violations = cidrs.filter(entry => !ipAllowed(scope, entry))
    if (violations.length > 0) {
      throw new Error(`scope 护栏拦截：以下网段不在授权范围内：${violations.join(', ')}`)
    }
  }

  // ---- 各步骤实现（供 recon_pipeline 串行调度）----

  async function runEnscan(company: string, target: string): Promise<StepOutcome> {
    const dir = targetDir(root(), target)
    const artifact = join(dir, '1-company-expand.json')
    const inv = resolveInvocation(env.toolCommands, 'enscan', cliPath(env.toolsDir, 'enscan'), ['-company', company, '-json', '-o', artifact], { company, output: artifact })
    const result = await runCli(inv.cmd, inv.args)
    return { seq: 1, stepId: 'company-expand', summary: tail(`enscan exit=${result.code}\n${tail(result.stdout || result.stderr, 500)}`, 900) }
  }

  async function runSubdomainEnum(domain: string, target: string): Promise<StepOutcome> {
    const scope = await currentScope()
    assertHosts(scope, [domain])
    const dir = targetDir(root(), target)
    // 该版本 amass 无 -o 参数，结果走 stdout —— 由我们落盘；自定义模板可改走任意输出方式。
    const inv = resolveInvocation(env.toolCommands, 'amass', cliPath(env.toolsDir, 'amass'), ['enum', '-passive', '-d', domain], { domain })
    const result = await runCli(inv.cmd, inv.args)
    await writeArtifact(dir, '2-amass-raw.txt', result.stdout)
    if (result.code !== 0 && result.stdout.trim() === '') {
      throw new Error(`amass 失败(exit=${result.code})：${tail(result.stderr, 300)}`)
    }
    const existing = (await readTextIfExists(join(dir, '2-subdomains.txt')))?.split('\n').filter(Boolean) ?? []
    // 根域本身永远是候选：被动源可能一无所获（如 example.com），但根站仍需探活。
    const fresh = [domain.toLowerCase(), ...toDomainLines(result.stdout)]
    // 被动情报源配置了 key 就并入；没配 key 记录降级而不是失败。
    let intelNote = ''
    for (const [source, query] of [
      ['fofa', `domain="${domain}"`],
      ['shodan', `hostname:${domain}`],
    ] as const) {
      const hasKey = source === 'fofa' ? env.fofaEmail !== '' && env.fofaKey !== '' : env.shodanKey !== ''
      if (!hasKey) {
        intelNote += `\n[intel] ${source}: 未配置 key，已跳过`
        continue
      }
      try {
        const hosts = await queryIntel(source, query)
        // 情报命中同样要过白名单，防被动源带回出界资产。
        assertHosts(scope, hosts.map(host => extractHost(host)))
        fresh.push(...hosts)
        intelNote += `\n[intel] ${source}: 命中 ${hosts.length}`
      } catch (error) {
        intelNote += `\n[intel] ${source}: 查询失败已跳过（${String(error)}）`
      }
    }
    const merged = [...new Set([...existing, ...fresh])].sort()
    const mergedFile = await writeArtifact(dir, '2-subdomains.txt', `${merged.join('\n')}\n`)
    return {
      seq: 2,
      stepId: 'subdomain-enum',
      summary: `子域 ${merged.length} 条（新增 ${merged.length - existing.length}）→ ${mergedFile}${intelNote}\n${tail(result.stderr, 300)}`,
    }
  }

  /** 被动情报查询（fofa/shodan 开放 API）。 */
  async function queryIntel(source: 'fofa' | 'shodan', query: string): Promise<string[]> {
    if (source === 'fofa') {
      const response = await fetch(`https://fofa.info/api/v1/search/all?email=${encodeURIComponent(env.fofaEmail)}&key=${encodeURIComponent(env.fofaKey)}&qbase64=${Buffer.from(query).toString('base64')}&fields=host&size=1000`)
      const body = (await response.json()) as { error: boolean; results?: string[][] }
      if (body.error === true) throw new Error('fofa 返回错误')
      return (body.results ?? []).map(row => String(row[0] ?? '').toLowerCase()).filter(Boolean)
    }
    const response = await fetch(`https://api.shodan.io/shodan/host/search?key=${encodeURIComponent(env.shodanKey)}&query=${encodeURIComponent(query)}&minify=true`)
    const body = (await response.json()) as { matches?: Array<{ hostnames?: string[] }> }
    return (body.matches ?? []).flatMap(match => match.hostnames ?? []).map(host => host.toLowerCase())
  }

  async function runPortScan(cidrs: string[], target: string, ports: string | undefined): Promise<StepOutcome> {
    const scope = await currentScope()
    assertCidrs(scope, cidrs)
    const dir = targetDir(root(), target)
    await mkdir(dir, { recursive: true })
    const outBase = join(dir, '3-gogo')
    const inv = resolveInvocation(env.toolCommands, 'gogo', cliPath(env.toolsDir, 'gogo'), ['-i', cidrs.join(','), '-p', ports ?? 'top2,top3', '--af', outBase], { targets: cidrs.join(','), ports: ports ?? 'top2,top3', output: outBase })
    const result = await runCli(inv.cmd, inv.args)
    const urlCount = ((await readTextIfExists(join(outBase, 'urls.txt'))) ?? '').split('\n').filter(Boolean).length
    return { seq: 3, stepId: 'port-scan', summary: `gogo exit=${result.code}，http 服务 URL ${urlCount} 个\n${tail(result.stderr, 300)}` }
  }

  /** url-build：③→④ 之间的确定性合并（gogo 已判定 URL ∪ 子域裸域名 ∪ 用户直供清单），不消耗 AI。 */
  async function urlBuild(target: string, extraInput: string[] = []): Promise<{ candidates: string[]; file: string }> {
    const dir = targetDir(root(), target)
    const gogoUrls = ((await readTextIfExists(join(dir, '3-gogo', 'urls.txt'))) ?? '')
      .split('\n').map(s => s.trim()).filter(Boolean)
    const subdomains = ((await readTextIfExists(join(dir, '2-subdomains.txt'))) ?? '')
      .split('\n').map(s => s.trim()).filter(s => DOMAIN_LINE_RE.test(s))
    const seen = new Set<string>()
    const candidates: string[] = []
    for (const entry of [...gogoUrls, ...subdomains, ...extraInput]) {
      const normalized = entry.toLowerCase()
      if (!seen.has(normalized)) {
        seen.add(normalized)
        candidates.push(entry)
      }
    }
    const file = await writeArtifact(dir, '4-candidates.txt', `${candidates.join('\n')}\n`)
    return { candidates, file }
  }

  async function runAliveProbe(target: string, ports: string | undefined, extraInput: string[] = []): Promise<StepOutcome> {
    const scope = await currentScope()
    const dir = targetDir(root(), target)
    const { candidates, file } = await urlBuild(target, extraInput)
    if (candidates.length === 0) {
      throw new Error('url-build 结果为空：先跑 ② subdomain-enum / ③ port-scan，或提供输入清单')
    }
    assertHosts(scope, candidates.map(entry => extractHost(entry)))
    const artifact = join(dir, '4-alive.json')
    const inv = resolveInvocation(env.toolCommands, 'httpx', cliPath(env.toolsDir, 'httpx'), [
      '-l', file,
      ...(ports !== undefined ? ['-ports', ports] : []),
      '-tech-detect', '-status-code', '-title', '-json', '-o', artifact,
    ], { input: file, output: artifact, ports: ports ?? '' })
    const result = await runCli(inv.cmd, inv.args)
    const raw = (await readTextIfExists(artifact)) ?? ''
    const aliveCount = raw.split('\n').filter(line => line.trim().startsWith('{')).length
    return { seq: 4, stepId: 'alive-probe', summary: `存活 ${aliveCount}/${candidates.length}（候选清单 ${file}）\n${tail(result.stderr, 300)}` }
  }

  async function runReport(target: string, title: string | undefined): Promise<StepOutcome> {
    const content = `# ${title ?? '侦察报告'} — ${target}\n\n各步骤结论见 \`recon_status\`；发现经账本三态判定后由 vuln_report 汇总。\n`
    const file = await writeArtifact(targetDir(root(), target), '5-recon-report.md', content)
    return { seq: 5, stepId: 'report', summary: `侦察汇总已写 ${file}` }
  }

  // ---- recon_pipeline 工具 ----

  const pipelineTool = vhDefineTool({
    name: 'recon_pipeline',
    description:
      '五步快准狠流水线：①enscan 测绘 →②amass+情报 子域 →③gogo 端口指纹 →④httpx 探活(url-build 自动合并) →⑤report。'
      + 'steps 参数支持任意选段如 "1,2,4"；每步产物落盘 <artifactsRoot>/<target>/，结论入状态机可断点续跑；所有目标经 scope 护栏校验。',
    parameters: {
      target: { type: 'string', required: true, description: '授权目标代号' },
      steps: { type: 'string', description: '选段，如 "1,2,4"，默认全链 "1,2,3,4,5"' },
      company: { type: 'string', description: '① 公司名' },
      domain: { type: 'string', description: '② 根域名' },
      cidrs: { type: 'array', description: '③ IP/CIDR 清单（须在 scope 内）' },
      ports: { type: 'string', description: '③ gogo 端口 tag，默认 top2,top3' },
      input: { type: 'array', description: '④ 直供候选 URL/域名清单（跳过上游时用；须在 scope 内）' },
      title: { type: 'string', description: '⑤ 报告名' },
    },
    output: {
      schema: { type: 'object', properties: { statusMarkdown: { type: 'string' } }, required: ['statusMarkdown'], additionalProperties: false },
      render(_args, value) {
        const result = value as { statusMarkdown: string }
        return [{ type: 'text', text: result.statusMarkdown }]
      },
    },
    async execute(args) {
      const selected = parseSteps(args.steps ?? '1,2,3,4,5')
      const state = await loadState(root(), args.target)
      const outcomes: string[] = [`## 流水线执行 — ${args.target}`, '']
      for (const seq of selected) {
        const startedAt = Date.now()
        try {
          let outcome: StepOutcome
          switch (seq) {
            case 1:
              if (args.company === undefined || args.company === '') throw new Error(STEP_DEPS[1] ?? '')
              outcome = await runEnscan(args.company, args.target); break
            case 2:
              if (args.domain === undefined || args.domain === '') throw new Error(STEP_DEPS[2] ?? '')
              outcome = await runSubdomainEnum(args.domain, args.target); break
            case 3:
              if (args.cidrs === undefined || args.cidrs.length === 0) throw new Error(STEP_DEPS[3] ?? '')
              outcome = await runPortScan(args.cidrs, args.target, args.ports); break
            case 4:
              outcome = await runAliveProbe(args.target, args.ports, args.input ?? []); break
            case 5:
              outcome = await runReport(args.target, args.title); break
            default:
              throw new Error(`未知步骤号 ${seq}（合法 1-5）`)
          }
          await record(state, root(), args.target, outcome.seq, outcome.stepId, 'ok', startedAt, outcome.summary)
          outcomes.push(`✅ **${outcome.seq}. ${outcome.stepId}** — ${outcome.summary}`)
        } catch (error) {
          const message = String(error instanceof Error ? error.message : error)
          await record(state, root(), args.target, seq, `step-${seq}`, 'error', startedAt, message)
          outcomes.push(`❌ **${seq}.** ${message}`)
          outcomes.push('', '_流水线 fail-fast 终止；修复后可从该步重新选段续跑。_')
          return { statusMarkdown: `${outcomes.join('\n')}\n${renderStatus(await loadState(root(), args.target))}` }
        }
      }
      return { statusMarkdown: `${outcomes.join('\n')}\n${renderStatus(await loadState(root(), args.target))}` }
    },
  })

  // ---- recon_status 工具 ----

  const statusTool = vhDefineTool({
    name: 'recon_status',
    description: '查看目标流水线运行历史与各步骤最新结论（markdown 表格），用于断点续跑前确认进度。',
    parameters: {
      target: { type: 'string', required: true, description: '授权目标代号' },
    },
    output: {
      schema: { type: 'object', properties: { statusMarkdown: { type: 'string' } }, required: ['statusMarkdown'], additionalProperties: false },
      render(_args, value) {
        const result = value as { statusMarkdown: string }
        return [{ type: 'text', text: result.statusMarkdown }]
      },
    },
    async execute(args) {
      const state = await loadState(root(), args.target)
      return { statusMarkdown: renderStatus(state) }
    },
  })

  return [pipelineTool, statusTool]
}

function parseSteps(raw: string): number[] {
  const parsed = raw.split(',').map(part => Number.parseInt(part.trim(), 10)).filter(num => num >= 1 && num <= 5)
  if (parsed.length === 0) throw new Error('steps 解析为空，示例："1,2,4" 或 "1,2,3,4,5"')
  return [...new Set(parsed)].sort((a, b) => a - b)
}

async function record(
  state: TargetState,
  rootDir: string,
  target: string,
  seq: number,
  stepId: string,
  runState: 'ok' | 'error' | 'skipped',
  startedAt: number,
  summary: string,
): Promise<void> {
  const run: StepRun = {
    seq,
    stepId,
    state: runState,
    startedAt: new Date(startedAt).toISOString(),
    durationMs: Date.now() - startedAt,
    artifact: '',
    summary,
  }
  state.runs.push(run)
  if (runState === 'ok') state.conclusions[String(seq)] = summary
  await saveState(rootDir, target, state)
}

function renderStatus(state: TargetState): string {
  const header = '| seq | 步骤 | 状态 | 耗时 | 时间 | 结论摘要 |'
  const split = '|---|---|---|---|---|---|'
  const runs = state.runs.slice(-20).reverse()
  const rows = runs.length > 0
    ? runs.map(run => `| ${run.seq} | ${run.stepId} | ${run.state === 'ok' ? '✅' : run.state === 'error' ? '❌' : '⏭️'} | ${run.durationMs}ms | ${run.startedAt.slice(0, 19)} | ${run.summary.replace(/\n/g, ' ').slice(0, 120)} |`)
    : ['| - | - | - | - | - | 尚无运行记录 |']
  return ['## 流水线状态', header, split, ...rows].join('\n')
}
