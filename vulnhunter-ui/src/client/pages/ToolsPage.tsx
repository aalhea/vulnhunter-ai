/**
 * ToolsPage — 工具箱页：11 个 dsh-vulnhunter 工具的治理台。
 * 勾选启用/停用（agent 调用许可）+ 每工具自定义指令（留空=默认）+ 流水线拓扑。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import type {
  VulnHunterRunRow,
  VulnHunterTargetRow,
  VulnHunterToolPolicy,
  VulnHunterToolRow,
} from '../contract/slots.ts'
import type { T } from './PagesHost.tsx'
import { Topology, type TopoNode } from './Topology.tsx'
import css from './ToolsPage.module.css'

export interface ToolsPageProps {
  t: T
  fetchTools: () => Promise<{ tools: readonly VulnHunterToolRow[]; policy: VulnHunterToolPolicy }>
  saveToolPolicy: (patch: Partial<VulnHunterToolPolicy>) => Promise<{ ok: boolean; message?: string | undefined }>
  fetchTargets: () => Promise<readonly VulnHunterTargetRow[]>
  fetchRuns: (target: string) => Promise<readonly VulnHunterRunRow[]>
}

/** state.json runs 的 stepId → 流水线五步映射。 */
const PIPELINE_STEPS: readonly { key: string; label: string; tool: string; aliases: readonly string[] }[] = [
  { key: '1', label: '资产测绘', tool: 'enscan', aliases: ['1', 'asset-mapping', 'enscan'] },
  { key: '2', label: '子域枚举', tool: 'amass', aliases: ['2', 'subdomain-enum', 'amass'] },
  { key: '3', label: '端口扫描', tool: 'gogo', aliases: ['3', 'port-scan', 'gogo'] },
  { key: '4', label: '存活探活', tool: 'httpx', aliases: ['4', 'alive-probe', 'httpx'] },
  { key: '5', label: '报告生成', tool: 'vuln_report', aliases: ['5', 'report', 'vuln_report'] },
]

/** 工具箱页。 */
export function ToolsPage({ t, fetchTools, saveToolPolicy, fetchTargets, fetchRuns }: ToolsPageProps) {
  const [tools, setTools] = useState<readonly VulnHunterToolRow[]>([])
  const [policy, setPolicy] = useState<VulnHunterToolPolicy>({ disabled: [], instructions: {} })
  const [loading, setLoading] = useState(true)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [savedKey, setSavedKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // 拓扑数据
  const [targets, setTargets] = useState<readonly VulnHunterTargetRow[]>([])
  const [activeTarget, setActiveTarget] = useState<string | null>(null)
  const [runs, setRuns] = useState<readonly VulnHunterRunRow[]>([])

  useEffect(() => {
    let cancelled = false
    fetchTools()
      .then(data => {
        if (cancelled) return
        setTools(data.tools)
        setPolicy(data.policy)
        setLoading(false)
      })
      .catch(err => {
        if (cancelled) return
        setError(String(err))
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [fetchTools])

  useEffect(() => {
    let cancelled = false
    fetchTargets()
      .then(rows => {
        if (cancelled) return
        setTargets(rows)
        if (rows.length > 0) setActiveTarget(prev => prev ?? rows[0]?.target ?? null)
      })
      .catch(() => { /* 拓扑数据缺失不阻塞页面 */ })
    return () => { cancelled = true }
  }, [fetchTargets])

  useEffect(() => {
    if (activeTarget === null) return
    let cancelled = false
    fetchRuns(activeTarget)
      .then(rows => { if (!cancelled) setRuns(rows) })
      .catch(() => { if (!cancelled) setRuns([]) })
    return () => { cancelled = true }
  }, [activeTarget, fetchRuns])

  const disabledSet = useMemo(() => new Set(policy.disabled), [policy.disabled])

  const toggleTool = useCallback((name: string) => {
    const nextDisabled = disabledSet.has(name)
      ? policy.disabled.filter(n => n !== name)
      : [...policy.disabled, name]
    const next = { ...policy, disabled: nextDisabled }
    setPolicy(next)
    setSavingKey(name)
    void saveToolPolicy({ disabled: nextDisabled })
      .then(result => {
        setSavingKey(null)
        if (result.ok) {
          setSavedKey(name)
          window.setTimeout(() => setSavedKey(prev => prev === name ? null : prev), 1200)
        } else {
          setPolicy(policy) // 回滚
          setError(result.message ?? 'save failed')
        }
      })
  }, [policy, disabledSet, saveToolPolicy])

  const saveInstruction = useCallback((name: string, text: string) => {
    const next = { ...policy, instructions: { ...policy.instructions, [name]: text } }
    if (text === '') delete next.instructions[name]
    setPolicy(next)
    setSavingKey(name)
    void saveToolPolicy({ instructions: next.instructions })
      .then(result => {
        setSavingKey(null)
        if (result.ok) {
          setSavedKey(name)
          window.setTimeout(() => setSavedKey(prev => prev === name ? null : prev), 1200)
        } else {
          setPolicy(policy)
          setError(result.message ?? 'save failed')
        }
      })
  }, [policy, saveToolPolicy])

  /** 五步流水线拓扑节点：取每步最新一次 run 的状态。 */
  const pipelineNodes: readonly TopoNode[] = PIPELINE_STEPS.map(step => {
    const stepRuns = runs.filter(r => step.aliases.includes(r.stepId))
    const latest = stepRuns.length > 0
      ? stepRuns.reduce((a, b) => (a.seq > b.seq ? a : b))
      : undefined
    return {
      label: step.label,
      sub: step.tool,
      state: latest === undefined
        ? 'pending'
        : latest.state === 'ok' ? 'ok' : 'error',
      metric: latest === undefined
        ? undefined
        : latest.durationMs > 0 ? `${Math.round(latest.durationMs / 100) / 10}s` : undefined,
    }
  })

  if (loading) {
    return (
      <div className={css.root}>
        <div className={css.skeleton} />
        <div className={css.skeleton} />
      </div>
    )
  }

  return (
    <div className={css.root}>
      {targets.length > 0 && (
        <div className={css.targetBar}>
          <span className={css.targetLabel}>{t('tools.target')}</span>
          <div className={css.targetChips}>
            {targets.map(row => (
              <button
                key={row.target}
                type="button"
                className={clsx(css.targetChip, row.target === activeTarget && css.targetChipActive)}
                onClick={() => setActiveTarget(row.target)}
              >
                {row.target}
                <span className={css.targetMeta}>{row.confirmed}/{row.ledger}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <section className={css.section}>
        <h2 className={css.sectionTitle}>{t('tools.pipeline')}</h2>
        <Topology nodes={pipelineNodes} />
      </section>

      <section className={css.section}>
        <div className={css.headRow}>
          <h2 className={css.sectionTitle}>{t('page.tools')}</h2>
          <span className={css.hint}>{t('tools.select')}</span>
        </div>
        {error !== null && <p className={css.error}>{error}</p>}
        <div className={css.toolGrid}>
          {tools.map(tool => {
            const enabled = !disabledSet.has(tool.name)
            const instruction = policy.instructions[tool.name] ?? ''
            return (
              <div
                key={tool.name}
                className={clsx(css.toolCard, enabled ? css.toolOn : css.toolOff)}
              >
                <div className={css.toolHead}>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={enabled}
                    className={clsx(css.switch, enabled && css.switchOn)}
                    onClick={() => toggleTool(tool.name)}
                  >
                    <span className={css.knob} />
                  </button>
                  <span className={css.toolName}>{tool.name}</span>
                  <span className={clsx(css.toolState, enabled ? css.stateOkText : css.stateIdleText)}>
                    {savingKey === tool.name
                      ? t('tools.saving')
                      : savedKey === tool.name
                        ? t('tools.saved')
                        : enabled ? t('tools.enabled') : t('tools.disabled')}
                  </span>
                </div>
                <p className={css.toolDesc}>
                  <span className={css.toolGroup}>{tool.group}</span>
                  {tool.desc}
                </p>
                <label className={css.instructionLabel}>
                  <span className={css.instructionTitle}>{t('tools.instructions')}</span>
                  <textarea
                    className={css.instruction}
                    placeholder={t('tools.instructionsHint')}
                    defaultValue={instruction}
                    onBlur={e => {
                      if (e.target.value !== instruction) saveInstruction(tool.name, e.target.value.trim())
                    }}
                    rows={2}
                  />
                </label>
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}
