/**
 * dsh-vulnhunter 主插件：把侦察工具组、流水线、账本、报告注册到宿主 ctx.tools。
 *
 * 命名空间插件（named exports，无 default export）。所有工具名以 recon_/ledger_/
 * vuln_report 开头 —— 子代理的 toolFilter.deny 正是按这些前缀收走写权限，
 * 保证「账本只有本体可写」（persona §分身协同 A3）。
 *
 * @module dsh-vulnhunter
 */

import type { Context } from '@deepseek-ai/cordis'
import zSchema from '@deepseek-ai/schemastery'
import { ledgerAddTool, ledgerStateTool, ledgerUpdateTool, vulnReportTool } from './ledger.ts'
import { pipelineTools } from './pipeline.ts'
import {
  reconAmassTool,
  reconEnscanTool,
  reconGogoTool,
  reconHttpxTool,
  reconIntelTool,
  type ReconEnv,
} from './recontools.ts'
import { artifactsRootOf } from './util.ts'

/** Cordis 插件名。 */
export const name = 'vulnhunter'

/** 依赖宿主的工具注册表。 */
export const inject = ['tools']

/** 插件配置（cordis.yml / bundle patch 的 config 节）。 */
export interface Config {
  /** CLI 所在目录；留空则从 PATH 解析。 */
  toolsDir: string
  /** artifact 根目录；留空用 $DSH_HOME/vulnhunter/artifacts。 */
  artifactsRoot: string
  /** scope.yaml 授权范围文件路径；留空时护栏进入警告模式（仅 recon_* 内强制）。 */
  scopeFile: string
  /** 流水线默认档位：ask | auto | step（当前由 agent 在对话层遵守）。 */
  defaultMode: 'ask' | 'auto' | 'step'
  /**
   * 自定义命令模板：键为工具名（enscan/amass/gogo/httpx），值为整条命令行。
   * 占位符可用：enscan→{company}{output}{deep}；amass→{domain}；
   * gogo→{targets}{ports}{output}；httpx→{input}{output}{ports}。
   * 例："D:/tools/enscan/enscan.exe -company {company} -o {output}"
   */
  toolCommands: Record<string, string>
  fofaEmail: string
  fofaKey: string
  shodanKey: string
}

const TIMER_LIMIT_MS = 2_147_483_647

export const Config: zSchema<Config> = zSchema.object({
  toolsDir: zSchema.string().default(''),
  artifactsRoot: zSchema.string().default(''),
  scopeFile: zSchema.string().default(''),
  // schemastery 3.x 无 .enum：字面量集合用 union+const 表达（与上游 mcp-client 同款）。
  defaultMode: zSchema.union([zSchema.const('ask'), zSchema.const('auto'), zSchema.const('step')]).default('ask'),
  toolCommands: zSchema.dict(String).default({}),
  fofaEmail: zSchema.string().default(''),
  fofaKey: zSchema.string().default(''),
  shodanKey: zSchema.string().default(''),
}) as unknown as zSchema<Config>

/**
 * 注册全部漏洞挖掘工具。
 * 环境变量优先于 config：fofaEmail/fofaKey/shodanKey 可用
 * FOFA_EMAIL / FOFA_KEY / SHODAN_KEY 注入，避免密钥进 cordis.yml。
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const env: ReconEnv = {
    ctx,
    toolsDir: config.toolsDir,
    artifactsRoot: artifactsRootOf(config.artifactsRoot),
    scopeFile: config.scopeFile,
    toolCommands: config.toolCommands ?? {},
    fofaEmail: process.env.FOFA_EMAIL ?? config.fofaEmail,
    fofaKey: process.env.FOFA_KEY ?? config.fofaKey,
    shodanKey: process.env.SHODAN_KEY ?? config.shodanKey,
  }

  const registrations = [
    reconEnscanTool(env),
    reconAmassTool(env),
    reconGogoTool(env),
    reconHttpxTool(env),
    reconIntelTool(env),
    ledgerAddTool(env),
    ledgerUpdateTool(env),
    ledgerStateTool(env),
    vulnReportTool(env),
    ...pipelineTools(env),
  ]
  for (const definition of registrations) {
    ctx.tools.register(definition)
  }
  ctx.logger.info(`[vulnhunter] 已注册 ${registrations.length} 个工具；artifact 根目录 ${env.artifactsRoot}`)
}
