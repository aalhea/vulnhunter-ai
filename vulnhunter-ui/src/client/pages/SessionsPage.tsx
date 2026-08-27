/**
 * SessionsPage — 会话中心页。
 * 四模式入口（按 preset 真实开会话）+ 历史会话列表（点击打开）+ 预设指令。
 */
import { useState, useSyncExternalStore } from 'react'
import clsx from 'clsx'
import { VHModeCards } from '../VHModeCards.tsx'
import { PromptPanel } from '../PromptPanel.tsx'
import { vhShell } from '../store.ts'
import type { T } from './PagesHost.tsx'
import { sessionsFeed } from '../feeds.ts'
import css from './SessionsPage.module.css'

export interface SessionsPageProps {
  t: T
  launch: (preset: string) => Promise<{ ok: boolean; message?: string | undefined }>
  openSession: (sessionId: string) => void
}

/** 会话中心：模式入口 + 历史 + 预设。 */
export function SessionsPage({ t, launch, openSession }: SessionsPageProps) {
  const sessions = useSyncExternalStore(sessionsFeed.subscribe, sessionsFeed.getSnapshot)
  const [launchError, setLaunchError] = useState<string | null>(null)
  const [launching, setLaunching] = useState(false)

  const rows = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt)

  const handleLaunch = async (preset: string): Promise<void> => {
    setLaunching(true)
    setLaunchError(null)
    const result = await launch(preset)
    setLaunching(false)
    if (!result.ok) setLaunchError(result.message ?? 'failed')
  }

  // 预设指令：点"应用"后把内容写入剪贴板并落到新会话输入（简化：复制）
  return (
    <div className={css.root}>
      <section className={css.section}>
        <h2 className={css.sectionTitle}>{t('sessions.new')}</h2>
        <VHModeCards t={t} onSelectMode={preset => { void handleLaunch(preset) }} />
        {launching && <p className={css.note}>{t('tools.saving')}</p>}
        {launchError !== null && <p className={css.error}>{launchError}</p>}
      </section>

      <section className={css.section}>
        <h2 className={css.sectionTitle}>{t('sessions.history')}</h2>
        {rows.length === 0 ? (
          <p className={css.empty}>{t('sessions.empty')}</p>
        ) : (
          <div className={css.sessionList}>
            {rows.map(row => (
              <button
                key={row.id}
                type="button"
                className={clsx(css.sessionRow, row.current && css.sessionCurrent)}
                onClick={() => { openSession(row.id); vhShell.set(null) }}
              >
                <span className={clsx(css.sessionDot, row.running && css.sessionRunning)} aria-hidden="true" />
                <span className={css.sessionTitle}>{row.displayTitle}</span>
                {row.agentPreset !== undefined && (
                  <span className={css.sessionPreset}>{row.agentPreset}</span>
                )}
                <span className={css.sessionTime}>{formatTime(row.updatedAt)}</span>
              </button>
            ))}
          </div>
        )}
      </section>

      <section className={css.section}>
        <h2 className={css.sectionTitle}>{t('sessions.presets')}</h2>
        <div className={css.prompts}>
          <PromptPanel />
        </div>
      </section>
    </div>
  )
}

/** 相对时间显示。 */
function formatTime(epochMs: number): string {
  const then = epochMs
  if (!Number.isFinite(then) || then <= 0) return ''
  const diff = Date.now() - then
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}
