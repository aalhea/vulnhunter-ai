---
name: vh-yakit-plugin-native
description: >-
  Yakit 原生插件(yak / mitm 类型)与 cli 参数体系。讲清原生插件与热加载的区别、cli.* 如何变成
  Yakit 执行页的参数表单(String/Int/Bool/Urls/Ports/StringSlice 下拉/File 等 + setRequired/
  setDefault/setVerboseName/setCliGroup), 以及三个优秀案例: yak 原生插件用 cli 收用户输入、
  mitm 原生插件被动扫描复杂内容并产出 risk、mitm + cli 交互式插件加载外部参数(关键词字典/作用域)
  驱动扫描。当用户问"怎么写带参数表单的 yak/mitm 插件、cli 怎么用、mitm 插件怎么做被动扫描"时使用。
---

# SKILL: Yakit 原生插件(yak / mitm) 与 cli 参数

> AI LOAD INSTRUCTION: Yakit 插件分"原生插件"(保存为 YakScript, 有独立执行页/参数表单)与
> "热加载"(MITM/Fuzzer Tab 里的内联代码)。本页聚焦原生插件 + `cli` 参数体系: `cli.*` 调用会被
> Yakit 静态扫描成参数表单, 运行时把用户填的值注入回脚本。给出三个可运行案例: yak 原生插件用
> cli 收输入、mitm 原生插件被动扫描复杂内容、mitm + cli 交互式插件加载外部参数。所有示例
> `yak <file>` 自测通过。

## 0. 相关路由

- 总入口: [yak](../yak/SKILL.md)
- MITM 全部 hook 与去重语义(热加载视角, 但 hook 契约与原生 mitm 插件一致): [mitm-hotpatch](../mitm-hotpatch/SKILL.md)
- 右键 codec 插件 + cli 选择提取项: [yakit-rightclick-plugin](../yakit-rightclick-plugin/SKILL.md)
- 历史数据提取/字典/发包: [yakit-data-extract-plugin](../yakit-data-extract-plugin/SKILL.md)
- 数据库 / Payload 字典 / risk: [yaklang-database](../yaklang-database/SKILL.md)
- 验证工具链: [yaklang-toolchain](../yaklang-toolchain/SKILL.md)

## 1. 原生插件 vs 热加载(先分清)

| 维度 | 原生插件(本页) | 热加载(hot patch) |
| --- | --- | --- |
| 形态 | 保存为 YakScript, 有名字/类型/参数 | MITM/Fuzzer Tab 里的内联代码片段 |
| 参数 | 用 `cli.*` 定义, Yakit 渲染成表单 | 无独立表单, 直接改代码 |
| 入口 | 顶层语句直接执行(yak 类型); mitm 类型注册 hook | 注册 hook 函数 |
| 适合 | 给团队复用的"成品工具" | 临时改流量/快速试验 |
| 本库专题 | 本页 | [mitm-hotpatch](../mitm-hotpatch/SKILL.md) / [webfuzzer-hotpatch](../webfuzzer-hotpatch/SKILL.md) / [global-hotpatch](../global-hotpatch/SKILL.md) |

> 关键: **mitm 原生插件与 MITM 热加载用的是同一套 hook**(`hijackHTTPRequest` / `mirror*` /
> `hijackSaveHTTPFlow` ...), 契约见 [mitm-hotpatch](../mitm-hotpatch/SKILL.md)。区别只在于原生插件
> 可以叠加 `cli` 参数表单, 且作为成品被保存/分发。

## 2. cli 参数 -> Yakit 表单控件(核心对照表)

`cli.*` 全部写在 **顶层**(模块加载时执行), Yakit 才能静态扫描出参数。运行时引擎把用户填的值注入。

| cli 函数 | 返回类型 | Yakit 控件 | 说明 |
| --- | --- | --- | --- |
| `cli.String(name)` | string | 单行文本 | 最常用 |
| `cli.Text(name)` | string | 多行文本框 | 大段文本 |
| `cli.Int(name)` | int | 数字 | |
| `cli.Float(name)` | float | 数字 | |
| `cli.Bool(name)` | bool | 开关 | 存在即 true |
| `cli.Urls(name)` | []string | URL 列表 | 自动补 `http(s)://` |
| `cli.Ports(name)` | []int | 端口 | 支持 `80,443,8000-8010` |
| `cli.Hosts(name)` | []string | 网络目标 | 支持 CIDR 展开 |
| `cli.StringSlice(name)` | []string | 下拉/多选 | 配 `setSelectOption` 做下拉 |
| `cli.File(name)` | []byte | 文件 | 读文件内容 |
| `cli.FileOrContent(name)` | []byte | 文件或文本 | 文件读不到就当文本 |
| `cli.LineDict(name)` | []string | 文件或多行 | **按行**切分(非逗号) |
| `cli.YakitPlugin()` | []string | 插件选择 | 读 `yakit-plugin-file` |
| `cli.Json(name)` | map | 复杂表单 | 配 `setJsonSchema` |

选项函数(option, 作为后续参数传入):

| 选项 | 作用 |
| --- | --- |
| `cli.setRequired(true)` | 必填; 缺失时 `cli.check()` 打印帮助并退出 |
| `cli.setDefault(v)` | 默认值 |
| `cli.setVerboseName("中文名")` | 表单显示的中文标签 |
| `cli.setHelp("...")` | 帮助说明 |
| `cli.setCliGroup("分组名")` | 参数分组 |
| `cli.setSelectOption("显示名","值")` | 下拉选项(仅 `cli.StringSlice`) |
| `cli.setMultipleSelect(false)` | 是否多选(仅 `cli.StringSlice`) |

> 收尾必须调用 **`cli.check()`**: 校验必填项, 缺失则打印 Usage 并 `os.Exit(1)`。

```yak
target = cli.String("target", cli.setVerboseName("目标"), cli.setRequired(true))
ports  = cli.Ports("ports", cli.setDefault("80,443"))
mode   = cli.StringSlice("mode",
    cli.setSelectOption("快速", "fast"), cli.setSelectOption("深度", "deep"),
    cli.setMultipleSelect(false), cli.setDefault("fast"))
cli.check()
```

## 3. 三个优秀案例(examples/)

| 案例 | 文件 | 要点 |
| --- | --- | --- |
| yak 原生插件用 cli 收输入 | [examples/yak-cli-input.yak](examples/yak-cli-input.yak) | `cli.Urls/Ports/Int/Bool` + `cli.check()`; 核心逻辑抽纯函数便于自测 |
| mitm 原生插件被动扫描复杂内容 | [examples/mitm-passive-scan.yak](examples/mitm-passive-scan.yak) | `mirrorNewWebsitePathParams` 扫响应体里手机号/身份证/JWT/AKSK, 命中 `risk.NewRisk` |
| mitm + cli 交互式加载外部参数 | [examples/mitm-cli-interactive.yak](examples/mitm-cli-interactive.yak) | `cli.LineDict` 读外部关键词字典 + `cli.String` 限定作用域, hook 闭包捕获并驱动扫描 |

### 3.1 yak 原生插件 + cli(优秀案例 1)

yak 类型插件的入口就是 **顶层语句**(yak 不会自动调用 `func main()`)。真实插件顶层直接读 cli 参数并执行主流程:

```yak
func runPlugin() {
    targets = cli.Urls("target", cli.setRequired(true))
    ports = cli.Ports("ports", cli.setDefault("80,443"))
    cli.check()
    // ... 用参数做扫描/发包
}
runPlugin()   // 真实插件: 顶层直接调用
```

把核心逻辑(目标规整、去重)抽成 **纯函数**, 才能在 `YAK_MAIN` 自测块里脱离命令行/网络做可重复断言。

### 3.2 mitm 原生插件被动扫描(优秀案例 2)

mitm 插件不写 `main`, 而是 **注册 hook**。被动扫描首选 `mirrorNewWebsitePathParams`(按路径+参数结构去重, 省算力, 只读不影响转发):

```yak
mirrorNewWebsitePathParams = func(isHttps, url, req, rsp, body) {
    for f in scanSensitive(string(body)) {      // scanSensitive 是纯函数, 可自测
        risk.NewRisk(url, risk.title(...), risk.type("info-leak"),
            risk.severity("low"), risk.payload(f.value))
    }
}
```

- 规则表放顶层 **只读常量**(不要在并发 hook 里改全局, 会 data race)。
- 命中产出 `risk.NewRisk(...)`, 在 Yakit "风险与漏洞"面板可见。
- 自测只测 `scanSensitive` 纯逻辑, 不调用 `risk`(避免写库)。

### 3.3 mitm + cli 交互式(优秀案例 3)

同一个 mitm 插件, 用 cli 把"关键词字典""作用域"做成参数, 换目标不改代码:

```yak
KEYWORDS = cli.LineDict("keywords", cli.setDefault("password\ntoken\nsecret"))  // 顶层读取
SCOPE    = cli.String("scope", cli.setDefault(""))
cli.check()

mirrorHTTPFlow = func(isHttps, url, req, rsp, body) {   // 闭包捕获 KEYWORDS/SCOPE
    if !inScope(url, SCOPE) { return }
    for kw in matchKeywords(string(rsp), KEYWORDS) { risk.NewRisk(url, ...) }
}
```

> 协作要点: cli 在 **顶层加载一次**, hook 闭包在运行时反复复用这些值。`cli.LineDict` 按 **行** 切分,
> 想兼容 CSV 自己再 `str.Split(line, ",")` 摊平(见示例 `flattenKeywords`)。

## 4. 标准写法: 入口 + YAK_MAIN 自测

```yak
// yak 类型: 顶层执行; mitm 类型: 注册 hook + 顶层 cli
mirrorHTTPFlow = func(isHttps, url, req, rsp, body) { /* ... */ }

func runSelfTest() { /* 用纯函数 + mock 数据 + assert 验证 */ }

if YAK_MAIN {
    runSelfTest()
}
```

`YAK_MAIN` 是引擎注入的全局布尔:

- `yak xxx.yak` 命令行运行: `YAK_MAIN = true` -> 跑自测。
- Yakit 加载插件: 顶层 cli/hook 注册照常执行, 自测块按需守卫。

> 注意: `cli.Args()` 永远包含脚本文件名(长度 >= 1)。想区分"自测 / 真实带参运行"用
> `len(cli.Args()) > 1` 判断(见 `yak-cli-input.yak`)。

## 5. 验证

```bash
cd /Users/v1ll4n/Projects/yaklang
# 自测(走默认/纯逻辑)
yak skills/yakit-native-plugin/examples/yak-cli-input.yak
# 体验真实参数注入
yak skills/yakit-native-plugin/examples/yak-cli-input.yak --target "yaklang.com,example.com:8443" --ports 80,443 --probe
```

合格标准: 10 秒内完成、所有 `assert` 通过、`log` 全英文、末尾出现 `... self test passed`。
mitm 原生插件可进一步用 `yak hotpatch-mitm` 喂真实请求验证(见 [yaklang-toolchain](../yaklang-toolchain/SKILL.md))。

## 参考来源

- cli 参数体系: `yaklang/common/utils/cli/cli.go`(CliExports)
- mitm hook 契约: `yaklang/common/yak/hook_mixed_plugin_caller.go`
- risk API: `yaklang/common/yak/yaklib/risk.go`(`risk.NewRisk` / `risk.title` / `risk.severity` ...)
- 训练素材交叉引用: `yaklang-ai-training-materials/library-usage/cli`、`.../risk`
