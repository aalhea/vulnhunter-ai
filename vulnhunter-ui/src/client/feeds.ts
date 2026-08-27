/**
 * Module-level reactive feeds shared between the sidebar and the overlay
 * pages. `attach()` is called once from apply() with stable closures; both
 * consumers read through useSyncExternalStore with identity-stable fns.
 */
import type { VulnHunterSessionRow } from './contract/slots.ts'

interface Feed<T> {
  attach(get: () => T, subscribe: (cb: () => void) => () => void): void
  detach(): void
  subscribe(fn: () => void): () => void
  getSnapshot(): T
}

const createFeed = <T,>(initial: T): Feed<T> => {
  let value = initial
  let unsubscribe: (() => void) | null = null
  const subs = new Set<() => void>()
  const notify = (): void => { for (const fn of subs) fn() }
  return {
    attach(get, subscribe) {
      value = get()
      unsubscribe = subscribe(() => {
        value = get()
        notify()
      })
    },
    detach() {
      unsubscribe?.()
      unsubscribe = null
    },
    subscribe(fn) {
      subs.add(fn)
      return () => { subs.delete(fn) }
    },
    getSnapshot: () => value,
  }
}

/** Live sessions feed (rows already projected for the UI). */
export const sessionsFeed = createFeed<readonly VulnHunterSessionRow[]>([])

