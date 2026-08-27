/**
 * VulnHunterSidebar — 导航式侧边栏，替换原 SidebarRoot。
 * 第一项=会话中心（含模式入口与历史），MCP/Skills/工具 各自切换全屏页面；
 * 下方四模式快捷卡直接按 preset 开会话；顶部主题切换 + 折叠。
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import clsx from 'clsx'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { IconPanelLeftOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { VHIcon } from './VHIcon.tsx'
import { VHModeCards } from './VHModeCards.tsx'
import { vhShell, useVhPage, type VhPage } from './store.ts'
import { sessionsFeed } from './feeds.ts'
import type { VulnHunterSidebarInjected } from './contract/slots.ts'
import css from './VulnHunterSidebar.module.css'

/** 框架按注册声明的 locale 命名空间合成的翻译函数 */
type T = PropsLocale<'vulnhunter'>['t']

export interface VulnHunterSidebarProps {
  /** Layout 侧边栏状态 */
  collapsed: boolean
  /** 列宽 */
  width: number
  /** 本地化函数（vulnhunter 命名空间，由框架合成） */
  t: T
  /** 注入面 */
  injected: VulnHunterSidebarInjected
}

/** 折叠动画常驻时间 */
const COLLAPSE_SETTLE_MS = 150

/** 太阳图标（当前深色，点击切浅色） */
function SunIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4.4" />
      <path d="M12 2.5v2.6M12 18.9v2.6M2.5 12h2.6M18.9 12h2.6M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M18.7 5.3l-1.8 1.8M7.1 16.9l-1.8 1.8" />
    </svg>
  )
}

/** 月亮图标（当前浅色，点击切深色） */
function MoonIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
      <path d="M20.6 14.1A8.8 8.8 0 0 1 9.9 3.4a8.8 8.8 0 1 0 10.7 10.7Z" />
    </svg>
  )
}

/** 会话图标 */
function SessionsIcon({ active }: { active: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.2-.6L3 20l1.9-4.1a8.4 8.4 0 1 1 16.1-4.4Z" />
      {active && <path d="M8.5 10.5h7M8.5 14h4.5" />}
    </svg>
  )
}

/** MCP 插座图标 */
function McpIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="8" width="18" height="8" rx="2" />
      <path d="M8 8V5.5M16 8V5.5M8 16v2.5M16 16v2.5" />
    </svg>
  )
}

/** 技能图标 */
function SkillsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="3.4" />
      <path d="M12 3.5v5M12 15.5v5M3.5 12h5M15.5 12h5" />
    </svg>
  )
}

/** 工具图标 */
function ToolsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14.5 6.5a4 4 0 0 1 5.6-5l-2.8 2.8 2.4 2.4L22.5 4a4 4 0 0 1-5 5.6L8 19.1a2.1 2.1 0 0 1-3-3l9.5-9.6Z" />
      <path d="M4.5 4.5 8 8" />
    </svg>
  )
}

/**
 * 渲染 VulnHunter 导航侧边栏。
 * 展开时：品牌行 / 导航四项 / 模式快捷卡；折叠后：Rail 图标列。
 */
export function VulnHunterSidebar({
  collapsed,
  width,
  t,
  injected,
}: VulnHunterSidebarProps) {
  const [settled, setSettled] = useState(collapsed)
  useEffect(() => {
    if (!collapsed) { setSettled(false); return }
    const timer = window.setTimeout(() => setSettled(true), COLLAPSE_SETTLE_MS)
    return () => window.clearTimeout(timer)
  }, [collapsed])
  const wide = !collapsed || !settled

  const lastWideWidth = useRef(width)
  if (!collapsed) lastWideWidth.current = width

  const everWide = useRef(!collapsed)
  if (!collapsed) everWide.current = true

  const page = useVhPage()
  const sessions = useSyncExternalStore(sessionsFeed.subscribe, sessionsFeed.getSnapshot)
  const liveSessions = sessions.filter(s => !s.blank).length

  // 主题解析状态（首个快照到达前按深色处理）
  const [scheme, setScheme] = useState<'light' | 'dark'>('dark')
  useEffect(() => {
    if (!injected.subscribeTheme) return
    return injected.subscribeTheme(setScheme)
  }, [injected.subscribeTheme])

  const [launching, setLaunching] = useState(false)

  const navItems: readonly { key: VhPage; label: string; icon: React.ReactNode; badge?: string | undefined }[] = [
    { key: 'sessions', label: t('nav.sessions'), icon: <SessionsIcon active={page === 'sessions'} />, badge: liveSessions > 0 ? String(liveSessions) : undefined },
    { key: 'mcp', label: 'MCP', icon: <McpIcon /> },
    { key: 'skills', label: t('panel.skills'), icon: <SkillsIcon /> },
    { key: 'tools', label: t('panel.tools'), icon: <ToolsIcon /> },
  ]

  const themeAria = t(scheme === 'dark' ? 'theme.toLight' : 'theme.toDark')

  return (
    <div
      className={clsx(
        css.root,
        !wide && css.collapsed,
        !wide && everWide.current && css.railIn,
        collapsed && wide && css.fading,
      )}
      style={wide ? { width: collapsed ? lastWideWidth.current : width } : undefined}
    >
      {/* 品牌行 */}
      <div className={css.brandRow}>
        {wide && (
          <button
            type="button"
            className={clsx(css.brand, css.wide)}
            aria-label={t('sidebar.brand')}
            onClick={() => vhShell.set(null)}
          >
            <span className={css.brandIdentity}>
              <VHIcon size={22} glowOnHover />
              <span className={css.brandName}>VulnHunter</span>
            </span>
          </button>
        )}
        <button
          type="button"
          className={css.iconButton}
          aria-label={themeAria}
          title={themeAria}
          onClick={() => injected.toggleTheme?.()}
        >
          {scheme === 'dark' ? <SunIcon /> : <MoonIcon />}
        </button>
        <button
          type="button"
          className={clsx(css.iconButton, css.toggle)}
          aria-label={collapsed ? t('sidebar.expand') : t('sidebar.collapse')}
          onClick={() => injected.toggleSidebar()}
        >
          {!wide && <VHIcon size={22} glowOnHover />}
          <IconPanelLeftOutline16 className={css.panelIcon} size={wide ? 16 : 18} />
        </button>
      </div>

      {wide && (
        <div className={css.body}>
          {/* 导航区 */}
          <nav className={css.nav}>
            {navItems.map(item => (
              <button
                key={item.key}
                type="button"
                className={clsx(css.navItem, page === item.key && css.navItemActive)}
                aria-current={page === item.key ? 'page' : undefined}
                onClick={() => vhShell.toggle(item.key)}
              >
                <span className={css.navIcon}>{item.icon}</span>
                <span className={css.navLabel}>{item.label}</span>
                {item.badge !== undefined && <span className={css.navBadge}>{item.badge}</span>}
              </button>
            ))}
          </nav>

          {/* 模式快捷卡 */}
          <div className={css.modeSection}>
            <VHModeCards
              t={t}
              compact
              onSelectMode={(preset) => {
                if (launching) return
                setLaunching(true)
                void injected.launchPreset?.(preset).finally(() => setLaunching(false))
              }}
            />
          </div>
        </div>
      )}
    </div>
  )
}
