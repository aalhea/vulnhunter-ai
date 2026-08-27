/**
 * VulnHunter shell state — which full-screen page (if any) overlays the
 * conversation. A module-level observable shared by the sidebar nav and the
 * shell.overlay pages host; both consumers live in this one client bundle, so
 * the module scope IS the single source of truth (no cross-bundle handle).
 */
import { useSyncExternalStore } from 'react'

/** Pages the shell can overlay above the conversation. */
export type VhPage = 'sessions' | 'mcp' | 'skills' | 'tools'

let page: VhPage | null = null
const subscribers = new Set<() => void>()

export const vhShell = {
  get(): VhPage | null { return page },
  set(next: VhPage | null): void {
    if (next === page) return
    page = next
    for (const notify of subscribers) notify()
  },
  /** Clicking the active nav item closes the page (back to conversation). */
  toggle(target: VhPage): void { vhShell.set(page === target ? null : target) },
  subscribe(fn: () => void): () => void {
    subscribers.add(fn)
    return () => { subscribers.delete(fn) }
  },
}

/** Reactive page for React consumers. */
export function useVhPage(): VhPage | null {
  return useSyncExternalStore(vhShell.subscribe, vhShell.get)
}
