/**
 * 基础设施：路径解析、CLI 执行封装、artifact 落盘。
 *
 * 设计原则（方案 §5.A）：原始输出永不进模型上下文 —— 所有 CLI 输出整体写进
 * artifact 文件，只把「尾部日志 + 结构化摘要」返回给模型。
 */

import { execFile } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

/** 解析 $DSH_HOME（与宿主 home-paths 规则一致：环境变量优先，否则 ~/.dsh）。 */
export function dshHome(): string {
  const fromEnv = process.env.DSH_HOME
  if (fromEnv !== undefined && fromEnv.trim().length > 0) return fromEnv.trim()
  return join(homedir(), '.dsh')
}

/** 插件配置的 artifacts 根目录（空串时取默认值）。 */
export function artifactsRootOf(configured: string): string {
  const trimmed = configured.trim()
  if (trimmed.length > 0) return resolve(trimmed)
  return join(dshHome(), 'vulnhunter', 'artifacts')
}

/**
 * 在 PATH 或配置的 tools 目录下定位 CLI 可执行文件。
 * 支持两种目录布局：toolsDir/name.exe 与 toolsDir/name/name.exe（本仓库 tools/ 的实际布局）。
 */
export function cliPath(toolsDir: string, name: string): string {
  const trimmed = toolsDir.trim()
  if (trimmed.length > 0) {
    const root = resolve(trimmed)
    if (process.platform === 'win32') {
      return join(root, name, `${name}.exe`)
    }
    return join(root, name, name)
  }
  // 空目录 = 直接信任 PATH；Windows 下显式补 .exe 后缀提高命中率。
  return process.platform === 'win32' ? `${name}.exe` : name
}

/** 目标工作区：<artifactsRoot>/<target>/，一个授权目标一个目录。 */
export function targetDir(root: string, target: string): string {
  const safe = target.replace(/[^A-Za-z0-9_-]/g, '_')
  return join(root, safe)
}

/** 写 artifact 并返回相对引用路径（账本/报告里用它回溯）。 */
export async function writeArtifact(
  dir: string,
  name: string,
  content: string,
): Promise<string> {
  await mkdir(dir, { recursive: true })
  const file = join(dir, name)
  await writeFile(file, content, 'utf8')
  return file
}

export interface CliResult {
  ok: boolean
  exitCode: number | null
  /** 给模型看的尾部日志（截断，防上下文爆炸）。 */
  logTail: string
  /** 完整原始输出的落盘位置。 */
  artifact: string
  durationMs: number
}

const LOG_TAIL_CHARS = 2000
const CLI_TIMEOUT_MS_DEFAULT = 15 * 60 * 1000

/**
 * 执行一个侦察 CLI：stdout/stderr 全量落盘 artifact，只回传尾部日志。
 * Windows 下 enscan/amass/gogo/httpx 都是单文件 exe，直接 execFile 免 shell。
 */
export function runCli(
  cmd: string,
  args: string[],
  opts: { cwd?: string; timeoutMs?: number; stdin?: string } = {},
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolvePromise) => {
    const child = execFile(
      cmd,
      args,
      {
        cwd: opts.cwd,
        timeout: opts.timeoutMs ?? CLI_TIMEOUT_MS_DEFAULT,
        maxBuffer: 256 * 1024 * 1024,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        // Node 回调：成功时 error 为 null（不是 undefined）；error.code 还可能是字符串错误码。
        const rawCode = error ?? null
        const code = rawCode === null ? 0 : typeof (rawCode as { code?: unknown }).code === 'number' ? (rawCode as { code: number }).code : 1
        resolvePromise({ code, stdout: String(stdout), stderr: String(stderr) })
      },
    )
    // amass 等工具支持 stdin 喂清单；不传则关闭写端避免挂起。
    if (opts.stdin !== undefined) child.stdin?.write(opts.stdin)
    child.stdin?.end()
  })
}

export function tail(text: string, chars = LOG_TAIL_CHARS): string {
  const clean = text.trim()
  return clean.length <= chars ? clean : `…(截断)…\n${clean.slice(-chars)}`
}

/**
 * 自定义命令模板：Config.toolCommands[工具名] = "命令行模板"。
 * 占位符 {name} 形式按调用方传入的 vars 替换；未配置的工具回退内置参数。
 * v1 按空白切分，不支持带引号的含空格参数。
 */
export function resolveInvocation(
  templates: Record<string, string>,
  name: string,
  fallbackCmd: string,
  fallbackArgs: string[],
  vars: Record<string, string>,
): { cmd: string; args: string[] } {
  const template = templates[name]?.trim()
  if (template === undefined || template === '') return { cmd: fallbackCmd, args: fallbackArgs }
  const parts = template.split(/\s+/).map(part => part.replace(/\{(\w+)\}/g, (_, key: string) => vars[key] ?? `{${key}}`))
  if (parts.length === 0 || parts[0] === '') return { cmd: fallbackCmd, args: fallbackArgs }
  return { cmd: parts[0], args: parts.slice(1) }
}

/** 读文本文件（供 url-build 合并清单等场景）。 */
export async function readTextIfExists(file: string): Promise<string | null> {
  try {
    return await readFile(file, 'utf8')
  } catch {
    return null
  }
}
