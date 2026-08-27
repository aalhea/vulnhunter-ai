/**
 * VulnHunterRegistration — JSX slot registration helpers.
 * Separated from index.ts to avoid JSX in `.ts` files.
 *
 * Declaration-ordering rule: always inject on the EXACT slot key being
 * targeted (`slots.inject(key, cb)` waits for that key's declaration, which
 * happens inside the declaring parent's register call — e.g. ui-conversation
 * declares the hero.* seats when it registers 'conversation'). Injecting on a
 * PARENT instead fires before the child seat exists and register fails loud.
 *
 * Shadowing rule: single slots coexist per-priority and the LOWEST live entry
 * renders; same priority throws. Takeovers use priority -1 so the stock
 * occupants stay alive underneath and reappear automatically if VulnHunter is
 * removed. EXCEPTION — `conversation.hero.workspace` is NEVER shadowed: the
 * official WorkspacePicker (choose-workspace menu + directory flow) lives
 * there; shadowing it silently kills workspace selection. The mode cards ride
 * `conversation.hero.agentPreset` instead. List slots (shell.overlay /
 * composer.dock) are additive and use ids.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { VulnHunterSidebarInjected } from './contract/slots.ts'
import { VulnHunterSidebar } from './VulnHunterSidebar.tsx'
import { VHIcon } from './VHIcon.tsx'
import { VHModeCards } from './VHModeCards.tsx'
import { PagesHost } from './pages/PagesHost.tsx'
import { PresetChip } from './PresetChip.tsx'

/** 框架按注册声明的 locale 命名空间合成的翻译函数 */
type T = PropsLocale<'vulnhunter'>['t']

export function registerSidebar(ctx: ClientContext, injected: VulnHunterSidebarInjected): void {
  ctx.slots.inject('sidebar', () =>
    ctx.slots.register({
      name: 'sidebar',
      locale: 'vulnhunter',
      priority: -1,
    }, (props: { collapsed: boolean; width: number; t: T }) => (
      <VulnHunterSidebar
        collapsed={props.collapsed}
        width={props.width}
        t={props.t}
        injected={injected}
      />
    )),
  )
}

/** shell.overlay 全屏页面容器（list 槽位，additive）。 */
export function registerShellPages(ctx: ClientContext, injected: VulnHunterSidebarInjected): void {
  ctx.slots.inject('shell.overlay', () =>
    ctx.slots.register({
      name: 'shell.overlay',
      id: 'vulnhunter-pages',
      locale: 'vulnhunter',
    }, (props: { t: T }) => (
      <PagesHost t={props.t} injected={injected} />
    )),
  )
}

export function registerHeroBrandMark(ctx: ClientContext): void {
  ctx.slots.inject('conversation.hero.brand.mark', () =>
    ctx.slots.register({
      name: 'conversation.hero.brand.mark',
      locale: 'vulnhunter',
      priority: -1,
    }, ({ size, className }: { size: number; className?: string | undefined }) => (
      <VHIcon size={size} className={className} glowOnHover />
    )),
  )
}

/**
 * Hero 布局：`conversation.hero.workspace` 槽位**保持官方 WorkspacePicker**
 * （选择工作区菜单 + 目录添加流），VulnHunter 不占用；四模式卡改挂在同排的
 * `conversation.hero.agentPreset` 空洞（同时替换掉原生 preset chip，优先级 -1）。
 * 影子化 hero.workspace 会让选择菜单永不渲染——已踩坑。
 */
export function registerHeroWorkspace(ctx: ClientContext, injected: VulnHunterSidebarInjected): void {
  ctx.slots.inject('conversation.hero.agentPreset', () =>
    ctx.slots.register({
      name: 'conversation.hero.agentPreset',
      locale: 'vulnhunter',
      priority: -1,
    }, (_props: object) => (
      <VHModeCards
        t={(_props as { t: T }).t}
        onSelectMode={(preset: string) => { void injected.launchPreset?.(preset) }}
      />
    )),
  )
}

/**
 * 模式 chip：挂 composer.dock（会话框上方，列表槽位 additive）。
 * hero 区的原生 preset 座由 registerHeroWorkspace 用模式卡替换，不再另行隐藏。
 */
export function registerPresetChip(ctx: ClientContext, injected: VulnHunterSidebarInjected): void {
  ctx.slots.inject('conversation.composer.dock', () =>
    ctx.slots.register({
      name: 'conversation.composer.dock',
      id: 'vulnhunter-preset-chip',
      locale: 'vulnhunter',
    }, (props: { t: T }) => (
      <PresetChip t={props.t} injected={injected} />
    )),
  )
}
