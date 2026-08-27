# AGENTS.md — dsh-vulnhunter 作战纪律（对 agent 与贡献者同样生效）

## artifact 纪律（最高优先）

- 原始扫描输出（enscan/amass/httpx/nuclei/waymore……可能数万行）**永不进模型上下文**。
- 一切原始输出重定向落盘：`<target>/artifacts/<step>.<ext>`；上下文里只允许出现上一步的**结构化结论**。
- 结论必须标注来源 artifact 相对路径，可回溯。

## 攻击面账本

- 每个目标一个账本：`<target>/ledger.md`，字段：`攻击面 | 类型 | 状态(未测/测试中/已证实/已排除/阻塞) | 证据指针 | 严重性`。
- 新发现立即入账；上下文被压缩后第一件事回读账本；交还控制权前导出全量。
- 只有本体写账本；子代理结论先记"疑似"，核验后转正（persona §分身协同 A4）。

## 授权范围

- 开工前必须有 `<target>/scope.yaml`（模板见 config/scope.example.yaml）；没有就先向用户要，绝不默认授权。
- host/端口锚定不漂移；excludes 命中即拒绝；红线（删数据/脱库/DoS/改配置）无条件停下。

## 记忆节奏

- 开工 recall → 观察 add/classify → 分析 fusion → PoC 前 recall、新结论 save-short → 确认后 distill/commit-kg → 收尾 save-state。CLI 与命令见 vh-memory skill；代码在 memory/vulnmem.py。

## 报告

- 路径 `<target>/NN-名称.md`；只收"已证实"；证据一律 raw HTTP request 全文格式（请求行、头、body）。
