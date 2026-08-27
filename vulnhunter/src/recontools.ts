/**
 * 侦察工具组：enscan / amass / gogo / httpx / 被动情报（fofa、shodan）。
 *
 * 每个工具的共同契约：
 * 1. 入参 target 命名一个授权目标目录（<artifactsRoot>/<target>/）；
 * 2. 执行前过 scope 护栏（域名白名单 / CIDR），出界直接抛错；
 * 3. CLI 原始输出全量落盘 artifact，返回值只含「结构化摘要 + 尾部日志 + artifact 指针」。
 */

import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { extractHost, hostAllowed, ipAllowed, loadScope, type LoadedScope } from './scope.ts'
import { vhDefineTool } from './tooldef.ts'
import {
  cliPath,
  readTextIfExists,
  runCli,
  tail,
  targetDir,
  writeArtifact,
} from './util.ts'

/** 工具共享的运行环境（由 index.ts 在 apply 时装配）。 */
export interface ReconEnv {
  ctx: Context
  toolsDir: string
  /** artifact 根目录（已解析为绝对路径）。 */
  artifactsRoot: string
  scopeFile: string
  /** 自定义命令模板表（键：工具名），空 = 用内置默认。 */
  toolCommands: Record<string, string>
  fofaEmail: string
  fofaKey: string
  shodanKey: string
}

/** 加载并缓存 scope；scopeFile 为空 = 未配置授权文件 → 护栏进入警告模式。 */
async function currentScope(env: ReconEnv): Promise<LoadedScope | undefined> {
  if (env.scopeFile.trim() === '') return undefined
  return await loadScope(env.scopeFile)
}

/** 护栏断言：任一目标出界即抛错（fail-closed）。 */
function assertAllowed(scope: LoadedScope | undefined, targets: string[], kind: 'host' | 'ip'): void {
  if (targets.length === 0) throw new Error('目标清单为空')
  const check = kind === 'host' ? hostAllowed : ipAllowed
  const violations = targets.filter(entry => !check(scope, entry))
  if (violations.length > 0) {
    throw new Error(
      `scope 护栏拦截：以下目标不在授权范围内（scope=${scope?.path ?? '未配置，主动扫描前必须提供 scope.yaml'}）：${violations.join(', ')}`,
    )
  }
}

/** 从 URL/裸域混合清单提取待校验的 host。 */
function hostsOf(inputs: string[]): string[] {
  return inputs.map(extractHost).filter(host => host.length > 0)
}

/** 统一的 markdown 结果渲染：结论 + artifact 指针，原始输出永不进上下文。 */
function renderSummary(heading: string, lines: string[], artifact: string): { type: 'text'; text: string }[] {
  return [{ type: 'text', text: `### ${heading}\n${lines.join('\n')}\n\n原始输出：\`${artifact}\`` }]
}

// ---- recon_enscan ----

export function reconEnscanTool(env: ReconEnv) {
  return vhDefineTool({
    name: 'recon_enscan',
    description:
      '公司资产测绘：公司名 → 根域名/子公司/ICP 备案/App/小程序。输出 enscan JSON 产物落盘 + 结构化摘要。执行前经 scope 护栏校验根域名。',
    parameters: {
      company: { type: 'string', required: true, description: '公司全名或简称' },
      target: { type: 'string', required: true, description: '授权目标代号（目录名）' },
      deep: { type: 'boolean', description: '深度模式（更慢更全）' },
    },
    output: {
      schema: { type: 'object', properties: { artifact: { type: 'string' }, summary: { type: 'string' }, ok: { type: 'boolean' } }, required: ['artifact', 'summary', 'ok'], additionalProperties: false },
      render(_args, value) {
        const result = value as { artifact: string; summary: string }
        return renderSummary('enscan 资产测绘', [result.summary], result.artifact)
      },
    },
    async execute(args) {
      const scope = await currentScope(env)
      const dir = targetDir(env.artifactsRoot, args.target)
      const artifact = join(dir, '1-company-expand.json')
      const result = await runCli(cliPath(env.toolsDir, 'enscan'), [
        '-company', args.company,
        '-json',
        ...(args.deep === true ? ['-deep'] : []),
        '-o', artifact,
      ])
      const raw = await readTextIfExists(artifact)
      // 从产物里抽根域名清单做护栏回查 —— 测绘结果本身也可能带出界域名，先拦后用。
      const domainsFound = raw === null ? [] : [...new Set((raw.match(/([a-z0-9-]+\.[a-z0-9.-]+)\b/gi) ?? [])
        .map(d => d.toLowerCase())
        .filter(d => d.includes('.') && !d.endsWith('.png') && !d.endsWith('.jpg')))]
      assertAllowed(scope, domainsFound.slice(0, 500), 'host')
      return {
        ok: result.code === 0,
        artifact,
        summary: tail(`exit=${result.code}\n${result.stdout || result.stderr}`, 1200),
      }
    },
  })
}

// ---- recon_amass ----

export function reconAmassTool(env: ReconEnv) {
  return vhDefineTool({
    name: 'recon_amass',
    description:
      '被动子域枚举（amass enum -passive）。产物去重后与已知子域合并写入 <target>/artifacts/2-subdomains.txt。',
    parameters: {
      domain: { type: 'string', required: true, description: '根域名' },
      target: { type: 'string', required: true, description: '授权目标代号' },
    },
    output: {
      schema: { type: 'object', properties: { artifact: { type: 'string' }, count: { type: 'number' }, summary: { type: 'string' } }, required: ['artifact', 'count', 'summary'], additionalProperties: false },
      render(_args, value) {
        const result = value as { artifact: string; count: number; summary: string }
        return renderSummary('amass 子域枚举', [result.summary], result.artifact)
      },
    },
    async execute(args) {
      const scope = await currentScope(env)
      if (!hostAllowed(scope, args.domain)) {
        throw new Error(`scope 护栏拦截：${args.domain} 不在授权范围`)
      }
      const dir = targetDir(env.artifactsRoot, args.target)
      // 该版本 amass 无 -o 参数，结果走 stdout —— 由我们落盘；空输出且非零退出视为失败。
      const result = await runCli(cliPath(env.toolsDir, 'amass'), ['enum', '-passive', '-d', args.domain])
      await writeArtifact(dir, '2-amass-raw.txt', result.stdout)
      if (result.code !== 0 && result.stdout.trim() === '') {
        throw new Error(`amass 失败(exit=${result.code})：${tail(result.stderr, 300)}`)
      }
      const existing = (await readTextIfExists(join(dir, '2-subdomains.txt')))?.split('\n').filter(Boolean) ?? []
      // 多源去重：根域种子 ∪ amass 结果（正则滤掉日志行）∪ 已有清单。
      const fresh = [args.domain.toLowerCase(), ...result.stdout.split('\n').map(s => s.trim().toLowerCase()).filter(s => /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(s))]
      const merged = [...new Set([...existing, ...fresh])].sort()
      const mergedFile = await writeArtifact(dir, '2-subdomains.txt', `${merged.join('\n')}\n`)
      assertAllowed(scope, merged.slice(0, 2000), 'host')
      return { artifact: mergedFile, count: merged.length, summary: tail(`exit=${result.code}，合并后子域 ${merged.length} 条（本次新增 ${merged.length - existing.length}）\n${result.stderr}`, 800) }
    },
  })
}

// ---- recon_gogo ----

export function reconGogoTool(env: ReconEnv) {
  return vhDefineTool({
    name: 'recon_gogo',
    description:
      '端口扫描 + 服务/漏洞指纹（chainreactors/gogo，最小发包）。输入 IP/CIDR 清单；产物含开放端口、服务指纹与 http URL 发现。',
    parameters: {
      target: { type: 'string', required: true, description: '授权目标代号' },
      targets: { type: 'array', required: true, description: 'IP 或 CIDR 列表（须在 scope.cidr 内）' },
      ports: { type: 'string', description: 'gogo 端口 tag/范围，默认 top2,top3（外网常见 web 端口）' },
    },
    output: {
      schema: { type: 'object', properties: { artifact: { type: 'string' }, urlsArtifact: { type: 'string' }, summary: { type: 'string' } }, required: ['artifact', 'urlsArtifact', 'summary'], additionalProperties: false },
      render(_args, value) {
        const result = value as { artifact: string; urlsArtifact: string; summary: string }
        return renderSummary('gogo 端口扫描', [result.summary], result.artifact)
      },
    },
    async execute(args) {
      const scope = await currentScope(env)
      // CIDR 与裸 IP 都按 ipAllowed 校验；出界即拒。
      assertAllowed(scope, args.targets, 'ip')
      const dir = targetDir(env.artifactsRoot, args.target)
      await mkdir(dir, { recursive: true })
      const outBase = join(dir, '3-gogo')
      const result = await runCli(cliPath(env.toolsDir, 'gogo'), [
        '-i', args.targets.join(','),
        '-p', args.ports ?? 'top2,top3',
        '--af', outBase,
      ])
      const urlsArtifact = join(outBase, 'urls.txt')
      const urls = (await readTextIfExists(urlsArtifact)) ?? ''
      const urlCount = urls.split('\n').filter(Boolean).length
      return {
        artifact: outBase,
        urlsArtifact,
        summary: tail(
          `exit=${result.code}，发现 http 服务 URL ${urlCount} 个（供 url-build 合并）\n${tail(result.stdout, 600)}\n${tail(result.stderr, 400)}`,
          1400,
        ),
      }
    },
  })
}

// ---- recon_httpx ----

export function reconHttpxTool(env: ReconEnv) {
  return vhDefineTool({
    name: 'recon_httpx',
    description:
      '存活探测 + Web 指纹。输入 URL/裸域名混合清单（url-build 的产物）；JSON 产物落盘并返回存活数与高价值线索统计。',
    parameters: {
      target: { type: 'string', required: true, description: '授权目标代号' },
      input: { type: 'array', required: true, description: 'URL/域名清单（与 gogo 输出去重合并后的候选）' },
      ports: { type: 'string', description: '附加探测端口，默认仅 80/443' },
    },
    output: {
      schema: { type: 'object', properties: { artifact: { type: 'string' }, aliveCount: { type: 'number' }, summary: { type: 'string' } }, required: ['artifact', 'aliveCount', 'summary'], additionalProperties: false },
      render(_args, value) {
        const result = value as { artifact: string; aliveCount: number; summary: string }
        return renderSummary('httpx 存活探测', [result.summary], result.artifact)
      },
    },
    async execute(args) {
      const scope = await currentScope(env)
      assertAllowed(scope, hostsOf(args.input), 'host')
      const dir = targetDir(env.artifactsRoot, args.target)
      const listFile = await writeArtifact(dir, `4-candidates-${randomUUID().slice(0, 8)}.txt`, `${args.input.join('\n')}\n`)
      const artifact = join(dir, '4-alive.json')
      const result = await runCli(cliPath(env.toolsDir, 'httpx'), [
        '-l', listFile,
        ...(args.ports !== undefined ? ['-ports', args.ports] : []),
        '-tech-detect', '-status-code', '-title', '-json', '-o', artifact,
      ])
      const raw = await readTextIfExists(artifact) ?? ''
      const aliveCount = raw.split('\n').filter(line => line.trim().startsWith('{')).length
      return {
        artifact,
        aliveCount,
        summary: tail(`exit=${result.code}，存活 ${aliveCount}/${args.input.length}\n${result.stderr}`, 900),
      }
    },
  })
}

// ---- recon_intel ----

interface IntelHit { host: string; extra: string }

export function reconIntelTool(env: ReconEnv) {
  return vhDefineTool({
    name: 'recon_intel',
    description:
      '被动情报源查询（fofa/shodan）并与 amass 子域清单合并。无 API key 时明确报错提示跳过该步骤，绝不静默失败。',
    parameters: {
      source: { type: 'string', required: true, description: 'fofa | shodan' },
      query: { type: 'string', required: true, description: '查询语句，如 domain="example.com" 或 hostname:example.com' },
      target: { type: 'string', required: true, description: '授权目标代号' },
      size: { type: 'number', description: '拉取条数上限，默认 1000' },
    },
    output: {
      schema: { type: 'object', properties: { source: { type: 'string' }, fetched: { type: 'number' }, mergedSubdomainFile: { type: 'string' }, detailArtifact: { type: 'string' }, note: { type: 'string' } }, required: ['source', 'fetched', 'mergedSubdomainFile', 'detailArtifact', 'note'], additionalProperties: false },
      render(_args, value) {
        const result = value as { source: string; fetched: number; note: string }
        return renderSummary(`被动情报 ${result.source}`, [`命中 ${result.fetched} 条`, result.note], result.detailArtifact ?? '')
      },
    },
    async execute(args) {
      const scope = await currentScope(env)
      const size = Math.min(Math.max(args.size ?? 1000, 1), 5000)
      let hits: IntelHit[]
      if (args.source === 'fofa') {
        if (env.fofaEmail === '' || env.fofaKey === '') throw new Error('未配置 fofaEmail/fofaKey —— 请在插件 config 填写或跳过本步骤')
        hits = await fetchFofa(env, args.query, size)
      } else if (args.source === 'shodan') {
        if (env.shodanKey === '') throw new Error('未配置 shodanKey —— 请在插件 config 填写或跳过本步骤')
        hits = await fetchShodan(env, args.query, size)
      } else {
        throw new Error(`source 仅支持 fofa|shodan，收到 ${args.source}`)
      }
      const hosts = hits.map(hit => hit.host.toLowerCase())
      assertAllowed(scope, hosts, 'host')
      const dir = targetDir(artifactsRootOf(''), args.target)
      const existing = (await readTextIfExists(join(dir, '2-subdomains.txt')))?.split('\n').filter(Boolean) ?? []
      const merged = [...new Set([...existing, ...hosts])].sort()
      const mergedFile = await writeArtifact(dir, '2-subdomains.txt', `${merged.join('\n')}\n`)
      const detail = await writeArtifact(dir, `2-intel-${args.source}.json`, JSON.stringify(hits, null, 2))
      return {
        source: args.source,
        fetched: hits.length,
        mergedSubdomainFile: mergedFile,
        detailArtifact: detail,
        note: `情报命中已并入子域清单（现共 ${merged.length} 条）；明细见 ${detail}`,
      }
    },
  })
}

/** fofa 开放 API：base64(query)，返回 [host, protocol, port, title, ...] 行。 */
async function fetchFofa(env: ReconEnv, query: string, size: number): Promise<IntelHit[]> {
  const auth = Buffer.from(`${env.fofaEmail}:${env.fofaKey}`).toString('base64')
  const qbase64 = Buffer.from(query).toString('base64')
  const response = await fetch(`https://fofa.info/api/v1/search/all?email=${encodeURIComponent(env.fofaEmail)}&key=${encodeURIComponent(env.fofaKey)}&qbase64=${qbase64}&fields=host&size=${size}`, {
    headers: { Authorization: `Basic ${auth}` },
  })
  const body = (await response.json()) as { error: boolean; results?: string[][]; errmsg?: string }
  if (body.error === true) throw new Error(`fofa 查询失败: ${body.errmsg ?? response.status}`)
  return (body.results ?? []).map(row => ({ host: row[0] ?? '', extra: row.slice(1).join(' ') }))
}

/** shodan 开放 API：/dns/domain 或 /search 简化为 host 搜索。 */
async function fetchShodan(env: ReconEnv, query: string, size: number): Promise<IntelHit[]> {
  const response = await fetch(`https://api.shodan.io/shodan/host/search?key=${encodeURIComponent(env.shodanKey)}&query=${encodeURIComponent(query)}&minify=true`, {})
  const body = (await response.json()) as { matches?: Array<{ ip_str?: string; hostnames?: string[] }> ; error?: string }
  if (typeof body.error === 'string') throw new Error(`shodan 查询失败: ${body.error}`)
  return (body.matches ?? []).flatMap(match => [
    ...(match.hostnames ?? []).map(hostname => ({ host: hostname, extra: match.ip_str ?? '' })),
    ...(match.ip_str !== undefined && (match.hostnames ?? []).length === 0 ? [{ host: match.ip_str, extra: '' }] : []),
  ]).slice(0, size)
}
