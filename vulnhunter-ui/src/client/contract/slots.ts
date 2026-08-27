/**
 * VulnHunter slot contract: declarations for the vulnhunter-owned slots
 * and the injected data/action faces shared by the sidebar, the overlay
 * pages host, and the composer preset chip.
 */
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** VulnHunter sidebar — replaces the entire sidebar slot. */
    'vulnhunter.sidebar': { kind: 'single'; scope: 'root'; owner: VulnHunterSidebarOwnerProps }
  }
}

/** Sidebar owner share (from the layout frame). */
export interface VulnHunterSidebarOwnerProps {
  collapsed: boolean
  width: number
}

/** Session row projected from the client sessions feed. */
export interface VulnHunterSessionRow {
  id: string
  displayTitle: string
  running: boolean
  blank: boolean
  /** Epoch milliseconds of the last update. */
  updatedAt: number
  agentPreset?: string | undefined
  current: boolean
}

/** Preset roster row (subset of the wire AgentPresetEntry the chip needs). */
export interface VulnHunterPresetRow {
  id: string
  name?: string | undefined
  description?: string | undefined
  isDefault: boolean
}

/** Tool governance state persisted by the host data routes. */
export interface VulnHunterToolPolicy {
  disabled: string[]
  instructions: Record<string, string>
}

/** Tool catalog row served by the host data routes. */
export interface VulnHunterToolRow {
  name: string
  group: string
  desc: string
}

/** Environment status from the data service. */
export interface VulnHunterEnvStatus {
  tools: readonly { name: string; ok: boolean; path: string }[]
  services: readonly { name: string; ok: boolean; note: string }[]
  keys: Record<string, boolean>
}

/** Target summary row from the artifacts ledger. */
export interface VulnHunterTargetRow {
  target: string
  ledger: number
  confirmed: number
  runs: number
  lastRun: string
}

/** Pipeline run row inside a target's state.json. */
export interface VulnHunterRunRow {
  seq: number
  stepId: string
  state: string
  startedAt: string
  durationMs: number
  summary?: string | undefined
}

/** Injected callbacks shared across the VulnHunter surfaces. */
export interface VulnHunterSidebarInjected {
  startSession: (preset?: string) => void
  toggleSidebar: () => void
  fetchSkills: () => Promise<readonly string[]>
  fetchEnv: () => Promise<VulnHunterEnvStatus>
  /** Subscribe to resolved color-scheme changes ('light' | 'dark'). Returns the disposer. */
  subscribeTheme?: (cb: (scheme: 'light' | 'dark') => void) => () => void
  /** Flip between the light and dark concrete themes (persisted). */
  toggleTheme?: () => void
  /** Sessions feed: snapshot getter + change subscription (disposer returned). */
  getSessions?: () => readonly VulnHunterSessionRow[]
  subscribeSessions?: (cb: () => void) => () => void
  /** Open an existing session in the conversation area. */
  openSession?: (sessionId: string) => void
  /** Create a session in the recent workspace and mount the given agent preset. */
  launchPreset?: (preset: string) => Promise<{ ok: boolean; message?: string | undefined }>
  /** Preset roster for the chip / sessions page. */
  listPresets?: () => Promise<readonly VulnHunterPresetRow[]>
  /** Apply a preset to a (blank) session. */
  applyPreset?: (sessionId: string, preset: string) => Promise<{ ok: boolean; message?: string | undefined }>
  /** Tool catalog + persisted governance policy. */
  fetchTools?: () => Promise<{ tools: readonly VulnHunterToolRow[]; policy: VulnHunterToolPolicy }>
  /** Merge-save the tool governance policy. */
  saveToolPolicy?: (patch: Partial<VulnHunterToolPolicy>) => Promise<{ ok: boolean; message?: string | undefined }>
  /** Targets summary (artifacts ledger) for the pipeline topology. */
  fetchTargets?: () => Promise<readonly VulnHunterTargetRow[]>
  /** Pipeline runs for a target (state.json runs array). */
  fetchRuns?: (target: string) => Promise<readonly VulnHunterRunRow[]>
}
