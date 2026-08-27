---
name: vh-yakit-plugin-rightclick
description: >-
  Yakit 右键插件 (codec 插件) 的使用与编程技巧。讲清 codec 插件只需要一个 handle(input) 函数,
  配合插件类型 codec + 开关"用于数据包右键" (tag: allow-custom-context-menu-execute) 即可出现在
  任意 HTTP 编辑器的右键菜单里; 还讲 History 右键(单选/多选)时 input=flow id 的特殊契约(可由 id
  反查数据包提取 host 全部 path/参数名, 带 yakit.SetProgress 进度条与 db Yield 通道), codec 插件
  叠加 cli 参数做下拉选择(提取 Path/参数名/Cookie), Web Fuzzer 选区做"奇怪变换", 以及如何用
  yak codec-plugin 命令验证。当用户问"怎么写右键插件 / codec 插件怎么用 / History 右键提取数据 /
  Web Fuzzer 右键变换 / codec 带参数"时使用。右键插件是编写小工具最快的方式。
---

# SKILL: Yakit 右键插件 (codec) 使用与编程

> AI LOAD INSTRUCTION: codec 插件是 Yakit 里写"小工具"成本最低的方式——**只需要一个 `handle(input)`
> 函数**。把插件类型设为 `codec` 并打开"用于数据包右键"开关, 它就会出现在 MITM/History/Web Fuzzer
> 等所有 HTTP 编辑器的右键菜单里, 把当前选中文本作为 `input` 传进来, 展示 `handle` 的返回值。本页讲
> 启用方式、编程契约、Web Fuzzer 右键的两层菜单, 以及命令行验证闭环。

## 0. 相关路由

- 总入口: [yak](../yak/SKILL.md)
- 原生插件(yak/mitm) + cli 参数体系: [yakit-native-plugin](../yakit-native-plugin/SKILL.md)
- 验证工具链: [yaklang-toolchain](../yaklang-toolchain/SKILL.md)（`yak codec-plugin` 命令）
- 历史数据提取/字典/发包: [yakit-data-extract-plugin](../yakit-data-extract-plugin/SKILL.md)
- 数据库 / Payload 字典: [yaklang-database](../yaklang-database/SKILL.md)
- 三类热加载: [mitm-hotpatch](../mitm-hotpatch/SKILL.md) / [webfuzzer-hotpatch](../webfuzzer-hotpatch/SKILL.md) / [global-hotpatch](../global-hotpatch/SKILL.md)

## 1. codec 插件的唯一契约: handle(input)

```yak
// 一个最小可用的 codec 插件: 把选中文本 Base64 编码
handle = func(input /* string: 当前选中的文本 */) {
    return codec.EncodeBase64(input)   // 返回值即右键执行后的结果
}
```

- 入口函数固定叫 `handle`, 入参是选中文本 (string), 返回字符串。
- 没有选区时, 传入的是整个编辑器内容。
- `handle` 内可以用任意 yaklang 库 (`codec` / `str` / `json` / `re` / `poc` ...)。
- 后端执行就是 `handle(input)` 这一句 (`SafeCallYakFunction(ctx, "handle", [input])`),
  CLI 与 Yakit UI 走的是**完全相同**的执行路径。

## 2. 怎么让它出现在右键菜单 (关键: 一个 tag)

在 Yakit 插件编辑器里:

1. 插件类型选 **codec**。
2. 打开开关 **"用于数据包右键"**。

这个开关本质是给 `YakScript.Tags` 加一个 tag:

| 开关文案 | tag 值 | 效果 |
| --- | --- | --- |
| 用于数据包右键 | `allow-custom-context-menu-execute` | 出现在右键 → **插件扩展** 子菜单 (codec 插件) |
| HTTP 数据包变形 | `allow-custom-http-packet-mutate` | 出现在右键 → **HTTP数据包变形** (对整包变形) |
| 单条历史记录处理 | `allow-custom-single-history-mutate` | 在 History 单条记录右键可用 |
| 多条历史记录处理 | `allow-custom-multiple-history-mutate` | 在 History 多选记录右键可用 |

> 编辑器右键时, Yakit 用 `QueryYakScript({Type:'codec', Tag:['allow-custom-context-menu-execute']})`
> 把所有带该 tag 的 codec 插件拉出来, 注入到 **插件扩展 / AI工具** 菜单。保存插件后会触发
> `onRefPluginCodecMenu` 重新加载菜单。

## 3. 点击后发生了什么 (执行链)

```
选中文本 → 右键 → 插件扩展 → 你的插件
   → onOpenFuzzerModal { text(选中文本), scriptName }
   → DebugPlugin { Input: text, PluginName, PluginType: 'codec' }
   → 引擎执行脚本并调用 handle(input)
   → 结果流式回显在 "Codec结果" 面板
```

重要行为差异:

- **codec 右键插件的结果展示在面板里 (Codec结果), 不会自动写回编辑器**——需要手动复制。
- **内置"编码/解码"** (右键 → 编码/解码, 无需插件) 以及 **HTTP数据包变形插件**
  (`allow-custom-http-packet-mutate`) 才会直接替换编辑器内容/整包。
- 想要"选中即替换", 在 Web Fuzzer 里用**选区浮动菜单的编解码**最顺手 (见第 5 节)。

## 4. 编程技巧 (写出好用的右键插件)

- **保持纯函数**: `handle` 只依赖 `input`, 不读外部状态, 结果可预测、好验证。
- **容错不抛错**: 解码失败时返回友好提示字符串, 而不是 panic, 右键体验更好。
  ```yak
  handle = func(input) {
      raw, err = codec.DecodeBase64Url(input)
      if err != nil { return "decode failed: " + input }
      return string(raw)
  }
  ```
- **善用 codec 库**: `EncodeBase64/DecodeBase64/EncodeBase64Url/DecodeBase64Url`、`UnicodeDecode`、
  各种 hash/对称加密都在 `codec` 里, 多数小工具一行搞定。
- **可逆优先**: 编/解码类尽量保证 `handle(handle(x))` 或编解码成对, 方便来回切。
- **先自测再上架**: 写 `if YAK_MAIN { runSelfTest() }`, 用 `yak file.yak` 跑断言;
  注意 `handle` 不要被 `YAK_MAIN` 包住 (它要常驻注册), 只把自测放进守卫块。

## 5. Web Fuzzer 编辑器的右键 (两层菜单)

Web Fuzzer 请求编辑器有两套交互, 都能调用编解码/插件:

### A. Monaco 原生右键菜单

右键弹出, 分组包含:

- **编码 / 解码**: 内置编解码 (base64/url/hex/...), 选中后可"替换内容"写回编辑器。
- **HTTP数据包变形**: 调用带 `allow-custom-http-packet-mutate` 的插件, 对整包变形。
- **插件扩展 / AI工具**: 调用带 `allow-custom-context-menu-execute` 的 codec 插件 (结果进面板)。
- **插入标签/字典**: 插入空字节、临时/Fuzz 字典、`{{yak:dyn(...)}}` 热加载标签、文件标签等。

### B. 选区浮动操作条 (最常用)

选中一段文本时, 旁边浮出操作条:

- **编码**: 把选中文字包成 fuzztag 并**替换选区**, 例如选中 `admin` → `{{base64enc(admin)}}`,
  发包时由 Fuzzer 引擎渲染。
- **解码 / 智能解码**: 走 `AutoDecode` 自动识别编码并解出明文, 点"替换"写回。
- **插件 / AI**: 同样把选区文本喂给 codec 插件 (结果进面板)。

> 经验法则: 想"选中即替换成 fuzztag"用**浮动条编码**; 想"看一眼解码结果"用**浮动条解码/智能解码**;
> 想"跑自己写的复杂转换"用**右键插件扩展 → codec 插件**。

## 6. 命令行验证 (与 UI 同款 handle 执行)

```bash
# 用 yaklang 源码引擎构建一次
cd /Users/v1ll4n/Projects/yaklang && go build -o /tmp/yak ./common/yak/cmd/yak.go

# 验证 codec 插件: 把 input 喂给 handle, 打印返回值
/tmp/yak codec-plugin --script skills/yakit-rightclick-plugin/examples/codec-base64-wrap.yak --input "admin:123456"
# -> output: YWRtaW46MTIzNDU2

# 也支持从文件读取 input
/tmp/yak codec-plugin --script x.yak --input-file /tmp/payload.bin
```

`yak codec-plugin` 与 Yakit 右键执行同样调用 `handle(input)`, 所以"命令跑通 == 右键也能跑通"。

## 7. History 右键: input 是 flow id, 不是文本(重要契约)

普通 HTTP 编辑器右键时 `input` 是选中文本; 但在 **History 表格行右键** 跑 codec 插件时,
Yakit 传进来的 `input` 是这条记录的 **flow id**(已核实, 见 yakit 源码
`components/HTTPFlowTable/useHTTPFlowTableContextMenu.tsx`):

| 场景 | tag(开关) | 传入 handle 的 input |
| --- | --- | --- |
| History 单条右键 | `allow-custom-single-history-mutate`(用于history右键(单选)) | 单个 id, 如 `"1287"` |
| History 多选右键 | `allow-custom-multiple-history-mutate`(用于history右键(多选)) | 逗号拼接 id, 如 `"1287,1290,1305"` |

> 前端在 `onOpenFuzzerModal` 事件里: 单选 `text = \`${rowData.Id}\``, 多选
> `text = selectedRowKeys.join(',')`, 同时携带脚本声明的 `params`(cli 参数)。

拿到 id 后, 用 db 的 Yield 通道反查数据包、再做提取:

```yak
handle = func(input) {
    ids = parseIds(input)                          // "1287,1290" -> [1287, 1290]
    for flow in db.QueryHTTPFlowsByID(ids...) {     // Yield 通道, 底层 yakit.YieldHTTPFlows
        host = hostOf(flow.Url)
        for f in db.QueryHTTPFlowsByKeyword(host) { // 该 host 的全部历史流量
            req = codec.StrconvUnquote(f.Request)~  // flow.Request 是 quote 后的, 需还原
            // ... 提取 path / 参数名 / cookie
        }
    }
}
```

### 进度条: yakit.SetProgress

提取量大时, 用 `yakit.SetProgress(0~1)` 在执行面板显示进度(`SetProgressEx(id, f)` 可多条):

```yak
total = len(hosts); done = 0
for host in hosts {
    yakit.SetProgress(float(done) / float(total))   // 注意 yak 的 for i,v in slice 给的是(元素,nil), 索引要自己数
    // ... 提取
    done++
}
yakit.SetProgress(1.0)
```

> 完整可运行: [examples/codec-history-extract-paths.yak](examples/codec-history-extract-paths.yak)
> (`yak <file>` 自测纯逻辑; `--real <id>` 用真实 History 跑 flow id -> 数据包 -> 提取全链路)。

## 8. codec 插件 + cli 参数(让用户选"提取什么")

codec 插件也能声明 `cli` 参数: History 右键时 Yakit 会先弹出参数表单, 用户填完再执行 `handle`。
用 `cli.StringSlice + setSelectOption + setMultipleSelect(false)` 做一个"提取项"下拉:

```yak
MODE_SEL = cli.StringSlice("mode",
    cli.setVerboseName("提取项"),
    cli.setSelectOption("提取 Path", "path"),
    cli.setSelectOption("提取 参数名", "param"),
    cli.setSelectOption("提取 Cookie", "cookie"),
    cli.setMultipleSelect(false), cli.setDefault("path"))
cli.check()
MODE = "path"
if len(MODE_SEL) > 0 { MODE = MODE_SEL[0] }

handle = func(input) {     // input 仍是 flow id; MODE 由表单决定提取什么
    // ... 按 MODE 提取, 可选 db.SavePayload 落字典, db.YieldPayload 回读复用
}
```

> 完整可运行: [examples/codec-cli-extract-selector.yak](examples/codec-cli-extract-selector.yak)
> (三种模式自测 + Payload 字典 `SavePayload`/`YieldPayload` roundtrip; `--real <id> --mode param` 跑真实库)。
> cli 参数体系详见 [yakit-native-plugin](../yakit-native-plugin/SKILL.md)。

## 9. Web Fuzzer 选区做"奇怪变换"

在 Web Fuzzer 选中一段(如 payload), 右键 -> 插件扩展 -> codec 插件, `input` 是选中文本,
可做任意变换返回。一个实用例子: 逐字符混合编码(url `%xx` / html `&#d;` / unicode `\uXXXX` / 原文交替),
得到"语义等价但形态怪异"的变体探测/绕过简单 WAF:

```yak
handle = func(input) { return weirdTransform(input) }   // "admin" -> a%64&#109;\u0069n
```

> 完整可运行: [examples/codec-fuzzer-transform.yak](examples/codec-fuzzer-transform.yak)。
> 选区"编码成 fuzztag 并替换"用浮动条编码(见第 5 节 B); 跑复杂变换用右键插件扩展。
> 提示: `log.info` 是 printf 风格, 打印含 `%` 的内容要用 `log.info("%s", x)` 占位, 不能直接字符串拼接。

## 10. 示例 (examples/)

| 文件 | handle 作用 | input | 验证 |
| --- | --- | --- | --- |
| [codec-base64-wrap.yak](examples/codec-base64-wrap.yak) | 选中文本 Base64 编码 | 选中文本 | `--input "admin:123456"` |
| [codec-jwt-decode.yak](examples/codec-jwt-decode.yak) | JWT 一键解码 header+payload | 选中文本 | `--input "eyJ...header.eyJ...payload.sig"` |
| [codec-unicode-unescape.yak](examples/codec-unicode-unescape.yak) | `\uXXXX` 还原中文 | 选中文本 | `--input '\u4e2d\u6587abc'` |
| [codec-timestamp-to-date.yak](examples/codec-timestamp-to-date.yak) | Unix 时间戳转 UTC 日期 | 选中文本 | `--input "1700000000"` |
| [codec-history-extract-paths.yak](examples/codec-history-extract-paths.yak) | flow id 反查包 -> 提取 host 全部 path/参数名(进度条) | flow id | `yak <file>` / `--real 1` |
| [codec-cli-extract-selector.yak](examples/codec-cli-extract-selector.yak) | codec + cli 下拉选提取 Path/参数名/Cookie + 落字典 | flow id + cli | `yak <file>` / `--real 1 --mode param` |
| [codec-fuzzer-transform.yak](examples/codec-fuzzer-transform.yak) | Web Fuzzer 选区逐字符混合编码变换 | 选中文本 | `--input "<script>alert(1)</script>"` |

每个示例都带 `YAK_MAIN` 自测块, `yak <file>.yak` 即可自证; 编辑器选区类示例能被
`yak codec-plugin` 命令复现证据。History 提取类示例用合成数据自测纯逻辑, `--real <id>` 可跑真实库链路。
