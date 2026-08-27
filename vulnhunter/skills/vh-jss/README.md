# jss - JS 侦察流水线（Windows 本地工具链）

针对 URL 目标或反编译小程序的 JS 收集与分析套件，产出 AI 可读简报，配合 Claude Code / ZCode 等 AI Agent 完成"工具广度 + AI 深度"的分工。**仅用于已授权的渗透测试 / SRC 挖掘。**

```
收集层（三选一或组合）          提取层（自动双引擎）           AI 层
┌─────────────────────┐      ┌────────────────────┐      ┌──────────────────┐
│ collect  katana 主动 │      │ jsluice AST 引擎    │      │ 读 ai_brief.md    │
│   （限速+预算防风控） │ ──►  │ hae 规则引擎        │ ──►  │ 语义分析/排优先级 │
│ passive  waymore 被动│      │ （密钥/指纹/端点）   │      │ 回源核实/出报告   │
│ har      登录态提取  │      └────────────────────┘      └──────────────────┘
└─────────────────────┘
```

## 环境（当前已全部就绪）

| 组件 | 位置 | 说明 |
|---|---|---|
| Python 3.11 | `D:\scooppython\3.11` | 依赖已装（PyYAML/termcolor/psutil/tldextract） |
| katana | `jss\katana\katana.exe` | 静态编译，无依赖 |
| waymore 8.9 | `jss\waymore-8.9\` | 源码运行，`python -m waymore.waymore` |
| jsluice | `jss\jsluice.exe` | 本地 Go 1.26 编译（源码在 `jsluice-main/`，重编译：`go build -o ../jsluice.exe ./cmd/jsluice`） |
| hae 规则引擎 | `~/.zcode/skills/hae/scripts/hae_scan.py` | 密钥/指纹/中文生态规则 |
| ripgrep | PATH | hae 的匹配引擎 |

## 快速开始

```bash
cd <本skill所在目录>

# 分步
python jss.py collect https://target.com     # 主动爬 + 下载 JS
python jss.py passive target.com             # 历史存档 JS（目标站 0 请求）
python jss.py har site.har                   # 登录态 JS（浏览器导出 HAR，0 请求）
python jss.py ingest flows.json --name 目标  # 登录态 JS + API（Yakit/浏览器 MCP 抓包导入，0 请求）
python jss.py analyze                        # 分析最近一次结果
python jss.py analyze D:\wxapp\decompiled    # 直接分析本地目录（小程序/构建产物）
python jss.py list                           # 历史目标一览

# 一条龙（任何环节失败自动跳过并汇总告知）
python jss.py all https://target.com

# 看结果
type work\<目标>\report\ai_brief.md          # AI 简报：端点分组+密钥+sourcemap
type work\<目标>\report\endpoints.txt        # 全量端点清单
```

## 防风控设计

- **collect 硬编码限速**：2 req/s 全局、1 req/s 每主机、请求间隔 1s、并发 4、总预算 8 分钟（`-ct`）、单域 150 页、下载上限 300 文件。到预算即停，不会无限爬。
- **下载器礼貌模式**：串行下载 + 每文件随机 0.6–1.5s 间隔 + 跳过 >5MB 与 HTML 假响应。
- **passive / har 对目标站 0 请求**：waymore 只查第三方存档；HAR 是你浏览器流量的离线回放。需要登录的应用优先走 HAR。
- 流水线只做侦察不发包攻击，验证类工作留给人工阶段。

## 结果目录结构

```
work/<目标名>/
├── urls_katana.txt        # katana 收到的 js/map URL
├── js/                    # 下载的 JS 文件（hash 前缀防重名）
├── waymore_responses/     # 历史存档 JS 响应体
├── manifest.json          # 文件名 ↔ 原 URL 映射（含状态码/大小）
└── report/
    ├── ai_brief.md        # ★ AI 简报（给 AI Agent 读的第一入口）
    ├── endpoints.txt      # 全量端点（去重）
    ├── endpoints.json     # 端点+分组+出处 file:line
    └── hae.json           # hae 完整扫描结果
```

## 常见问题

- **waymore 超时/退出码非 0**：国内访问 Wayback CDX API 偶发超时，已落盘的响应体仍然可用，重跑一次即可补全。
- **子进程报代理错误**：系统注册表代理（ProxyBridge）未启动导致，`jss.py` 已自动探测并绕过；手动执行工具时前置 `NO_PROXY='*'`。
- **换 Python 版本**：`jss.py` 用 `sys.executable` 调子进程，用哪个解释器启动整套就用哪个；新解释器需重装四个依赖。
- **sourcemap 还原**：`analyze` 会列出 JS 里的 `.map` 引用；`.map` 文件在手时用 node（`source-map` 包）写十行脚本即可还原原始目录，还原后重跑 `analyze <还原目录>`。
