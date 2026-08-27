/**
 * 攻击面账本工具组（persona §5 的工程承载）+ vuln_report 报告生成器。
 *
 * 账本纪律：只有本体可写（子代理的 toolFilter 已屏蔽本组工具）；三态之外的
 * 一切状态都是中间态。所有数据持久化在 <artifactsRoot>/<target>/state.json。
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { cwd } from 'node:process'
import type { ReconEnv } from './recontools.ts'
import { vhDefineTool } from './tooldef.ts'
import {
  loadState,
  nextLedgerId,
  renderLedger,
  saveState,
  type LedgerItem,
  type LedgerStatus,
  type Severity,
} from './store.ts'
import { artifactsRootOf, targetDir } from './util.ts'

const STATUSES: readonly LedgerStatus[] = ['未测', '测试中', '已证实', '已排除', '阻塞', '测试中(子代理)']
const SEVERITIES: readonly Severity[] = ['critical', 'high', 'medium', 'low', 'info']

function assertEnum<T extends string>(value: string, allowed: readonly T[], field: string): T {
  if (!(allowed as readonly string[]).includes(value)) {
    throw new Error(`${field} 仅允许：${allowed.join(' / ')}，收到 "${value}"`)
  }
  return value as T
}

// ---- ledger_add ----

export function ledgerAddTool(env: ReconEnv) {
  return vhDefineTool({
    name: 'ledger_add',
    description:
      '向攻击面账本新增一条记录（recon 的每个新发现必须立即入账，绝不只留在上下文里）。返回分配的账本 ID。',
    parameters: {
      target: { type: 'string', required: true, description: '授权目标代号' },
      surface: { type: 'string', required: true, description: '攻击面描述（URL/接口/主机等）' },
      type: { type: 'string', required: true, description: '类型：注入/越权/上传/SSRF/信息泄露/认证…' },
      severity: { type: 'string', required: true, description: 'critical|high|medium|low|info' },
      status: { type: 'string', description: '默认「未测」' },
      evidence: { type: 'string', description: '证据指针（artifact 路径或 raw HTTP 摘要）' },
      note: { type: 'string', description: '备注' },
    },
    output: {
      schema: { type: 'object', properties: { id: { type: 'string' }, ledgerMarkdown: { type: 'string' } }, required: ['id', 'ledgerMarkdown'], additionalProperties: false },
      render(_args, value) {
        const result = value as { id: string }
        return [{ type: 'text', text: `已入账：**${result.id}**` }]
      },
    },
    async execute(args) {
      const status = assertEnum(args.status ?? '未测', STATUSES, 'status')
      const severity = assertEnum(args.severity, SEVERITIES, 'severity')
      const root = artifactsRootOf(env.artifactsRoot)
      const state = await loadState(root, args.target)
      const now = new Date().toISOString()
      const item: LedgerItem = {
        id: nextLedgerId(state),
        surface: args.surface,
        type: args.type,
        status,
        severity,
        evidence: args.evidence ?? '',
        note: args.note ?? '',
        createdAt: now,
        updatedAt: now,
      }
      state.ledger.push(item)
      await saveState(root, args.target, state)
      return { id: item.id, ledgerMarkdown: renderLedger(state) }
    },
  })
}

// ---- ledger_update ----

export function ledgerUpdateTool(env: ReconEnv) {
  return vhDefineTool({
    name: 'ledger_update',
    description:
      '更新账本条目状态/证据/备注。三态判定：已证实必须附完整 raw HTTP 证据指针；已排除必须写明排除依据。',
    parameters: {
      target: { type: 'string', required: true, description: '授权目标代号' },
      id: { type: 'string', required: true, description: '账本 ID' },
      status: { type: 'string', description: '未测|测试中|已证实|已排除|阻塞|测试中(子代理)' },
      evidence: { type: 'string', description: '更新后的证据指针' },
      note: { type: 'string', description: '更新后的备注' },
      severity: { type: 'string', description: '调整严重性' },
    },
    output: {
      schema: { type: 'object', properties: { ok: { type: 'boolean' }, ledgerMarkdown: { type: 'string' } }, required: ['ok', 'ledgerMarkdown'], additionalProperties: false },
      render(_args, value) {
        const result = value as { ok: boolean }
        return [{ type: 'text', text: result.ok === true ? '账本已更新 ✓' : '未找到该 ID' }]
      },
    },
    async execute(args) {
      const root = artifactsRootOf(env.artifactsRoot)
      const state = await loadState(root, args.target)
      const item = state.ledger.find(entry => entry.id === args.id || entry.id.startsWith(args.id))
      if (item === undefined) return { ok: false, ledgerMarkdown: renderLedger(state) }
      if (args.status !== undefined) item.status = assertEnum(args.status, STATUSES, 'status')
      if (args.severity !== undefined) item.severity = assertEnum(args.severity, SEVERITIES, 'severity')
      if (args.evidence !== undefined) item.evidence = args.evidence
      if (args.note !== undefined) item.note = args.note
      item.updatedAt = new Date().toISOString()
      // 质量门（persona §12）：转「已证实」必须有证据指针。
      if (item.status === '已证实' && item.evidence.trim() === '') {
        throw new Error(`质量门拦截：${item.id} 转入"已证实"前必须提供证据指针（raw HTTP / 命令回显落盘位置）`)
      }
      await saveState(root, args.target, state)
      return { ok: true, ledgerMarkdown: renderLedger(state) }
    },
  })
}

// ---- ledger_state ----

export function ledgerStateTool(env: ReconEnv) {
  return vhDefineTool({
    name: 'ledger_state',
    description:
      '读取目标攻击面账本全量（markdown 表格）。上下文被压缩后第一件事就是调用它恢复进度。',
    parameters: {
      target: { type: 'string', required: true, description: '授权目标代号' },
    },
    output: {
      schema: { type: 'object', properties: { ledgerMarkdown: { type: 'string' } }, required: ['ledgerMarkdown'], additionalProperties: false },
      render(_args, value) {
        const result = value as { ledgerMarkdown: string }
        return [{ type: 'text', text: result.ledgerMarkdown }]
      },
    },
    async execute(args) {
      const state = await loadState(artifactsRootOf(env.artifactsRoot), args.target)
      return { ledgerMarkdown: renderLedger(state) }
    },
  })
}

// ---- vuln_report ----

/**
 * 报告生成器：从账本抽取「已证实」项按严重性排序输出 markdown。
 * 输出规格见 persona §输出规格；路径 <cwd>/<target>/NN-<title>.md，
 * 同时镜像一份到 artifacts 目录防丢。
 */
export function vulnReportTool(env: ReconEnv) {
  const severityRank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 }
  return vhDefineTool({
    name: 'vuln_report',
    description:
      '汇总漏洞报告：只收账本中「已证实」且带完整证据指针的发现，按严重性排序生成 .md（含摘要表/资产/发现/附录）。',
    parameters: {
      target: { type: 'string', required: true, description: '授权目标代号' },
      title: { type: 'string', description: '报告名，默认「渗透测试报告」' },
      assets: { type: 'array', description: '资产清单（每行一个），可选' },
    },
    output: {
      schema: { type: 'object', properties: { reportPath: { type: 'string' }, confirmedCount: { type: 'number' } }, required: ['reportPath', 'confirmedCount'], additionalProperties: false },
      render(_args, value) {
        const result = value as { reportPath: string; confirmedCount: number }
        return [{ type: 'text', text: `报告已生成（${result.confirmedCount} 个已证实发现）：\`${result.reportPath}\`` }]
      },
    },
    async execute(args) {
      const root = artifactsRootOf(env.artifactsRoot)
      const state = await loadState(root, args.target)
      const confirmed = state.ledger
        .filter(item => item.status === '已证实')
        .sort((a, b) => (severityRank[a.severity] ?? 9) - (severityRank[b.severity] ?? 9))
      const blocked = state.ledger.filter(item => item.status === '阻塞')

      const lines: string[] = []
      lines.push(`# ${args.title ?? '渗透测试报告'} — ${args.target}`)
      lines.push('')
      lines.push(`> 授权依据：${'见 scope.yaml'} · 生成时间 ${new Date().toISOString()}`)
      lines.push('')
      lines.push('## 1. 摘要')
      lines.push('')
      lines.push('| 严重性 | 数量 |')
      lines.push('|---|---|')
      for (const severity of ['critical', 'high', 'medium', 'low', 'info'] as const) {
        const count = confirmed.filter(item => item.severity === severity).length
        if (count > 0) lines.push(`| ${severity} | ${count} |`)
      }
      lines.push('')
      lines.push('## 2. 资产清单')
      lines.push('')
      lines.push((args.assets ?? []).length > 0 ? (args.assets ?? []).map(asset => `- ${asset}`).join('\n') : '_见 artifacts/4-alive.json_')
      lines.push('')
      lines.push('## 3. 发现详情')
      lines.push('')
      if (confirmed.length === 0) {
        lines.push('_暂无已证实发现。疑似与中间态一律不进报告（persona §10）。_')
      }
      for (const [index, item] of confirmed.entries()) {
        lines.push(`### 3.${index + 1} [${item.severity.toUpperCase()}] ${item.surface}`)
        lines.push('')
        lines.push(`- 类型：${item.type}　账本ID：${item.id}`)
        lines.push(`- 证据：${item.evidence}`)
        if (item.note !== '') lines.push(`- 备注：${item.note}`)
        lines.push('')
      }
      lines.push('## 4. 阻塞与未竟事项')
      lines.push('')
      lines.push(blocked.length > 0
        ? blocked.map(item => `- ${item.id} ${item.surface}：${item.note || item.evidence || '(无说明)'}`).join('\n')
        : '_无_')
      lines.push('')
      lines.push('## 5. 完整证据附录')
      lines.push('')
      lines.push('按账本 evidence 字段指向的 artifact 文件取原始 raw HTTP / 命令回显。')
      lines.push('')

      const content = `${lines.join('\n')}\n`
      const seq = String(Math.floor(Date.now() / 1000) % 100).padStart(2, '0')
      const reportName = `${seq}-${args.title ?? '渗透测试报告'}.md`
      const reportDir = join(cwd(), args.target)
      await mkdir(reportDir, { recursive: true })
      const reportPath = join(reportDir, reportName)
      await writeFile(reportPath, content, 'utf8')
      await writeFile(join(targetDir(root, args.target), reportName), content, 'utf8')
      return { reportPath, confirmedCount: confirmed.length }
    },
  })
}
