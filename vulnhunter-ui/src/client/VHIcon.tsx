/**
 * VHIcon — VulnHunter 闪电品牌图标。
 * 渐变填充 + hover 发光脉冲动画。
 */
import clsx from 'clsx'
import css from './VHIcon.module.css'

export interface VHIconProps {
  /** 图标尺寸（px），默认 24 */
  size?: number
  /** 额外 CSS className */
  className?: string | undefined
  /** 是否显示 hover 发光动画 */
  glowOnHover?: boolean
}

/**
 * 渲染 VulnHunter 闪电图标（SVG 路径）。
 * @param props - 尺寸、样式、动画选项
 * @returns SVG 闪电图标
 */
export function VHIcon({ size = 24, className, glowOnHover = true }: VHIconProps) {
  return (
    <span
      className={clsx(css.root, glowOnHover && css.glowHover, className)}
      style={{ width: size, height: size }}
      aria-label="VulnHunter"
      role="img"
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <linearGradient id="vh-icon-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#00f5d4" />
            <stop offset="50%" stopColor="#00bbf9" />
            <stop offset="100%" stopColor="#9b5de5" />
          </linearGradient>
        </defs>
        <path
          d="M10.5 2L3 14h6l-1.5 8L17 10h-6l2.5-8H10.5z"
          fill="url(#vh-icon-grad)"
          className={css.lightning}
        />
      </svg>
    </span>
  )
}