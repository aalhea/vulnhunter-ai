---
name: vh-yakit-plugin-extract
description: >-
  解决一个高频实战痛点：在 Yakit History 里积累了某站点大量流量后，如何一键按域名捞取所有唯一
  路径、拿到登录 Cookie，并把这些路径沉淀成可复用的 Payload 字典，再带着登录态逐路径发包扫描/Fuzz。
  覆盖 db.QueryHTTPFlowsByKeyword 捞 History、URI 去重、Cookie 提取、db.SavePayload/YieldPayload
  字典管理、poc.HTTP 登录态发包。当用户想"从历史流量提取数据驱动后续扫描"时使用。
---

# SKILL: Yakit 历史数据提取与字典驱动扫描

> AI LOAD INSTRUCTION: 本 skill 针对一个具体痛点——“在 History 里堆了一堆某域名的流量，
> 想把唯一路径全捞出来、拿到登录 Cookie，然后接着扫/Fuzz”。给出两个端到端可运行示例：
> 按域名捞流量并去重提 Cookie、把去重路径接入 Payload 字典并带登录态真实发包扫描。
> 两个示例都 `yak <file>` 自测通过，其中扫描示例会起本地真实靶站发真实 HTTP 请求作为证据。

## 0. 相关路由

- 总入口：[yak](../yak/SKILL.md)
- 数据库 API（KV / Payload / 查询）：[yaklang-database](../yaklang-database/SKILL.md)
- 想在 MITM 阶段直接采集而非事后捞库：[mitm-hotpatch](../mitm-hotpatch/SKILL.md)
- 训练材料交叉引用：`yaklang-ai-training-materials/library-usage/db/db-practice.yak`

## 1. 痛点拆解

一个常见的工作流被卡在“数据搬运”上：

```mermaid
flowchart LR
    H[History 大量流量] --> Q[按 domain 捞取]
    Q --> D[URI 去重]
    Q --> C[提取登录 Cookie]
    D --> P[沉淀 Payload 字典]
    P --> S[带 Cookie 逐路径发包扫描]
    C --> S
```

手工做这件事很痛：路径重复、query 干扰去重、Cookie 散落在不同请求里、扫描时忘了带登录态。
本 skill 用 `db` + `poc` 把每一步都脚本化。

## 2. 按 domain 捞 History + URI 去重 + 提取 Cookie

核心数据形态（先核实，勿臆测）：

| 来源 | 形态 |
| --- | --- |
| `db.QueryHTTPFlowsByKeyword(domain)` | 返回 `*HTTPFlow` 迭代器（channel） |
| `flow.Url` | 完整 URL 字符串 |
| `flow.Request` | `codec.StrconvQuote` 后的字符串，需 `codec.StrconvUnquote` 取原始字节 |
| 登录 Cookie | `poc.GetHTTPPacketHeader(req, "Cookie")` |

```yak
collectFromHistory = func(domain) {
    pairs = []
    for flow in db.QueryHTTPFlowsByKeyword(domain) {
        req = codec.StrconvUnquote(flow.Request)~
        pairs = append(pairs, {"url": flow.Url, "req": []byte(req)})
    }
    return analyzePairs(pairs)   // 归一化去重 + 收集 cookie
}
```

去重 key 用“去掉 scheme 与 query 后的 host+path”，避免 `?page=1` / `?page=2` 被当成两条。

完整示例：[examples/collect-domain-urls.yak](examples/collect-domain-urls.yak)

## 3. 去重路径接 Payload 字典 + 带登录态发包扫描

把路径沉淀成 Yakit Payload 字典（持久化、可在 Web Fuzzer / 扫描器里复用），再带 Cookie 逐条发包，
用状态码区分存活/不存在：

```yak
db.SavePayload(group, dedupPaths(paths))~        // 去重后入库
for path in db.YieldPayload(group) {             // 迭代字典逐条扫描
    raw = sprintf("GET %s HTTP/1.1\r\nHost: %s\r\nCookie: %s\r\nConnection: close\r\n\r\n", path, hostport, cookie)
    rsp, _ = poc.HTTP(raw, poc.timeout(5), poc.save(false))~
    code = poc.GetStatusCodeFromResponse(rsp)    // 200 存活 / 404 不存在
}
```

完整示例：[examples/path-scan-with-payload.yak](examples/path-scan-with-payload.yak)
（自测会在本地随机端口起真实靶站，真正发出 HTTP 请求并校验状态码与 Cookie 透传）

## 4. 坑（先核实再写）

- `flow.Request` / `flow.Response` 是 strconv-quote 之后的字符串，直接当原文用会带转义；务必
  `codec.StrconvUnquote(...)~`。
- `db.YieldPayload(group)` 直接产出 payload 内容字符串，不是带 `.Content` 字段的对象，直接用 `p`。
- `db.SavePayload` 写的是 profile 持久库；脚本里用唯一前缀的 group 并 `defer db.DeletePayloadByGroup(group)` 清理，避免污染。
- 去重一定要先剥掉 query，否则同一接口的不同分页会被当成不同 URI。
- 发包扫描务必 `poc.timeout(...)` + `poc.save(false)`（自测/批量时不写库），避免卡死与污染 History。

## 5. 如何验证你写的提取/扫描脚本

- 直接 `yak your-script.yak`，让 `YAK_MAIN` 自测块用合成数据 + 本地靶站跑通逻辑。
- 想验证真实 History 捞取，可先用 [mitm-hotpatch](../mitm-hotpatch/SKILL.md) 采集几条流量再跑。
- 工具链与命令行验证方式见 [yaklang-toolchain](../yaklang-toolchain/SKILL.md)。
