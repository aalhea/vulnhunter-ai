/**
 * Topology — 通用链式拓扑图（横向主链 + 每节点状态色/指标 + 连线流动动画）。
 * 纯 CSS/SVG 实现，双主题令牌取色，reduced-motion 时停用流动。
 */
import clsx from 'clsx'
import css from './Topology.module.css'

export type TopoState = 'ok' | 'error' | 'running' | 'pending'

export interface TopoNode {
  /** 节点主标题 */
  label: string
  /** 副标题（工具名/端口等） */
  sub?: string | undefined
  /** 状态徽标文字（如 "12s"、"26 条"） */
  metric?: string | undefined
  state: TopoState
}

export interface TopologyProps {
  nodes: readonly TopoNode[]
  className?: string | undefined
}

/** 横向链式拓扑：节点卡片 + 箭头连线（ok 段流动）。 */
export function Topology({ nodes, className }: TopologyProps) {
  return (
    <div className={clsx(css.topo, className)} role="img">
      {nodes.map((node, idx) => (
        <div key={`${node.label}-${idx}`} className={css.unit}>
          {idx > 0 && (
            <div
              className={clsx(
                css.link,
                node.state === 'ok' && css.linkOk,
                node.state === 'running' && css.linkRun,
                node.state === 'error' && css.linkBad,
              )}
              aria-hidden="true"
            >
              <svg viewBox="0 0 40 12" className={css.linkSvg} preserveAspectRatio="none">
                <line x1="0" y1="6" x2="40" y2="6" className={css.linkLine} />
                <polygon points="34,2 40,6 34,10" className={css.linkHead} />
              </svg>
            </div>
          )}
          <div
            className={clsx(
              css.node,
              node.state === 'ok' && css.ok,
              node.state === 'error' && css.bad,
              node.state === 'running' && css.run,
            )}
          >
            <span className={css.dot} aria-hidden="true" />
            <span className={css.label}>{node.label}</span>
            {node.sub !== undefined && <span className={css.sub}>{node.sub}</span>}
            {node.metric !== undefined && <span className={css.metric}>{node.metric}</span>}
          </div>
        </div>
      ))}
    </div>
  )
}
