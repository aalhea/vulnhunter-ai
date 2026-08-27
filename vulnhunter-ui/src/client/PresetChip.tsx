/**
 * PresetChip — 输入框上方的模式指示 chip。
 * 显示当前会话绑定的 agent preset；点击弹出 roster 选择；blank 会话可切换。
 */
import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { VulnHunterPresetRow, VulnHunterSidebarInjected } from './contract/slots.ts'
import { sessionsFeed } from './feeds.ts'
import { useSyncExternalStore } from 'react'
import css from './PresetChip.module.css'

type T = PropsLocale<'vulnhunter'>['t']

export interface PresetChipProps {
  t: T
  injected: VulnHunterSidebarInjected
}

/** composer.dock 上的模式 chip（右对齐）。 */
export function PresetChip({ t, injected }: PresetChipProps) {
  const sessions = useSyncExternalStore(sessionsFeed.subscribe, sessionsFeed.getSnapshot)
  const current = sessions.find(row => row.current)

  const [open, setOpen] = useState(false)
  const [presets, setPresets] = useState<readonly VulnHunterPresetRow[]>([])
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    void injected.listPresets?.().then(rows => { if (!cancelled) setPresets(rows) })
    const onDocClick = (e: MouseEvent): void => {
      if (rootRef.current !== null && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => {
      cancelled = true
      document.removeEventListener('mousedown', onDocClick)
    }
  }, [open, injected.listPresets])

  if (current === undefined) return null

  const currentPreset = current.agentPreset

  const handleSelect = (id: string): void => {
    if (busy) return
    setBusy(true)
    void injected.applyPreset?.(current.id, id).then(result => {
      setBusy(false)
      if (result.ok) {
        setOpen(false)
        setNotice(null)
      } else {
        setNotice(result.message === 'locked' ? t('chip.locked') : result.message ?? 'failed')
      }
    })
  }

  return (
    <div className={css.wrap} ref={rootRef}>
      <button
        type="button"
        className={clsx(css.chip, open && css.chipOpen)}
        onClick={() => setOpen(prev => !prev)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className={css.chipLabel}>{t('chip.preset')}</span>
        <span className={css.chipValue}>{currentPreset ?? 'standard'}</span>
        <span className={clsx(css.caret, open && css.caretOpen)} aria-hidden="true">▾</span>
      </button>
      {notice !== null && <span className={css.notice}>{notice}</span>}
      {open && (
        <div className={css.menu} role="listbox">
          {presets.length === 0 && <div className={css.menuEmpty}>…</div>}
          {presets.map(preset => (
            <button
              key={preset.id}
              type="button"
              role="option"
              aria-selected={preset.id === currentPreset}
              className={clsx(css.item, preset.id === currentPreset && css.itemActive)}
              onClick={() => handleSelect(preset.id)}
              disabled={busy}
            >
              <span className={css.itemName}>{preset.name ?? preset.id}</span>
              {preset.isDefault && <span className={css.itemDefault}>default</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
