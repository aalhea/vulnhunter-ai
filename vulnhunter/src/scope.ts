/**
 * scope 护栏：授权范围是唯一边界（persona §11 的工程兜底）。
 *
 * 与方案 §8 对应，但不依赖 tools/pre-execute 钩子——每个 recon_* 工具在执行前
 * 自查目标是否落在本文件加载的白名单内，出界即抛错拒绝。这样护栏与工具同生共死，
 * 不存在「绕过钩子」的路径；shell 直跑 CLI 的旁路由 persona 纪律 + AGENTS.md 约束。
 */

import { readFile } from 'node:fs/promises'
import { parse } from 'yaml'

export interface ScopeFile {
  target: string
  domains: string[]
  excludes: string[]
  cidr: string[]
  passiveFirst: boolean
  authorizedBy: string
}

export interface LoadedScope extends ScopeFile {
  /** scope.yaml 绝对路径；未配置 scope 时为 undefined（护栏降级为警告模式）。 */
  path?: string
}

/** 加载 scope.yaml；文件不存在时抛错 —— 没有授权文件就不允许主动扫描。 */
export async function loadScope(scopeFile: string): Promise<LoadedScope> {
  const raw = await readFile(scopeFile, 'utf8')
  const doc = (parse(raw) ?? {}) as Record<string, unknown>
  const rules = (doc.rules ?? {}) as Record<string, unknown>
  return {
    target: String(doc.target ?? ''),
    domains: asStringArray(doc.domains ?? doc.anchors),
    excludes: asStringArray(doc.excludes),
    cidr: asStringArray(doc.cidr),
    passiveFirst: rules.passive_first !== false,
    authorizedBy: String(doc.authorized_by ?? ''),
  }
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  // 兼容 anchors: {domains:[...]} 嵌套结构。
  return value.flatMap((entry) => {
    if (typeof entry === 'string') return [entry]
    if (typeof entry === 'object' && entry !== null && Array.isArray((entry as { domains?: unknown }).domains)) {
      return (entry as { domains: unknown[] }).domains.filter((v): v is string => typeof v === 'string')
    }
    return []
  })
}

/**
 * host 是否在白名单内：精确命中或通配后缀命中（*.example.com / example.com）。
 */
export function hostAllowed(scope: LoadedScope | undefined, host: string): boolean {
  if (scope === undefined) return true
  const normalized = host.toLowerCase().replace(/\.$/, '')
  for (const exclude of scope.excludes) {
    if (matchDomain(normalized, exclude.toLowerCase())) return false
  }
  for (const domain of scope.domains) {
    if (matchDomain(normalized, domain.toLowerCase())) return true
  }
  return false
}

function matchDomain(host: string, pattern: string): boolean {
  const clean = pattern.replace(/^\*\./, '.')
  return host === pattern.replace(/^\*\./, '') || host.endsWith(clean)
}

/** IPv4 是否落在任一授权 CIDR 内（CIDR 解析失败视为不匹配，fail-closed）。 */
export function ipAllowed(scope: LoadedScope | undefined, ip: string): boolean {
  if (scope === undefined) return true
  const value = parseIPv4(ip)
  if (value === null) return false
  return scope.cidr.some((cidr) => {
    const range = parseCidr(cidr)
    return range !== null && value >= range.base && value <= range.broadcast
  })
}

function parseIPv4(ip: string): number | null {
  const parts = ip.split('.')
  if (parts.length !== 4) return null
  let out = 0
  for (const part of parts) {
    const octet = Number(part)
    if (!Number.isInteger(octet) || octet < 0 || octet > 255 || !/^\d+$/.test(part)) return null
    out = out * 256 + octet
  }
  return out
}

function parseCidr(cidr: string): { base: number; broadcast: number } | null {
  const [addr, bitsRaw] = cidr.split('/')
  const base = parseIPv4(addr ?? '')
  const bits = Number(bitsRaw)
  if (base === null || !Number.isInteger(bits) || bits < 0 || bits > 32) return null
  const size = 2 ** (32 - bits)
  const networkMask = size === 2 ** 32 ? 0 : ~(size - 1)
  const network = (base & networkMask) >>> 0
  return { base: network, broadcast: network + size - 1 }
}

/** 从任意输入（URL/host）提取 hostname。 */
export function extractHost(input: string): string {
  try {
    if (input.includes('://')) return new URL(input).hostname
  } catch {
    /* 落到纯 host 分支 */
  }
  return input.replace(/:\d+$/, '').trim()
}
