/**
 * VHModeCards — 四模式入口卡片（缩写版）。
 * 主视觉为渐变缩写字母方块，下方一行精简介绍；hover 上浮发光，点击回弹。
 */
import { useEffect, useState } from 'react'
import clsx from 'clsx'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { VulnHunterKey } from './locales.ts'
import css from './VHModeCards.module.css'

interface ModeCard {
  key: string
  preset: string
  gradient: string
  icon: string
  /** 完整名称仅用于 aria-label，不再占版面 */
  titleKey: VulnHunterKey
  descKey: VulnHunterKey
}

/** 四种渗透测试模式 */
const MODES: readonly ModeCard[] = [
  {
    key: 'nova',
    preset: 'vulnhunter',
    gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    icon: 'N',
    titleKey: 'mode.nova.title',
    descKey: 'mode.nova.desc',
  },
  {
    key: 'scout',
    preset: 'vulnhunter-recon',
    gradient: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
    icon: 'S',
    titleKey: 'mode.scout.title',
    descKey: 'mode.scout.desc',
  },
  {
    key: 'raider',
    preset: 'vulnhunter-web',
    gradient: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
    icon: 'R',
    titleKey: 'mode.raider.title',
    descKey: 'mode.raider.desc',
  },
  {
    key: 'pebble',
    preset: 'vulnhunter-miniapp',
    gradient: 'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
    icon: 'P',
    titleKey: 'mode.pebble.title',
    descKey: 'mode.pebble.desc',
  },
]

export interface VHModeCardsProps {
  t: PropsLocale<'vulnhunter'>['t']
  onSelectMode?: (preset: string) => void
  /** 紧凑模式（用于侧边栏），默认 false */
  compact?: boolean
}

/**
 * 渲染四模式入口卡片。
 * 加载时交错入场，hover 上浮发光，点击回弹。
 * @param props - 本地化 + 选择回调 + 紧凑模式
 */
export function VHModeCards({ t, onSelectMode, compact = false }: VHModeCardsProps) {
  const [entered, setEntered] = useState(false)
  const [clickedKey, setClickedKey] = useState<string | null>(null)

  useEffect(() => {
    const timer = window.setTimeout(() => setEntered(true), 50)
    return () => window.clearTimeout(timer)
  }, [])

  const handleClick = (preset: string, key: string) => {
    setClickedKey(key)
    window.setTimeout(() => {
      setClickedKey(null)
      onSelectMode?.(preset)
    }, 200)
  }

  return (
    <div className={clsx(css.container, compact && css.compact)}>
      <div className={css.modeGrid}>
        {MODES.map((mode, idx) => (
          <div
            key={mode.key}
            className={clsx(
              css.modeCard,
              entered && css.entered,
              clickedKey === mode.key && css.clicked,
            )}
            style={{ animationDelay: entered ? `${idx * 80}ms` : '0ms' }}
            onClick={() => handleClick(mode.preset, mode.key)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                handleClick(mode.preset, mode.key)
              }
            }}
            role="button"
            tabIndex={0}
            aria-label={t(mode.titleKey)}
            title={t(mode.titleKey)}
          >
            <span className={css.cardIcon} style={{ background: mode.gradient }}>
              <span className={css.cardIconText}>{mode.icon}</span>
            </span>
            <span className={css.cardDesc}>{t(mode.descKey)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
