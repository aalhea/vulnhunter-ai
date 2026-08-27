---
name: vh-jss
description: JS 侦察流水线编排（自带工具链 + Yakit/浏览器 MCP + 本地 hae 联动）：按输入类型自适应——URL 走 katana 主动爬取（硬限速防风控）+ waymore 被动存档（目标站 0 请求），Yakit 有抓包流量则导入登录态 JS 与 API 端点，小程序反编译目录/本地 dist 直接分析（无爬取路径，analyze 即全流程）。双提取引擎（jsluice AST + 正则）+ hae 规则增强产出 ai_brief.md，AI 再做语义分析与优先级排序。任何环节阻塞自动跳过并汇总告知。仅用于授权渗透测试/SRC。触发词：分析js、js分析、js侦察、提取接口、端点提取、小程序分析、分析小程序、反编译js分析、jss。
---

# vh-jss 编排手册（AI 按此执行）

工具做广度（爬、收、批量提取），AI 做深度（读 ai_brief.md 做语义分析、排优先级、回源核实）。只用于已授权目标。

**本 skill 自带全部工具**（bin/jsluice.exe、bin/katana.exe、waymore-8.9/），拿到任何机器解压即用，无需另装 Go/katana。唯一外部依赖：Python ≥3.8 + 四个 pip 包（见 requirements.txt）。结果默认落在**会话目录** `work\<目标名>\`（AI 可直接看到已有产物，避免重复爬取；可用 JSS_WORK 环境变量重定位），AI 第一入口是 `report\ai_brief.md`。

## Step 0 查已有产物（避免重复爬取）

**在 Step 1 之前，AI 必须先检查会话目录下 `work/<目标名>/` 是否存在且已有 `report/ai_brief.md`：**

- **已有完整报告** → 跳过 Step 2~4，直接走 Step 5（analyze 取最近一次结果）→ Step 6（AI 语义分析）。用户追加新信息（如新 Yakit 流量）时，ingest 会合并到已有目录，然后 re-run analyze。
- **只有部分数据**（如只有 `js/` 但无 `flows_endpoints.txt`）→ 增量补充（如查 Yakit 流量）→ 再 analyze。
- **无目录** → 走完整流程。

## Step 1 判定输入类型，选路径（全场景覆盖）

| 用户给的输入 | 执行路径 |
|---|---|
| URL / 域名 | Step 2（Yakit 流量）→ Step 3（collect）→ Step 4（passive）→ Step 5（analyze） |
| 本地目录（小程序反编译、dist、下载的 JS） | **只走 Step 5**：`python jss.py analyze <目录1> <目录2>`，不发任何网络请求。反编译小程序会被自动识别（app-service.js/app.json 特征 + appid 提取），简报概览标记场景 |
| HAR 文件 | `python jss.py har <file.har>` → Step 5 |
| Yakit/浏览器 MCP 流量 JSON | `python jss.py ingest <flows.json> --name <目标名>` → Step 5 |
| "分析上次/某个目标的结果" | `python jss.py list` 确认 → Step 5（analyze 默认取最近一次） |
| 只要敏感信息扫描、不要端点/收集 | **别用本 skill**，直接加载本机 hae skill（见下方联动章节） |

## Step 2 Yakit 登录态流量（AI 自动执行：Yakit MCP 在线即查，不依赖用户显式要求）

**行为规则：** 只要当前会话有 Yakit MCP 工具可用（无论用户是否提及），AI 在 Step 1 判定输入类型后，必须自动执行本步骤。Yakit MCP 不存在则记录"无 Yakit MCP"跳过。这是 AI 的自主行为，不是等待用户指令。

1. 调 `query_http_flow`，`hostnameFilter=["目标主域"]`（不带 www，覆盖子域），`pagination.limit` 给 100；条数多按需翻 2-3 页。
2. 0 条相关流量 → 记录"无登录态流量"，继续 Step 3，**不算失败**。
3. 有流量 → flows 数组写临时 JSON（url/method/status_code/request/response 原样保留），执行 `python jss.py ingest flows.json --name <目标名>`。登录态 JS 落盘 + 所有 API 响应体（JSON/HTML）落盘 + 所有真实调用过的 API 路径（方法+状态码）进 flows_endpoints.txt，简报多出"已捕获 API 端点"一节。403 端点是越权测试起点。
4. ⚠️ flows.json 及落盘的响应体可能含 cookie/token/业务数据，属敏感文件，报告对外输出必须脱敏。

## Step 3 主动收集（URL 输入时）

```
python jss.py collect https://target.com
```
防风控参数已硬编码（2 req/s、每主机 1 req/s、8 分钟预算、单域 150 页、下载上限 300、随机延迟 0.6-1.5s）。用户没提"要快"就不要调参；要调参见 jss.py cmd_collect 并意识到在改安全边界。

## Step 4 被动收集（URL/域名输入时）

```
python jss.py passive target.com
```
只查第三方存档（Wayback/CommonCrawl 等），目标站 0 请求。

> ⚠️ **待改善：国内网络替代方案**
> waymore 查询的 Wayback Machine / CommonCrawl 等均为国外存档服务，国内网络直连不稳定。
> 目前已知方案：设代理后 passive 可正常走通；或跳过 passive 改用 collect + Yakit 流量双覆盖。
> **待实现：** 接入 FOFA/Hunter 等国内平台 API，通过搜索 JS URL→直接下载的方式替代 waymore。
> 如果你有可用的国内存档源或工具，欢迎改进。

## Step 5 分析（所有路径最终都到这）

```
python jss.py analyze                  # 自动分析最近一次收集结果
python jss.py analyze D:\dir1 D:\dir2  # 本地目录（小程序反编译/dist），可多个
```
产出 `report/ai_brief.md`：端点按 admin/internal/auth/upload/api 分组、sourcemap 引用、hae 高价值命中（若联动成功）、登录态 API、API 响应体中的端点/敏感信息（Yakit ingest 导入时）、小程序场景标记。本地目录会自动跳过图片/字体/压缩包等二进制（SKIP_EXTS），只分析代码与文本。

### 与本地 hae skill 联动（不改 hae 一行代码）

jss 的规则引擎（密钥/云AK/指纹/中文生态）来自本机 hae skill，运行时自动探测：

```
探测顺序：JSS_HAE 环境变量 > ~/.zcode/skills/hae > ~/.agents/skills/hae > ~/.claude/skills/hae
```

- **探测到** → analyze 自动调用，简报出现"hae: 敏感信息/指纹/弱点线索"三节，命中带 file:line。
- **没探测到** → 正则 + jsluice 引擎照跑（端点提取不受影响），日志提示降级。需要时二选一：
  `python jss.py analyze --hae C:\path\to\hae_scan.py <目录>` 或设 `JSS_HAE` 环境变量。
- **AI 判断指引**：hae 命中的密钥/凭据，jss 端点清单负责"这些密钥配哪些接口"——两者交叉才是攻击链。**反向**：用户只要敏感信息扫描时直接调 hae skill（它的规则最全），要端点+流程编排时才用 jss；hae skill 的完整语义分析要求（命中是线索不是结论、回源核实）在 jss 里同样适用。

## 跳过策略（核心原则，逐条对照）

**任何一步失败或不适用都不终止流程：记录原因，继续下一步，最终报告列出"已跳过"清单。唯一硬停条件是 Step 5 无任何文件可分析（exit=1，向用户要正确输入）。**

| 阻塞情形 | 处置 |
|---|---|
| katana 退出码非 0 / 收到 0 条 URL | 目标不可达或被拦截，跳过主动收集，passive 照走 |
| waymore 超时 / 退出码非 0 | 国内网络访问 Wayback 属常态（已知短板，见 Step 4 待改善），已落盘部分照用 |
| Yakit 里没有目标流量 | 跳过登录态导入，不算失败 |
| hae skill 未探测到 | 规则引擎降级（正则+jsluice 仍在），提示 --hae/JSS_HAE |
| jsluice.exe 缺失 | AST 引擎跳过（正则引擎仍在） |
| pip/go 等子进程报代理错误 | 系统挂了死代理，前置 `NO_PROXY='*'` 重试一次，仍败则跳过该环节 |
| requirements 依赖缺失（waymore 报 ImportError） | `pip install -r requirements.txt`，失败则 passive 跳过，其余照走 |
| analyze 目标目录为空 | 硬停，向用户要正确输入 |
| **katana 漏了某些 JS 文件**（如 config.js） | **AI 自行补位**：读 HTML 源码找 `<script src>`，curl 下载后重跑 analyze（见 Step 6 补位规则） |

## Step 6 AI 语义分析（不可省略，简报只是线索不是结论）

> 工具搞不定的，AI 来补。本节列出工具已知短板，AI 必须自行补位，不能等工具改进。

1. **敏感信息回源核实**（hae 命中）：读命中行上下文排除占位符/测试数据；判断密钥属于哪套体系（OSS AK？小程序签名 key？），能伪造/访问什么。
2. **admin/internal 组端点**逐个验证可达性与鉴权，401/403 记录；能匿名访问的标记重点。
3. **sourcemap 引用**若可下载，用 node（source-map 包）还原原始目录后重跑 `analyze <还原目录>`，产出多一个量级。
4. **输出报告**：引用 file:line；"已跳过环节"单独列一节；完整端点清单给文件路径。

### AI 补位规则（工具短板 → AI 动手）

| 工具短板 | AI 补位动作 |
|---|---|
| katana 遗漏了 HTML 中引用的 JS 文件（如 `config.js`） | AI 读首页 HTML 源码，提取所有 `<script src>`，用 curl 逐个下载到 `work/<目标>/js/`，然后重跑 analyze |
| katana 没爬到的页面/端点 | AI 从已有 JS 里提取的端点路径，自己 curl 探测（`/api/xxx` 等），返回的响应体手动写入 `work/<目标>/js/` 后重跑 analyze |
| waymore 国内网络不通，无历史 JS | AI 告知用户此环节跳过（国内网络限制），建议用户后续通过 FOFA/Hunter 等平台补充 JS 列表后手动下载 |
| hae 命中的密钥/凭据需要验证有效性 | AI 自己构造请求验证（如 OSS AK 配 ossutil 试读、API key 调对应接口看返回），不依赖任何工具 |
| jsluice 没解出来的拼接参数端点 | AI 从 JS 源码中找字符串拼接模板（`/api/` + id + `/detail` 等），手动构造完整端点清单 |
| 需要测试的端点太多，手工逐个发包太慢 | AI 对高优先级端点（admin/auth/upload）直接用 curl 批量验证，不需要等工具支持 |

**核心理念：** jss 的工具链做的是"机械劳动"——爬、收、批量提取。剩下的"判断、验证、补全、推理"全是 AI 的事。工具产出的 ai_brief.md 是线索索引，不是结论。AI 看到缺口就自己上，不要等工具更新。

## 子命令速查

| 子命令 | 打目标站请求 | 说明 |
|---|---|---|
| `collect <url>` | 有，限速 | katana 主动爬 + 礼貌下载 |
| `passive <domain>` | **0** | waymore 历史存档响应体 |
| `har <file.har>` | **0** | DevTools 导出的登录态流量 |
| `ingest <flows.json>` | **0** | Yakit MCP / 浏览器 MCP 抓包流量导入 |
| `analyze [dir...]` | 0 | 双引擎提取 + hae 增强 + AI 简报 |
| `list` | 0 | 历史目标一览 |
| `all <url>` | 有，限速 | collect + passive + analyze（失败环节跳过并汇总） |

重编译 jsluice（源码不在包内，需要时从 BishopFox/jsluice 获取）：`go build -o bin/jsluice.exe ./cmd/jsluice`。
