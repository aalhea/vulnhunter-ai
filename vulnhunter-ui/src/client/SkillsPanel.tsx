/**
 * SkillsPanel — 交互式技能面板。
 * 搜索过滤 + 分类标签 + 树形分组列表 + 骨架屏 + 空/错误状态。
 */
import { useState, useEffect, useCallback, useMemo } from 'react'
import clsx from 'clsx'
import css from './SkillsPanel.module.css'

/** 技能分组 */
interface SkillGroup {
  category: string
  items: Skill[]
}

interface Skill {
  name: string
  description: string
  runCount: number
  lastRun: string
}

/** 本地模拟数据（无后端时降级） */
const FALLBACK_GROUPS: SkillGroup[] = [
  { category: 'recon', items: [
    { name: 'enscan', description: '公司资产测绘', runCount: 12, lastRun: '5m ago' },
    { name: 'amass', description: '子域枚举', runCount: 8, lastRun: '15m ago' },
    { name: 'gogo', description: '端口扫描', runCount: 5, lastRun: '1h ago' },
    { name: 'httpx', description: '存活探活', runCount: 3, lastRun: '2h ago' },
    { name: 'subfinder', description: '子域发现', runCount: 0, lastRun: '-' },
  ]},
  { category: 'web', items: [
    { name: 'nuclei', description: '漏洞检测', runCount: 0, lastRun: '-' },
    { name: 'ffuf', description: 'FUZZ模糊测试', runCount: 0, lastRun: '-' },
    { name: 'katana', description: '爬虫分析', runCount: 0, lastRun: '-' },
  ]},
  { category: 'report', items: [
    { name: 'vuln_report', description: '漏洞报告生成', runCount: 2, lastRun: '1d ago' },
    { name: 'ledger_update', description: '攻击面账本更新', runCount: 15, lastRun: '10m ago' },
  ]},
]

export interface SkillsPanelProps {
  /** 技能数据获取函数 */
  fetchSkills?: () => Promise<readonly string[]>
  /** 技能总数回填（供侧边栏徽章显示） */
  onCount?: (count: number) => void
}

/**
 * 技能面板 — 搜索 + 分类过滤 + 树形列表。
 */
export function SkillsPanel({ fetchSkills, onCount }: SkillsPanelProps) {
  const [groups, setGroups] = useState<SkillGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [activeCategory, setActiveCategory] = useState('all')
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(['recon']))

  // 加载数据
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    if (!fetchSkills) {
      // 无 fetch 函数时使用本地数据
      setGroups(FALLBACK_GROUPS)
      setLoading(false)
      return
    }

    fetchSkills()
      .then((names) => {
        if (cancelled) return
        setGroups(processNames(names))
        onCount?.(names.length)
        setLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        setError(String(err))
        setLoading(false)
      })

    return () => { cancelled = true }
  }, [fetchSkills, onCount])

  // 分类列表
  const categories = useMemo(() => {
    const cats = ['all', ...groups.map(g => g.category)]
    return [...new Set(cats)]
  }, [groups])

  // 过滤 + 搜索
  const filteredGroups = useMemo(() => {
    if (activeCategory === 'all' && !search) return groups
    return groups
      .filter(g => activeCategory === 'all' || g.category === activeCategory)
      .map(g => ({
        ...g,
        items: g.items.filter(s =>
          !search || s.name.toLowerCase().includes(search.toLowerCase()) ||
          s.description.toLowerCase().includes(search.toLowerCase())
        ),
      }))
      .filter(g => g.items.length > 0)
  }, [groups, activeCategory, search])

  const toggleGroup = useCallback((cat: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev)
      if (next.has(cat)) next.delete(cat)
      else next.add(cat)
      return next
    })
  }, [])

  // 将 fetch 结果处理为分组数据；未归类技能不会被丢弃，全部落入 other 组
  const processNames = useCallback((names: readonly string[]) => {
    const reconSkills = ['enscan', 'amass', 'gogo', 'httpx', 'subfinder']
    const webSkills = ['nuclei', 'ffuf', 'katana']
    const reportSkills = ['vuln_report', 'ledger_update', 'ledger_add', 'ledger_state']

    const groups: SkillGroup[] = [
      { category: 'recon', items: names.filter(n => reconSkills.includes(n)).map(n => ({
        name: n, description: getDesc(n), runCount: 0, lastRun: '-',
      }))},
      { category: 'web', items: names.filter(n => webSkills.includes(n)).map(n => ({
        name: n, description: getDesc(n), runCount: 0, lastRun: '-',
      }))},
      { category: 'report', items: names.filter(n => reportSkills.includes(n)).map(n => ({
        name: n, description: getDesc(n), runCount: 0, lastRun: '-',
      }))},
    ].filter(g => g.items.length > 0)

    const known = new Set([...reconSkills, ...webSkills, ...reportSkills])
    const rest = names.filter(n => !known.has(n))
    if (rest.length > 0) {
      groups.push({ category: 'other', items: rest.map(n => ({
        name: n, description: getDesc(n), runCount: 0, lastRun: '-',
      }))})
    }
    return groups
  }, [])

  // 重试
  const handleRetry = useCallback(() => {
    setError(null)
    setLoading(true)
    if (fetchSkills) {
      fetchSkills()
        .then((names) => {
          setGroups(processNames(names))
          onCount?.(names.length)
          setLoading(false)
        })
        .catch((err) => {
          setError(String(err))
          setLoading(false)
        })
    }
  }, [fetchSkills, processNames, onCount])

  // 骨架屏
  if (loading) {
    return (
      <div className={css.root}>
        <div className={css.skeletonSearch} />
        <div className={css.skeletonFilters}>
          <div className={css.skeletonBadge} />
          <div className={css.skeletonBadge} />
          <div className={css.skeletonBadge} />
        </div>
        {[1, 2, 3].map(i => (
          <div key={i} className={css.skeletonGroup}>
            <div className={css.skeletonHeader} />
            <div className={css.skeletonRow} />
            <div className={css.skeletonRow} />
          </div>
        ))}
      </div>
    )
  }

  // 错误状态
  if (error) {
    return (
      <div className={css.root}>
        <div className={css.errorState}>
          <span className={css.errorIcon}>⚠</span>
          <p className={css.errorText}>加载失败: {error}</p>
          <button className={css.retryBtn} onClick={handleRetry}>重试</button>
        </div>
      </div>
    )
  }

  // 空状态
  if (filteredGroups.length === 0) {
    return (
      <div className={css.root}>
        <div className={css.emptyState}>
          <span className={css.emptyIcon}>🔍</span>
          <p className={css.emptyText}>
            {search ? '未找到匹配的技能' : '暂无可用技能'}
          </p>
        </div>
      </div>
    )
  }

  // 正常渲染
  return (
    <div className={css.root}>
      {/* 搜索框 */}
      <div className={css.searchWrap}>
        <span className={css.searchIcon}>🔍</span>
        <input
          className={css.searchInput}
          type="text"
          placeholder="搜索技能..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {search && (
          <button className={css.searchClear} onClick={() => setSearch('')}>✕</button>
        )}
      </div>

      {/* 分类标签 */}
      <div className={css.filterRow}>
        {categories.map(cat => (
          <button
            key={cat}
            className={clsx(css.filterBadge, activeCategory === cat && css.filterBadgeActive)}
            onClick={() => setActiveCategory(cat)}
          >
            {cat === 'all' ? '全部' : cat}
          </button>
        ))}
      </div>

      {/* 技能分组列表 */}
      <div className={css.list}>
        {filteredGroups.map(g => (
          <div key={g.category} className={css.group}>
            <div
              className={css.groupHeader}
              onClick={() => toggleGroup(g.category)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleGroup(g.category) } }}
            >
              <span className={clsx(css.groupChevron, expandedGroups.has(g.category) && css.groupChevronOpen)}>▶</span>
              <span className={css.groupLabel}>{g.category}</span>
              <span className={css.groupCount}>{g.items.length}</span>
            </div>
            <div className={clsx(css.groupBody, expandedGroups.has(g.category) && css.groupBodyOpen)}>
              {g.items.map(skill => (
                <div key={skill.name} className={css.skillRow}>
                  <span className={css.skillDot} />
                  <span className={css.skillName}>{skill.name}</span>
                  <span className={css.skillDesc}>{skill.description}</span>
                  {skill.runCount > 0 && (
                    <span className={css.skillCount}>▶ {skill.runCount}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function getDesc(name: string): string {
  const map: Record<string, string> = {
    enscan: '公司资产测绘',
    amass: '子域枚举',
    gogo: '端口扫描',
    httpx: '存活探活',
    subfinder: '子域发现',
    nuclei: '漏洞检测',
    ffuf: 'FUZZ模糊测试',
    katana: '爬虫分析',
    vuln_report: '漏洞报告生成',
    ledger_update: '账本更新',
    ledger_add: '添加账本条目',
    ledger_state: '账本状态查询',
  }
  if (map[name] !== undefined) return map[name]
  if (name.startsWith('vh-')) return 'VulnHunter 技能'
  if (name.startsWith('yakit-') || name.startsWith('yak-')) return 'Yakit 集成'
  return ''
}