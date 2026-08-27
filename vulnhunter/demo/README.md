# demo/ — 演示工作区

`demo` 是一个开箱即用的演示目标（example.com，IANA 保留文档域，公认可安全探测）。

- `scope.yaml` — 授权范围文件：插件启动时加载，`recon_*` 工具的所有目标都会
  经过 CIDR/域名护栏校验，越界即拦截（fail-closed）。
- `*-实测报告.md` — 一次真实流水线运行生成的漏洞报告样例（供参考格式）。
- `artifacts/` — 运行产物目录（gitignore，首次运行自动创建）。

真实使用：复制 `config/scope.example.yaml`，改写为你授权的 SRC 目标。
