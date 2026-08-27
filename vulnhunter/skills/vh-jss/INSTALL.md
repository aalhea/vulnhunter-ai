# jss skill 分发与安装说明

一个自包含的 JS 侦察流水线 skill 包，拷给任何 agent（ZCode / Claude Code / 任意支持 skills 的 CLI）即可加载。

## 包内容

```
jss-skill/
├── SKILL.md           skill 本体（agent 加载入口，含编排手册）
├── jss.py             编排器（纯 Python 标准库，≥3.8）
├── requirements.txt   waymore 的四个依赖
├── bin/               （自备，见下）katana + jsluice 二进制
└── waymore-8.9/       被动收集（Python 源码运行）
```

> **第三方二进制不随仓库分发**（体积与许可原因）。`bin/` 需自备两个文件，
> 放入本目录 `bin/` 下即可；缺失时 AST/主动爬取引擎自动降级跳过（正则引擎不受影响）：
>
> - `bin/katana.exe`（或 Linux 下对应二进制）— [chainreactors/katana releases](https://github.com/chainreactors/katana/releases)
>   （若上游地址变动，可改用 [projectdiscovery/katana](https://github.com/projectdiscovery/katana/releases)，调用参数兼容）
> - `bin/jsluice.exe` — [BishopFox/jsluice releases](https://github.com/BishopFox/jsluice/releases)

## 安装到目标机器

1. 整个文件夹拷到目标机任意位置（建议固定，如 `D:\tools\jss-skill`）。
2. 装依赖（一次性）：
   ```
   pip install -r requirements.txt
   ```
   国内镜像：`pip install -r requirements.txt -i https://mirrors.aliyun.com/pypi/simple/ --trusted-host mirrors.aliyun.com`
3. 把 `SKILL.md` 所在目录注册为 agent 的 skill：
   - **ZCode**：拷贝/软链到 `~/.zcode/skills/jss/`
   - **Claude Code**：`~/.claude/skills/jss/`（或项目级 `.claude/skills/jss/`）
   - **其他 agent**：对应 skills 目录，或直接把 SKILL.md 喂给它
4. 快速自检（不依赖任何 agent，直接跑）：
   ```
   python jss.py list
   ```
   输出 `(没有历史结果)` 即工具链正常。

## 可选增强

- **hae 联动**：目标机装了 hae skill（`~/.zcode|.agents|.claude/skills/hae`）则 analyze 自动调用其规则引擎（密钥/云AK/指纹/中文生态）；没装则自动降级。可用 `JSS_HAE` 环境变量或 `analyze --hae <路径>` 显式指定。
- **JSS_WORK 环境变量**：默认结果落在会话目录 `work/`（即运行 `python jss.py` 时所在的目录）；设 `JSS_WORK=D:\results` 可重定位到其他位置。重定位对 AI 可见性有影响——如果不在会话目录下，AI 不会自动发现已有产物，需要你显式告知。

## 已验证平台

- Windows 11 + Python 3.8 / 3.11（两套解释器均测试通过）
- 已知环境坑：系统代理未启动会导致 pip/waymore 报错，前置 `NO_PROXY='*'`；jss.py 内部已自动处理

## 仅用于已授权的渗透测试 / SRC 挖掘

collect 子命令会向目标发送限速请求（2 req/s、8 分钟预算）；passive/har/ingest/analyze 对目标站零请求。
