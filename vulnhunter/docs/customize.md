# 自定义指南：加 skill / 加 MCP / 改流水线步骤

## 加一个 Skill

dsh 按 kebab-case 目录像扫描 `<name>/SKILL.md`（目录包）或 `<name>.md`（单文件）。
五层扫描优先级：项目 `.dsh/skills` > `.agents/skills` > `customSkillDirs` > `~/.dsh/skills` > bundled。

1. 新建 `skills/vh-yourtopic/SKILL.md`：

   ```markdown
   ---
   name: vh-yourtopic
   description: 做什么的 + 何时加载（触发条件写清楚，模型靠它决定是否调用）。200 字内。
   ---

   # 标题
   方法论正文…
   ```

2. 重跑 `scripts\install.ps1`（或直接复制到 `~/.dsh/skills/`）。
3. 新开会话即可在可用技能列表看到它；想让 persona「见类型必扫」，在
   `presets/vulnhunter/agent.cordis.yml` §8 清单加一行映射。

注意：name 必须与目录名一致且为 kebab-case；嵌套 `**/SKILL.md` 不被支持。

## 加 / 换一个 MCP 服务

编辑 `presets/vulnhunter/agent.cordis.yml` 末尾 MCP 区块，一行一个实例：

```yaml
- id: mcp-nuclei
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: nuclei            # 工具名前缀 mcp__nuclei__*
    transport: stdio              # stdio 或 streamable-http
    command: npx                  # stdio 必填
    args: ['-y', 'nuclei-mcp@latest']
    failOnStartupError: false     # 离线不阻塞会话
```

- `serverName` 全局唯一 `[A-Za-z0-9_-]{1,32}`。
- 官方 client 仅支持 stdio / streamable-http。**旧版 SSE（`/sse`）服务端用本包自带的 mcp-sse-bridge**：

  ```yaml
  - id: mcp-my-sse-service
    name: 'dsh-vulnhunter/mcp-sse-bridge'   # 需先 npm install && npm run build，且包可被 dsh 解析（bundle 安装）
    config:
      serverName: myservice
      url: 'http://127.0.0.1:11432/sse'
      headers: {}                  # 需要鉴权时填 { Authorization: 'Bearer xxx' }
      toolCallTimeoutMs: 60000
      failOnStartupError: false    # 离线不阻塞会话
      reconnect: { maxAttempts: 10, maxDelayMs: 30000 }
  ```

  桥的行为：断线指数退避重连（连续失败 10 次放弃并注销工具）、`tools/list_changed` 热同步、工具名 `mcp__<serverName>__<raw>`。
- 改完重启 dsh web；HMR 下编辑该文件会热重连。

## 改流水线步骤

步骤定义在 `config/steps.default.yaml`。用户级覆盖：复制到
`~/.dsh/vulnhunter/steps.yaml` 修改（P1 起被 pipeline.ts 读取；当前版本作为
persona §流水线纪律的参照清单，改它同时记得同步 preset 里对应描述）。

每步可调字段：`id / tool / desc / cli / artifact / default_prompt / allow_skip`。
临时改某步指令：会话里直接说「alive-probe 这步按我给的指令来：…」（运行时覆盖优先级最高）。

## 调整断停档位

`ask`（每步确认）/ `auto`（全自动）/ `step`(单步推进)。开场对话告诉 agent 即可，
例如「auto 档跑完整条链」。P1 起由 recon_run `--mode` 参数承载并持久化到 storageDomain。
