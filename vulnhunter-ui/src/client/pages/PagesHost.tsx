/**
 * PagesHost — shell.overlay 全屏页面容器。
 * 依据共享 shell 状态渲染 会话/MCP/Skills/工具 页；conversation 常驻其下不卸载。
 */
import clsx from 'clsx'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { useVhPage, vhShell, type VhPage } from '../store.ts'
import type { VulnHunterSidebarInjected } from '../contract/slots.ts'
import { SessionsPage } from './SessionsPage.tsx'
import { McpPage } from './McpPage.tsx'
import { SkillsPage } from './SkillsPage.tsx'
import { ToolsPage } from './ToolsPage.tsx'
import css from './PagesHost.module.css'

/** 框架按注册声明的 locale 命名空间合成的翻译函数（各页面共享别名）。 */
export type T = PropsLocale<'vulnhunter'>['t']

export interface PagesHostProps {
  t: T
  injected: VulnHunterSidebarInjected
}

const PAGE_ORDER: readonly VhPage[] = ['sessions', 'mcp', 'skills', 'tools']

/** 全屏页面壳：header + 内容区 + 入场动画。 */
export function PagesHost({ t, injected }: PagesHostProps) {
  const page = useVhPage()

  if (page === null) return null

  return (
    <div className={css.host} data-page={page}>
      <header className={css.header}>
        <div className={css.tabs} role="tablist">
          {PAGE_ORDER.map(key => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={key === page}
              className={clsx(css.tab, key === page && css.tabActive)}
              onClick={() => vhShell.set(key)}
            >
              {key === 'sessions'
                ? t('page.sessions')
                : key === 'mcp'
                  ? t('page.mcp')
                  : key === 'skills'
                    ? t('page.skills')
                    : t('page.tools')}
            </button>
          ))}
        </div>
        <button
          type="button"
          className={css.close}
          aria-label={t('page.close')}
          title={t('page.close')}
          onClick={() => vhShell.set(null)}
        >
          ✕
        </button>
      </header>
      <main className={css.body}>
        <div key={page} className={css.pageIn}>
          {page === 'sessions' && (
            <SessionsPage
              t={t}
              launch={(preset) => injected.launchPreset?.(preset) ?? Promise.resolve({ ok: false, message: 'unavailable' })}
              openSession={(id) => injected.openSession?.(id)}
            />
          )}
          {page === 'mcp' && <McpPage t={t} fetchEnv={injected.fetchEnv} />}
          {page === 'skills' && <SkillsPage fetchSkills={injected.fetchSkills} />}
          {page === 'tools' && (
            <ToolsPage
              t={t}
              fetchTools={injected.fetchTools ?? (async () => ({ tools: [], policy: { disabled: [], instructions: {} } }))}
              saveToolPolicy={injected.saveToolPolicy ?? (async () => ({ ok: false, message: 'unavailable' }))}
              fetchTargets={injected.fetchTargets ?? (async () => [])}
              fetchRuns={injected.fetchRuns ?? (async () => [])}
            />
          )}
        </div>
      </main>
    </div>
  )
}
