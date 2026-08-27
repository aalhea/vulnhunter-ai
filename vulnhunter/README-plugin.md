# dsh-vulnhunter

> **合规声明（必读）**：本项目仅供**已获授权**的安全测试使用——自有资产、SRC 平台收录范围、或持有书面授权的目标。内置工具与技能默认被动优先；任何红线操作（删数据/脱库/DoS/篡改配置）被 persona 与护栏双重禁止。使用者对所有行为自负法律责任；下载即视为接受本声明。

---

**dsh-vulnhunter** 是 [DeepSeek Harness (dsh)](https://github.com/deepseek-ai/deepseek-harness) 的漏洞挖掘 Agent 插件：

> dsh-pentest 记录"怎么挖"，dsh-vulnhunter 自动化"挖什么、用什么挖、并记住挖到过什么"。

公司资产测绘 → 子域枚举 → 存活探测的 AI 中介流水线 · yakit/chrome MCP 联动 Web 漏洞验证 · 小程序审计 · 四层仿生记忆跨会话沉淀经验 · 三态攻击面账本强制求真。

## 当前版本 v0.3

**完整二开**：11 个原生工具（recon_* 五步流水线 / ledger_* 三态账本 / vuln_report）+ scope 护栏 + artifact 纪律 + persona v3.0-dsh + **26 个 `vh-*` 技能** + vulnmem 四层记忆 + 自研 mcp-sse-bridge（旧版 SSE 直连 Yakit/first-miniapp）。CI 全绿（typecheck/build/smoke）。

## 架构

```
┌─ dsh 宿主（不改） ──────────────────────────────────────────┐
│ ① 预设层 presets/vulnhunter                                │
│    「漏洞挖掘模式」= persona v3.0-dsh + 工具行 + 子代理     │
│ ② MCP 层（agent.cordis.yml 一行一个）                      │
│    mcp-yakit ─┐                                            │
│               ├─ dsh-vulnhunter/mcp-sse-bridge（旧版SSE桥） │
│    first-miniapp ┘      mcp-chrome → 官方 stdio client    │
│ ③ Skills 层 skills/vh-*（26 个，用户可加）                 │
│ ④ 记忆层 memory/（vulnmem Python 四层仿生记忆）            │
│ ⑤ 声明层 config/（五步流水线 + scope 授权模板）            │
└─────────────────────────────────────────────────────────────┘
```

## 侦察流水线 v2（快准狠）

顺序固定不可乱，**支持任意选段**——会话里说「只跑 1,2,4」即可：

| seq | 步骤 | 工具 | 说明 |
|---|---|---|---|
| 1 | company-expand | enscan | 公司名→根域名/子公司/ICP/App/小程序 |
| 2 | subdomain-enum | amass + fofa/shodan 并行 | 多源被动汇总 → 泛解析检测+去重（确定性后处理） |
| 3 | port-scan | **gogo** | top2/top3 web 端口 + 服务指纹 + http URL 发现，最小发包 |
| 4 | alive-probe | httpx | 输入 = **url-build**：gogo 已判定 URL ∪ 子域裸域名去重合并 |
| 5 | report | — | 汇总侦察报告 |

> 你担心的「缺 URL 这步」就在 ③→④ 之间：httpx 吃的是 URL 清单不是裸端口表。gogo 自己会输出已判定的 `scheme://host:port`；纯子域交给 httpx 自动试 http/https 默认口。这一步是纯确定性逻辑，不消耗 AI。断停三档 ask/auto/step，默认 ask。

## 内置工具组（11 个，全部经 scope 护栏）

| 工具 | 作用 |
|---|---|
| `recon_pipeline` | 五步流水线编排，`steps:"1,2,4"` 任意选段，断点续跑 |
| `recon_status` | 流水线运行历史/结论表格 |
| `recon_enscan` | 公司名→根域名/子公司/ICP/App/小程序 |
| `recon_amass` | 被动子域枚举，多源去重合并 |
| `recon_gogo` | gogo 端口扫描+服务指纹+URL 发现 |
| `recon_httpx` | 存活探测+Web 指纹 |
| `recon_intel` | fofa/shodan 被动情报并入子域清单（无 key 明确报错降级） |
| `ledger_add` / `ledger_update` / `ledger_state` | 三态攻击面账本；转「已证实」强制证据质量门 |
| `vuln_report` | 按严重性汇总已证实发现生成 .md 报告 |

护栏规则：域名白名单/通配后缀/excludes/CIDR 数学校验，出界 fail-closed 抛错；被动情报命中同样回查白名单。原始输出永不进上下文——全量落盘 `<artifactsRoot>/<target>/`，模型只见结论与 artifact 指针。

## 安装（Windows）

```powershell
git clone <repo> && cd dsh-vulnhunter
npm install && npm run build          # 构建 mcp-sse-bridge 产物 dist/
powershell -ExecutionPolicy Bypass -File scripts\install.ps1
pip install -r "$env:USERPROFILE\.dsh\vulnhunter\memory\requirements.txt"
# 侦察 CLI：把 enscan/amass/gogo/httpx 放入 PATH，或 ~/.dsh/vulnhunter/tools
dsh web   # 预设列表选择「漏洞挖掘模式」
```

手动安装等价于三份拷贝（详见 scripts/install.ps1 注释）：预设→`~/.dsh/.agent-presets/vulnhunter`，技能→`~/.dsh/skills/`，记忆→`~/.dsh/vulnhunter/memory`。

> **两种模式的差别**：纯拷贝安装下预设可用，但 `mcp-yakit` / `mcp-first-miniapp` 两行引用本包的 `mcp-sse-bridge` 导出，需要 dsh 能解析到本包（bundle 安装或宿主可解析路径）才生效；不装 bundle 时可临时删掉这两行，yakit 流量改由 vh-jss 的 ingest 文件方式进入。bundle 安装路线在 P1 打通。

## Skills 一览（全部更名，避免与上游混淆）

| 本仓库 | 来源 | 用途 |
|---|---|---|
| vh-sqli | offensive-sqli | SQL 注入全型清单 + sqlmap |
| vh-xss | offensive-xss | 反射/存储/DOM XSS + CSP 绕过 |
| vh-ssrf | offensive-ssrf | SSRF 协议利用 + 云元数据 |
| vh-ssti | offensive-ssti | 模板注入引擎指纹 + RCE |
| vh-xxe | offensive-xxe | XXE/OOB 外带 |
| vh-rce | offensive-rce | RCE 模式库 |
| vh-idor | offensive-idor | IDOR/BOLA/越权 |
| vh-jwt | offensive-jwt | JWT 算法混淆/伪造 |
| vh-oauth | offensive-oauth | OAuth2/OIDC 授权缺陷 |
| vh-osint | offensive-osint | 侦察/开源情报 |
| vh-jss | jss | JS 侦察流水线（自带 jsluice/katana/waymore），小程序反编译分析 |
| vh-webaudit | pentest-lyan | 威胁建模式 Web 全面渗透流程（MIT, HeaSec） |
| vh-memory | 新增 | 四层仿生记忆 CLI 操作手册 |
| vh-sub | vuln-sub | 项目完结蒸馏进长时图谱 |

**Yak/Yakit 脚本组**（配合 yakit MCP 使用——agent 可现场编写 yak 热补丁脚本，
实时解密加签流量、劫持请求响应、驱动 Web Fuzzer）：

| 本仓库 | 来源 | 用途 |
|---|---|---|
| vh-yak-hotpatch | global-hotpatch | 全局热补丁：加解密/签名算法透明还原 |
| vh-yak-mitm | mitm-hotpatch | MITM 前后注入：改包/存流量/镜像过滤 |
| vh-yak-fuzzer | webfuzzer-hotpatch | Web Fuzzer 热补丁：fuzztag/加密组合/自定义失败判定 |
| vh-yak-core | yak | Yak 语言核心速查 |
| vh-yak-syntax / vh-yak-db / vh-yak-toolchain | yaklang-* | 语法/数据库(KV+SQLite)/工具链 |
| vh-yakit-basic / -ui-binding | yakit-basic/ui-binding | 插件骨架与 UI 输出 |
| vh-yakit-plugin-extract / -native / -rightclick | yakit-*-plugin | 数据提取/MITM 原生/右键菜单插件 |

## MCP 联动

预设内三行接入，离线自动降级不阻塞会话：

| 服务 | 传输 | 地址 | 用途 |
|---|---|---|---|
| yakit | 旧版 SSE（自研 mcp-sse-bridge） | `http://127.0.0.1:11432/sse` | 抓包查询/重放/批量验证/风险入库/yak 热补丁执行 |
| chrome | stdio（官方 client） | `npx chrome-devtools-mcp@latest` | 自动浏览/登录/DOM 验证 |
| first-miniapp | 旧版 SSE（自研 mcp-sse-bridge） | `http://127.0.0.1:4554/sse` | 小程序动态调试槽位 |

> 官方 dsh-mcp-client 只支持 stdio/streamable-http，本项目自带 [mcp-sse-bridge](plugin/mcp-sse-bridge.ts) 补齐旧版 SSE：断线指数退避重连、工具清单热同步、命名与上游契约一致（`mcp__<server>__<tool>`）。带鉴权头时配置 `headers:` 即可。

## 会话示例

```
你：这是授权范围 ~/.dsh/vulnhunter/targets/demo/scope.yaml，目标「示例科技」，跑一遍侦察。
AI：（ask 档）① enscan 测绘完成 → 结论呈现 → ② amass+fofa 并行枚举完成（泛解析已剔除 1200 假域）→ 继续 gogo 端口扫描？[确认]
AI：③ gogo 完成：47 台活机、12 个管理台指纹 → ④ url-build 合并 89 个候选 URL → httpx 探活 → 高价值入口排序 → ⑤ 侦察报告落盘
你：只跑 3,4，目标换成这份子域清单 artifacts/2-subdomains.txt。
AI：（选段执行：跳过上游，直接读历史产物接力）
你：重点打 admin.demo-t.com 的登录口。
AI：（加载 vh-webaudit 威胁建模 → 发现 JWT → 加载 vh-jwt → 算法混淆证实 → raw HTTP 入账）
你：这个站接口全加密。
AI：（加载 vh-yak-mitm + vh-yak-hotpatch，经 yakit MCP 下发热补丁，透明还原加签流量后继续测）
你：/stop
AI：save-state 存断点，下次 load-state 续挖。
```

## 与 dsh-pentest 的关系

正交互补，可共存：pentest 记录探索链路（六表+图谱 UI）；vulnhunter 提供方法论技能库、侦察流水线、记忆系统与执行纪律。吸收了它的 finding 证据纪律与子代理 toolFilter 手法。

## 路线图

- ~~P1 recon_* 工具组 + pipeline 断停状态机 + scope 护栏 + vuln_report~~ ✅ 已完成（本版）
- **P2** ledger sqlite 迁移 + 记忆热启动注入 systemPrompt + Web 面板（流水线状态/账本/发现可视化——技术路线已验证 dsh-pentest 的 ModuleLoader 注入模式）→ v0.4
- **P3** 模型路由（步骤分析用便宜模型）+ 小程序链路深化 + 高频洞型 skills（vh-upload/vh-java-deser/vh-nuclei）
- **P4** MCP registry / awesome-dsh 收录、技术文章、靶场回归集

## 目录结构

```
src/                  TS 工具层（index 入口 / recontools / pipeline / ledger / scope 护栏 / store）
presets/vulnhunter/   预设（preset.yml + agent.cordis.yml 含 persona 全文）
skills/vh-*           26 个技能（vh-yak* 配合 yakit MCP 写热补丁）
memory/               vulnmem.py + vuln_memory/ 四层仿生记忆
config/               steps.default.yaml（五步流水线）+ scope.example.yaml
plugin/preset-root.js 预设根注册（纯 JS，无构建）
plugin/mcp-sse-bridge.ts 旧版 SSE MCP 桥
scripts/install.ps1   安装脚本
scripts/smoke.mjs     功能冒烟回归
docs/customize.md     加 skill / 加 MCP / 改步骤指南
```
