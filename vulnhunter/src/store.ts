/**
 * 目标状态存储：账本 + 流水线运行记录的跨会话持久化。
 *
 * 有意采用 JSON 文件而非 storageDomain 服务：零未知 API 风险、随 artifacts 目录
 * 一起备份/同步、人可直接打开检查（渗透工作者对「看得见的文件」信任度最高）。
 * 后续如需并发写或 Web 面板直读，再迁移到 sqlite backend（cordis.patch.yml 已留位）。
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { targetDir } from './util.ts'

export type LedgerStatus = '未测' | '测试中' | '已证实' | '已排除' | '阻塞' | '测试中(子代理)'
export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info'

export interface LedgerItem {
  id: string
  surface: string
  type: string
  status: LedgerStatus
  severity: Severity
  evidence: string
  note: string
  createdAt: string
  updatedAt: string
}

export interface StepRun {
  seq: number
  stepId: string
  state: 'ok' | 'error' | 'skipped'
  startedAt: string
  durationMs: number
  artifact: string
  summary: string
}

export interface TargetState {
  target: string
  createdAt: string
  updatedAt: string
  ledger: LedgerItem[]
  runs: StepRun[]
  /** 各步骤最新结构化结论（url-build 合并清单等下游输入从这里接力）。 */
  conclusions: Record<string, string>
}

const EMPTY: Omit<TargetState, 'target'> = {
  createdAt: '',
  updatedAt: '',
  ledger: [],
  runs: [],
  conclusions: {},
}

function stateFile(root: string, target: string): string {
  return join(targetDir(root, target), 'state.json')
}

export async function loadState(root: string, target: string): Promise<TargetState> {
  try {
    const raw = await readFile(stateFile(root, target), 'utf8')
    return JSON.parse(raw) as TargetState
  } catch {
    return { target, ...EMPTY }
  }
}

export async function saveState(root: string, target: string, state: TargetState): Promise<void> {
  state.updatedAt = new Date().toISOString()
  if (state.createdAt === '') state.createdAt = state.updatedAt
  const file = stateFile(root, target)
  await mkdir(join(file, '..'), { recursive: true })
  await writeFile(file, JSON.stringify(state, null, 2), 'utf8')
}

let idCounter = 0

export function nextLedgerId(state: TargetState): string {
  idCounter += 1
  return `L${String(state.ledger.length + 1).padStart(3, '0')}-${Date.now().toString(36)}${idCounter}`
}

/** 账本 markdown 渲染（ledger_state / 报告共用同一排版）。 */
export function renderLedger(state: TargetState): string {
  if (state.ledger.length === 0) return '_账本为空。_'
  const order: LedgerStatus[] = ['未测', '测试中', '测试中(子代理)', '阻塞', '已证实', '已排除']
  const sorted = [...state.ledger].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status))
  const header = '| ID | 攻击面 | 类型 | 状态 | 严重性 | 证据指针 | 备注 |'
  const split = '|---|---|---|---|---|---|---|'
  const rows = sorted.map(item =>
    `| ${item.id} | ${item.surface} | ${item.type} | ${item.status} | ${item.severity} | ${item.evidence || '-'} | ${item.note || '-'} |`,
  )
  const open = state.ledger.filter(item => item.status !== '已证实' && item.status !== '已排除').length
  return [`**未结项 ${open}/${state.ledger.length}**`, header, split, ...rows].join('\n')
}
