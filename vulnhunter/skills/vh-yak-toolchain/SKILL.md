---
name: vh-yak-toolchain
description: >-
  Yaklang 工具链与插件验证指南。讲清如何用 yaklang 源码引擎 (go run common/yak/cmd/yak.go) 跑脚本，
  以及四个热加载/codec 验证命令 (yak hotpatch-mitm / hotpatch-global / hotpatch-webfuzzer / codec-plugin)
  如何用真实 gRPC 同款执行路径验证你写的 MITM / 全局 / Web Fuzzer 热加载与右键 codec 插件；还讲如何
  借助 yaklang 仓库源码定位与调试 MITM 问题。当用户问"我写的插件怎么验证 / MITM 行为不对怎么调"时使用。
---

# SKILL: Yaklang 工具链与插件验证

> AI LOAD INSTRUCTION: 写完一个热加载或 codec 插件后，最大的问题是"怎么确认它真的对"。本页给出
> 两种验证路径：1) `YAK_MAIN` 自测块（逻辑自证）；2) 四个 `yak` 验证命令，用与 Yakit UI **同款的
> gRPC 执行路径** 把脚本跑在真实的请求/响应上、打印改写证据。还讲如何用 yaklang 仓库源码反查 Hook
> 契约、调试 MITM。命令需要用 yaklang 仓库构建的引擎（见下）。

## 0. 相关路由

- 总入口：[yak](../yak/SKILL.md)
- 三类热加载写法：[mitm-hotpatch](../mitm-hotpatch/SKILL.md) / [webfuzzer-hotpatch](../webfuzzer-hotpatch/SKILL.md) / [global-hotpatch](../global-hotpatch/SKILL.md)
- 右键 codec 插件编程：[yakit-rightclick-plugin](../yakit-rightclick-plugin/SKILL.md)
- 历史数据提取扫描：[yakit-data-extract-plugin](../yakit-data-extract-plugin/SKILL.md)

## 1. 用源码引擎跑脚本（go run 工作流）

```bash
cd /Users/v1ll4n/Projects/yaklang
# 跑任意 .yak（拿到最新引擎能力）
go run common/yak/cmd/yak.go path/to/script.yak

# 构建一次复用更快
go build -o /tmp/yak ./common/yak/cmd/yak.go
/tmp/yak path/to/script.yak
```

合格标准：10 秒内完成、所有 `assert` 通过、`log` 全英文、出现 `... self test passed`。

## 2. 四个验证命令（与 Yakit gRPC 同款执行路径）

这些命令把脚本喂进引擎里**真正使用的同一套 Hook 执行链**（`MixPluginCaller` / `MutateHookCaller` /
codec `handle`），而不是另写一套模拟，所以"命令跑通 == Yakit 里也能跑通"。

| 命令 | 验证对象 | 底层路径 |
| --- | --- | --- |
| `yak hotpatch-mitm` | MITM 热加载 | `NewMixPluginCaller().LoadHotPatch` + `CallHijackRequest/ResponseEx` + `Mirror` + `HijackSaveHTTPFlow` |
| `yak hotpatch-global` | 全局热加载 | 同上，外加 `CallBeforeRequest/AfterRequest`（全局管线顺序） |
| `yak hotpatch-webfuzzer` | Web Fuzzer 热加载 | `MutateHookCaller` 返回的 `beforeRequest/afterRequest/mirrorFlow/retryHandler/customFailureChecker` + `{{yak(...)}}` fuzztag |
| `yak codec-plugin` | 右键 codec 插件 | 执行脚本并调用 `handle(input)` |

### 2.1 hotpatch-mitm / hotpatch-global

```bash
# 准备一个原始请求文件
printf 'POST /api/order/create HTTP/1.1\r\nHost: shop.example.com\r\nContent-Type: application/json\r\n\r\n{"amount":100,"product_id":42}' > /tmp/req.txt

yak hotpatch-mitm --script skills/mitm-hotpatch/examples/hijack-request.yak --request /tmp/req.txt
```

输出会打印 原始请求 / 改写后请求 / drop 状态 / 入库 tag 等证据。带响应验证响应劫持：

```bash
yak hotpatch-mitm --script x.yak --request /tmp/req.txt --response /tmp/rsp.txt [--https] [--url URL]
```

`hotpatch-global` 参数相同，额外驱动 `beforeRequest`/`afterRequest`，适合验证全站透明加解密类脚本。

### 2.2 hotpatch-webfuzzer

```bash
# 验证 beforeRequest/afterRequest/retryHandler/customFailureChecker
yak hotpatch-webfuzzer --script x.yak --request /tmp/req.txt --response /tmp/rsp.txt

# 验证脚本里定义的 {{yak(...)}} fuzztag
yak hotpatch-webfuzzer --script skills/webfuzzer-hotpatch/examples/fuzztag-handle.yak \
    --request /tmp/req.txt --fuzztag '{{yak(hash|md5,hello)}}'
# -> rendered-fuzztag: [5d41402abc4b2a76b9719d911017c592]
```

### 2.3 codec-plugin（右键 codec）

```bash
yak codec-plugin --script skills/yaklang-toolchain/examples/codec-rot13.yak --input "Hello, Yak!"
# -> output (len=11): Uryyb, Lnx!

# 也支持从文件读 input
yak codec-plugin --script x.yak --input-file /tmp/payload.bin
```

示例：[examples/codec-rot13.yak](examples/codec-rot13.yak)；右键 codec 插件的编程与使用见
[yakit-rightclick-plugin](../yakit-rightclick-plugin/SKILL.md)。

## 3. 用 yaklang 仓库调试 MITM 问题

当 Hook 行为和预期不符、或不确定某个 Hook 的签名/语义时，直接查源码是最快的：

```bash
cd /Users/v1ll4n/Projects/yaklang

# 1) 查 Hook 签名与调用方式（MITM/全局都在这里）
grep -n "CallHijackRequest\|CallHijackResponseEx\|hijackSaveHTTPFlow\|MirrorHTTPFlow" \
    common/yak/hook_mixed_plugin_caller.go

# 2) 查 Web Fuzzer 的 6 个 hook 闭包定义
grep -n "beforeRequest\|afterRequest\|retryHandler\|customFailureChecker" \
    common/yak/script_engine_for_fuzz.go

# 3) 找现成测试用例当样例
grep -rn "LoadHotPatch\|hijackHTTPRequest" --include="*_test.go" common/
```

调试要点：

- MITM 劫持类 Hook 的 `forward`/`drop` 在引擎侧是 `func() interface{}`，由 `constClujore`
  包装（见 `common/yakgrpc/grpc_mitm.go`）；脚本里 `forward(pkt)` 即写回改写包，`drop()` 即丢弃。
- `IsPassed(url)` 会按过滤器决定是否触发 Hook，默认（无过滤器）放行。
- 在脚本里用 `desc(obj)` 打印对象方法/字段，确认 `flow.AddTag` / `flow.Red()` 等是否存在。
- 复现问题：把出问题的请求存成文件，用 `yak hotpatch-mitm --script ... --request ...` 单步看改写证据，
  比在 UI 里反复点更快。

## 4. 如何验证你写的插件（推荐闭环）

```mermaid
flowchart LR
    W[写 hook + YAK_MAIN 自测] --> S[yak file.yak 自测过]
    S --> C[yak hotpatch-* 命令跑真实请求]
    C --> E[stdout 证据符合预期]
    E --> P[粘回 Yakit 使用]
```

1. 先写 `if YAK_MAIN { runSelfTest() }`，`yak file.yak` 让逻辑自证。
2. 用对应的 `yak hotpatch-*` / `codec-plugin` 命令喂真实请求/响应，核对 stdout 证据。
3. 证据无误后把脚本粘回 Yakit——`YAK_MAIN=false`，自测块不执行，安全。

> 批量验证整库脚本并把证据落地，见 `yak-skills/scripts/validate-skills.yak`；用 `mitm` 模块起
> 真实代理链路的补充证据，见 `yak-skills/scripts/mitm-live-demo.yak`。

## 5. 命令实现位置（贡献/排错用）

- 命令定义：`yaklang/common/yak/cmd/yakcmds/hotpatch.go`（导出 `HotPatchValidatorCommands`）。
- 注册点：`yaklang/common/yak/cmd/yak.go`（`cliGroup("Hot Patch Validators", ...)`）。
- 单元测试：`yaklang/common/yak/cmd/yakcmds/hotpatch_test.go`
  （`go test ./common/yak/cmd/yakcmds/ -run 'HotPatch|Codec'`）。
