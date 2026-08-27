/**
 * PromptPanel — 预设 Prompt 面板。
 * 折叠列表 + 按模式筛选 + 复制/应用按钮。
 */
import { useState, useMemo, useCallback } from 'react'
import clsx from 'clsx'
import css from './PromptPanel.module.css'

interface PromptItem {
  id: string
  mode: string
  title: string
  content: string
}

const PROMPTS: PromptItem[] = [
  {
    id: 'nova-full',
    mode: 'Nova',
    title: 'Nova · 完整模式',
    content: '你是一个专业的 AI 漏洞挖掘助手，专注于发现和报告 Web 应用中的安全漏洞。请按照以下流程进行分析：\n\n1. 资产收集：收集目标的所有公开资产信息\n2. 漏洞扫描：使用自动化工具进行安全扫描\n3. 人工验证：手动验证发现的潜在漏洞\n4. 报告生成：生成详细的漏洞报告\n\n请开始你的分析。',
  },
  {
    id: 'scout-recon',
    mode: 'Scout',
    title: 'Scout · 信息收集',
    content: '你是一个专业的信息收集专家，专注于资产测绘和情报收集。请执行以下步骤：\n\n1. 公司资产测绘：识别目标公司的所有公开资产\n2. 子域枚举：发现所有相关的子域名\n3. 端口扫描：识别开放端口和服务\n4. 存活探活：确认目标的存活状态\n\n请开始信息收集。',
  },
  {
    id: 'raider-web',
    mode: 'Raider',
    title: 'Raider · Web 渗透',
    content: '你是一个专业的 Web 渗透测试专家，专注于单目标 Web 应用安全测试。请执行：\n\n1. 信息收集：收集目标 Web 应用的信息\n2. 漏洞扫描：使用 yakit/chrome 双引擎进行扫描\n3. 漏洞验证：手动验证发现的漏洞\n4. 漏洞利用：尝试利用已确认的漏洞\n\n请开始渗透测试。',
  },
  {
    id: 'pebble-miniapp',
    mode: 'Pebble',
    title: 'Pebble · 小程序挖掘',
    content: '你是一个专业的小程序安全分析专家，专注于微信小程序安全测试。请执行：\n\n1. 反编译：反编译小程序代码\n2. 静态分析：分析源代码中的漏洞\n3. 动态调试：运行时调试小程序\n4. 密钥提取：提取硬编码的密钥\n5. 接口分析：分析 API 接口的越权风险\n\n请开始小程序分析。',
  },
]

/** 预设总数（供侧边栏徽章显示） */
export const PROMPT_COUNT = PROMPTS.length

export function PromptPanel() {
  const [activeMode, setActiveMode] = useState('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [appliedId, setAppliedId] = useState<string | null>(null)

  const modes = useMemo(() => {
    return ['all', ...new Set(PROMPTS.map(p => p.mode))]
  }, [])

  const filtered = useMemo(() => {
    if (activeMode === 'all') return PROMPTS
    return PROMPTS.filter(p => p.mode === activeMode)
  }, [activeMode])

  const toggleExpand = useCallback((id: string) => {
    setExpandedId(prev => prev === id ? null : id)
  }, [])

  const handleCopy = useCallback(async (id: string, content: string) => {
    try {
      await navigator.clipboard.writeText(content)
      setCopiedId(id)
      setTimeout(() => setCopiedId(null), 1500)
    } catch {
      // clipboard 不可用
    }
  }, [])

  const handleApply = useCallback((id: string, content: string) => {
    // 以该 Prompt 内容开始新会话
    navigator.clipboard.writeText(content).then(() => {
      setAppliedId(id)
      setTimeout(() => setAppliedId(null), 1500)
    }).catch(() => {})
  }, [])

  return (
    <div className={css.root}>
      {/* 模式筛选 */}
      <div className={css.filterRow}>
        {modes.map(mode => (
          <button
            key={mode}
            className={clsx(css.filterBadge, activeMode === mode && css.filterBadgeActive)}
            onClick={() => setActiveMode(mode)}
          >
            {mode}
          </button>
        ))}
      </div>

      {/* Prompt 列表 */}
      <div className={css.list}>
        {filtered.map(prompt => (
          <div key={prompt.id} className={css.promptCard}>
            <div
              className={css.promptHeader}
              onClick={() => toggleExpand(prompt.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleExpand(prompt.id) }
              }}
            >
              <span className={clsx(css.promptChevron, expandedId === prompt.id && css.promptChevronOpen)}>▶</span>
              <span className={css.promptTitle}>{prompt.title}</span>
            </div>
            <div className={clsx(css.promptBody, expandedId === prompt.id && css.promptBodyOpen)}>
              <pre className={css.promptContent}>{prompt.content}</pre>
              <div className={css.promptActions}>
                <button
                  className={css.actionBtn}
                  onClick={() => handleCopy(prompt.id, prompt.content)}
                >
                  {copiedId === prompt.id ? '✓ 已复制' : '📋 复制'}
                </button>
                <button
                  className={css.actionBtn}
                  onClick={() => handleApply(prompt.id, prompt.content)}
                >
                  {appliedId === prompt.id ? '✓ 已应用' : '▶ 应用'}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}