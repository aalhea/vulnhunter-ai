/**
 * VulnHunter UI entry point (browser half).
 * Pure `.ts` file — no JSX here, JSX is in registration.tsx.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the theme plugin's Context merge (ctx.theme) into this program.
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
import type {
  VulnHunterPresetRow,
  VulnHunterSessionRow,
  VulnHunterSidebarInjected,
} from './contract/slots.ts'
import { registerSidebar, registerShellPages, registerHeroBrandMark, registerHeroWorkspace, registerPresetChip } from './registration.tsx'
import { sessionsFeed } from './feeds.ts'
import { en, zh, type VulnHunterKey } from './locales.ts'

export type { VulnHunterSidebarInjected } from './contract/slots.ts'
export type { VulnHunterKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    vulnhunter: VulnHunterKey
  }
}

const NS = 'vulnhunter'

/** Loose view of the api-remotes client handle (avoids a hard type dep here). */
interface PresetApi {
  agentPresets: {
    list(req: Record<string, never>): Promise<PresetListResp>
    select(req: { sessionId: string; agentPreset: string }): Promise<PresetSelectResp>
  }
}
/**
 * Wire responses arrive in two shapes across builds — the wrapped
 * `{ok,value}|{ok:false,error:{code,message}}` form and a flat
 * `{...data}|{ok:false,code,message}` form. Read both defensively.
 */
type RpcErr = { ok: false; error?: { code?: string; message?: string }; code?: string; message?: string }
type PresetRowWire = { id: string; name?: string; description?: string; isDefault?: boolean }
type PresetListResp = { ok: true; value?: { presets?: readonly PresetRowWire[] }; presets?: readonly PresetRowWire[] } | RpcErr
type PresetSelectResp = { ok: true; value?: { agentPreset?: string }; agentPreset?: string } | RpcErr

/** Normalize an RPC-ish response into {ok, code, message}. */
function readRpc(resp: unknown): { ok: boolean; code?: string | undefined; message?: string | undefined } {
  const r = resp as { ok?: boolean; error?: { code?: string; message?: string }; code?: string; message?: string }
  if (r !== null && typeof r === 'object' && r.ok === false) {
    const code = r.error?.code ?? r.code
    const message = r.error?.message ?? r.message
    return { ok: false, ...(code !== undefined ? { code } : {}), ...(message !== undefined ? { message } : {}) }
  }
  return { ok: true }
}

export const inject = ['slots', 'layout', 'sessions', 'workspaces', 'locale', 'theme', 'connection']

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-vulnhunter: dictionaries')

  // Theme control face for the sidebar toggle: resolved-scheme subscription
  // plus a persisted light/dark flip through the ui-theme service.
  const subscribeTheme = (cb: (scheme: 'light' | 'dark') => void): (() => void) =>
    ctx.on('theme/change', (snapshot) => { cb(snapshot.active.colorScheme) })
  const toggleTheme = (): void => {
    const current = ctx.theme.getTheme().active.colorScheme
    ctx.theme.setTheme(current === 'dark' ? 'light' : 'dark')
  }

  // Wire API handle for agent-preset listing/selection.
  const api = (ctx.get('connection') as { api?: PresetApi } | undefined)?.api

  const listPresets = async (): Promise<readonly VulnHunterPresetRow[]> => {
    if (api === undefined) return []
    try {
      const resp = await api.agentPresets.list({})
      if (!readRpc(resp).ok) return []
      const rows = resp.ok && resp.value !== undefined ? resp.value.presets : (resp as { presets?: readonly PresetRowWire[] }).presets
      return (rows ?? []).map(row => ({
        id: row.id,
        ...(row.name !== undefined ? { name: row.name } : {}),
        ...(row.description !== undefined ? { description: row.description } : {}),
        isDefault: row.isDefault === true,
      }))
    } catch { return [] }
  }

  const applyPreset = async (sessionId: string, preset: string): Promise<{ ok: boolean; message?: string | undefined }> => {
    if (api === undefined) return { ok: false, message: 'api unavailable' }
    try {
      const resp = await api.agentPresets.select({ sessionId, agentPreset: preset })
      const verdict = readRpc(resp)
      if (verdict.ok) {
        ctx.sessions.noteAgentPreset(sessionId as never, preset)
        return { ok: true }
      }
      return {
        ok: false,
        message: verdict.code === 'agent-preset-locked' ? 'locked' : (verdict.message ?? verdict.code ?? 'select failed'),
      }
    } catch (err) {
      return { ok: false, message: String(err) }
    }
  }

  // `create` exists on the runtime service but predates the ISessions contract;
  // the narrow cast documents the runtime guarantee (wire supports agentPreset
  // too, which we apply right after creation while the session is blank).
  const sessionsSvc = ctx.sessions as typeof ctx.sessions & {
    create(opts?: { workspaceId?: string }): Promise<string>
  }

  /**
   * Launch a session bound to a mode preset: create a blank session in the
   * recent workspace, apply the preset while it is still blank, then open it.
   * Any failure degrades to a plain session instead of blocking the user.
   */
  const launchPreset = async (preset: string): Promise<{ ok: boolean; message?: string | undefined }> => {
    try {
      const ws = ctx.workspaces.list.getSnapshot()
      const workspaceId = ws.recentWorkspaceId ?? ws.items[0]?.workspaceId
      const sessionId = await sessionsSvc.create(workspaceId === undefined ? {} : { workspaceId })
      const applied = await applyPreset(sessionId, preset)
      ctx.sessions.open(sessionId as never)
      return applied.ok
        ? { ok: true }
        : { ok: false, message: applied.message ?? 'preset unavailable' }
    } catch (err) {
      // Fallback: plain session via the workspace flow.
      try {
        ctx.workspaces.startSession(undefined)
        return { ok: false, message: String(err) }
      } catch {
        return { ok: false, message: String(err) }
      }
    }
  }

  // Sessions feed: project the runtime snapshot into UI rows and push it into
  // the module-level reactive store shared by sidebar + pages.
  const projectSessions = (): readonly VulnHunterSessionRow[] => {
    const state = ctx.sessions.list.getSnapshot()
    return state.ids
      .map(id => state.byId[id])
      .filter(row => row !== undefined)
      .map(row => ({
        id: row.id,
        displayTitle: row.displayTitle,
        running: row.running,
        blank: row.blank,
        updatedAt: typeof row.updatedAt === 'number' ? row.updatedAt : Date.parse(String(row.updatedAt)) || 0,
        ...(row.agentPreset !== undefined ? { agentPreset: row.agentPreset } : {}),
        current: state.current === row.id,
      }))
  }
  ctx.effect(() => {
    sessionsFeed.attach(projectSessions, ctx.sessions.list.subscribe.bind(ctx.sessions.list))
    return () => { sessionsFeed.detach() }
  }, 'ui-vulnhunter: sessions feed')

  const fetchTools = async (): Promise<{ tools: readonly { name: string; group: string; desc: string }[]; policy: { disabled: string[]; instructions: Record<string, string> } }> => {
    try {
      const res = await fetch('/vulnhunter-api/tools')
      if (!res.ok) return { tools: [], policy: { disabled: [], instructions: {} } }
      return await res.json() as { tools: readonly { name: string; group: string; desc: string }[]; policy: { disabled: string[]; instructions: Record<string, string> } }
    } catch {
      return { tools: [], policy: { disabled: [], instructions: {} } }
    }
  }

  const saveToolPolicy = async (patch: { disabled?: string[]; instructions?: Record<string, string> }): Promise<{ ok: boolean; message?: string | undefined }> => {
    try {
      const res = await fetch('/vulnhunter-api/tools/policy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (!res.ok) return { ok: false, message: `HTTP ${res.status}` }
      return { ok: true }
    } catch (err) {
      return { ok: false, message: String(err) }
    }
  }

  const fetchTargets = async () => {
    try {
      const res = await fetch('/vulnhunter-api/targets')
      if (!res.ok) return []
      return await res.json() as readonly { target: string; ledger: number; confirmed: number; runs: number; lastRun: string }[]
    } catch { return [] }
  }

  const fetchRuns = async (target: string) => {
    try {
      const res = await fetch(`/vulnhunter-api/state?target=${encodeURIComponent(target)}`)
      if (!res.ok) return []
      const state = await res.json() as { runs?: { seq: number; stepId: string; state: string; startedAt: string; durationMs: number; summary?: string }[] }
      return (state.runs ?? []).map(run => ({ ...run }))
    } catch { return [] }
  }

  const injected: VulnHunterSidebarInjected = {
    startSession: (_preset?: string) => {
      ctx.workspaces.startSession(undefined)
    },
    toggleSidebar: () => ctx.layout.toggleSidebar(),
    subscribeTheme,
    toggleTheme,
    fetchSkills: async () => {
      try {
        const res = await fetch('/vulnhunter-api/skills')
        if (!res.ok) return []
        return (await res.json()) as string[]
      } catch { return [] }
    },
    fetchEnv: async () => {
      try {
        const res = await fetch('/vulnhunter-api/env')
        if (!res.ok) return { tools: [], services: [], keys: {} }
        return (await res.json()) as { tools: readonly { name: string; ok: boolean; path: string }[]; services: readonly { name: string; ok: boolean; note: string }[]; keys: Record<string, boolean> }
      } catch { return { tools: [], services: [], keys: {} } }
    },
    getSessions: projectSessions,
    subscribeSessions: (cb: () => void) => ctx.sessions.list.subscribe(cb),
    openSession: (sessionId: string) => { ctx.sessions.open(sessionId as never) },
    launchPreset,
    listPresets,
    applyPreset,
    fetchTools,
    saveToolPolicy,
    fetchTargets,
    fetchRuns,
  }

  registerSidebar(ctx, injected)
  registerShellPages(ctx, injected)
  registerHeroBrandMark(ctx)
  registerHeroWorkspace(ctx, injected)
  registerPresetChip(ctx, injected)
}
