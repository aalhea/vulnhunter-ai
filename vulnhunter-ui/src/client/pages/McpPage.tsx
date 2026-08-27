/**
 * McpPage — MCP 服务页：服务/工具/密钥探活 + 链路拓扑。
 */
import { useCallback, useEffect, useState } from 'react'
import clsx from 'clsx'
import type { VulnHunterEnvStatus } from '../contract/slots.ts'
import type { T } from './PagesHost.tsx'
import { Topology, type TopoState } from './Topology.tsx'
import css from './McpPage.module.css'

export interface McpPageProps {
  t: T
  fetchEnv: () => Promise<VulnHunterEnvStatus>
}

/** MCP 服务页。 */
export function McpPage({ t, fetchEnv }: McpPageProps) {
  const [env, setEnv] = useState<VulnHunterEnvStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true)
    try {
      const data = await fetchEnv()
      setEnv(data)
      setError(null)
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [fetchEnv])

  useEffect(() => { void load() }, [load])

  if (loading) {
    return (
      <div className={css.root}>
        <div className={css.skeleton} />
        <div className={css.skeleton} />
        <div className={css.skeleton} />
      </div>
    )
  }

  const data = env ?? { tools: [], services: [], keys: {} }
  const svcState = (ok: boolean): TopoState => (ok ? 'ok' : 'pending')

  return (
    <div className={css.root}>
      <div className={css.toolbar}>
        <h2 className={css.title}>{t('mcp.services')}</h2>
        <button
          type="button"
          className={clsx(css.refresh, refreshing && css.spinning)}
          onClick={() => { void load(true) }}
          disabled={refreshing}
          aria-label={t('common.refresh')}
        >
          ↻
        </button>
      </div>

      <Topology
        nodes={[
          { label: 'VulnHunter UI', sub: 'client plugin', state: 'ok' },
          ...data.services.map(svc => ({
            label: svc.name,
            sub: svc.note,
            state: svcState(svc.ok),
          })),
        ]}
      />

      {error !== null && <p className={css.error}>{error}</p>}

      <div className={css.grid}>
        <section className={css.card}>
          <h3 className={css.cardTitle}>{t('mcp.services')}</h3>
          {data.services.map(svc => (
            <div key={svc.name} className={css.row}>
              <span className={clsx(css.dot, svc.ok ? css.dotOk : css.dotBad)} />
              <span className={css.name}>{svc.name}</span>
              <span className={css.noteText}>{svc.note}</span>
              <span className={clsx(css.state, svc.ok ? css.stateOk : css.stateBad)}>
                {svc.ok ? t('status.online') : t('status.offline')}
              </span>
            </div>
          ))}
        </section>

        <section className={css.card}>
          <h3 className={css.cardTitle}>{t('mcp.tools')}</h3>
          {data.tools.map(tool => (
            <div key={tool.name} className={css.row}>
              <span className={clsx(css.dot, tool.ok ? css.dotOk : css.dotIdle)} />
              <span className={css.name}>{tool.name}</span>
              <span className={clsx(css.state, tool.ok ? css.stateOk : css.stateIdle)}>
                {tool.ok ? '✓' : '✗'}
              </span>
            </div>
          ))}
        </section>

        <section className={css.card}>
          <h3 className={css.cardTitle}>{t('mcp.keys')}</h3>
          {Object.entries(data.keys).map(([key, ok]) => (
            <div key={key} className={css.row}>
              <span className={css.keyIcon}>🔑</span>
              <span className={css.name}>{key}</span>
              <span className={clsx(css.state, ok ? css.stateOk : css.stateIdle)}>
                {ok ? '✓' : '✗'}
              </span>
            </div>
          ))}
        </section>
      </div>
    </div>
  )
}
