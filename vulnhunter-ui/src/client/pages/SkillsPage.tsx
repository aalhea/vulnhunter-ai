/**
 * SkillsPage — 技能库页：技能目录 + 分类拓扑。
 */
import { SkillsPanel } from '../SkillsPanel.tsx'
import { Topology } from './Topology.tsx'
import css from './SkillsPage.module.css'

export interface SkillsPageProps {
  fetchSkills: () => Promise<readonly string[]>
}

/** 技能库页。 */
export function SkillsPage({ fetchSkills }: SkillsPageProps) {
  return (
    <div className={css.root}>
      <Topology
        nodes={[
          { label: 'vulnhunter agent', sub: 'presets ×4', state: 'ok' },
          { label: 'VulnHunter 技能', sub: 'vh-*', state: 'ok', metric: '16' },
          { label: 'Yakit 集成', sub: 'yak(it)-*', state: 'ok', metric: '10' },
        ]}
      />
      <div className={css.panel}>
        <SkillsPanel fetchSkills={fetchSkills} />
      </div>
    </div>
  )
}
