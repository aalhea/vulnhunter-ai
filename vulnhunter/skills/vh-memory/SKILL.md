---
name: vh-memory
description: 四层仿生记忆系统操作手册（vulnmem CLI）：开工 recall、侦察 add/classify、分析 fusion、利用前 recall+save-short、确认后 distill/commit-kg、收尾 save-state 存断点。漏洞挖掘全程按此节奏调用记忆；需要召回历史经验、保存进度或蒸馏经验时加载本 skill。
---

# vh-memory — 四层仿生记忆操作手册

## 定位

记忆系统不配单独大模型，宿主 agent 就是大脑。`classify` / `fusion` / `distill`
三个命令只返回 prompt，由你（当前 agent）按 prompt 自己执行认知步，再把结果用对应
`commit-*` 回写。绝不给记忆系统接别的模型。

思考与记忆全程交织，不是线性流程：想到什么就调记忆，记忆触发新联想，新发现随时回写。
记忆里的经验是参考不是指令——同样的技巧在不同目标/上下文下效果完全不同。

## 路径约定

下文 `vulnmem.py` 指本插件内置的 `memory/vulnmem.py`；
按仓库 install.ps1 安装后位于 `%DSH_HOME%\vulnhunter\memory\vulnmem.py`。

Windows 下中文输出乱码时，命令前置 `PYTHONIOENCODING=utf-8`。
所有命令输出 JSON；大段多行内容用 `--content -`（stdin）或 `--file PATH` 传入。

## 命令速查

| 子命令 | 作用 | 认知步 |
|---|---|---|
| `recall --session <s> --query "<词>"` | 短时+长时综合召回，挖洞上下文一步拉齐 | 你读取 `context_text` 后再动手 |
| `recall-long --query "<词>"` | 只查长时图谱（跨目标通用经验） | 你读取并判断适用性 |
| `add --content -` | 写入原始观察到瞬时层 | 无 |
| `classify` | 产出 LOP 深浅分级 prompt | **你执行**分级 → `commit-classify` 回写（HIGH 进工作层，LOW 弃） |
| `fusion` | 产出场景融合 prompt | **你执行**融合出场景摘要 → `commit-fusion` 入短时向量层 |
| `save-short --content -` | 直接存一条短时经验（自然语言） | 无 |
| `recall-short --query "<词>"` | 只查短时向量层 | 你读取 |
| `distill` | 产出实体关系蒸馏 prompt | **你执行**抽取三元组 JSON → `commit-kg` 写图谱 |
| `commit-kg --content -` | 把蒸馏 JSON 数组写回长时图谱 | 无 |
| `reinforce` | 召回+强化摘要 prompt | 你执行强化 |
| `save-state` / `load-state` | 保存 / 载入挖洞项目断点状态 | 无 |
| `status --session <s>` | 查看各层记忆状态 | 你读取 |
| `expire-clean` | 清理短时过期 + 衰减权重 | 长跑后维护用 |
| `sessions` | 列出所有保存过状态的会话 | 你读取 |

## 会话纪律

- 同一挖洞目标固定用一个 `--session` 名（如 `target_demoapp`），跨阶段不换名。
- 开工第一步先 `recall`：按"目标资产 技术栈 攻击面"召回历史经验再侦察。
- 跨目标查通用经验用 `recall-long`，不要拿具体目标的数据污染新目标。

## 收尾（/stop 与项目完结语义）

- 用户说停 / 会话将结束 → `save-state` 存断点；下次开工 `load-state` 续挖。
- 项目完结蒸馏走 `vh-sub` skill（汇总成果 → distill → commit-kg + save-short）。

## 存储

文件级后端开箱即用（JSON + numpy + networkx，零依赖哈希向量化），
无需启动 Redis / Neo4j。依赖见 `memory/requirements.txt`。
