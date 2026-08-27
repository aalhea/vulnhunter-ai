---
name: vh-yak-db
description: >-
  Yaklang 数据库操作 (db 库) 专题。当用户需要在脚本/插件里持久化或查询数据时使用：临时 SQLite 建表与增删改查 (db.OpenTempSqliteDatabase / db.ScanResult / Exec)、跨脚本共享配置的键值存储 (db.SetKey/GetKey/DelKey/SetKeyWithTTL)、爆破字典统一管理 (db.SavePayload/YieldPayload)、以及项目级配置 (db.SetProjectKey/GetProjectKey)。
---

# SKILL: Yaklang 数据库操作 (db 库)

> AI LOAD INSTRUCTION: `db` 库是 Yaklang 的数据库核心模块，提供 SQLite/MySQL 连接、SQL 查询、键值存储、Payload 字典管理等能力。本页给出可直接运行的示例与几个真实 API 形态约定（见第 4 节"坑"）。两个示例都可 `yak <file>` 自测通过。写数据库相关 Yaklang 时优先参考这里。

## 0. 相关路由

- 总入口：[yak](../yak/SKILL.md)
- 基础语法（错误处理 `~`、map、for）：[yaklang-syntax](../yaklang-syntax/SKILL.md)

## 1. 临时 SQLite：建表 / 增删改查 / 聚合

适合在脚本里临时落地结构化数据（扫描结果、资产、中间表），用 SQL 做查询统计。

```yak
tempDB = db.OpenTempSqliteDatabase()~          // 返回 (gormDB, err), 用 ~ 处理

// 写操作: tempDB.Exec(sql, args...).Error 是字段(不是函数, 不能用 ~)
err = tempDB.Exec("CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT, price INTEGER)").Error
assert err == nil, "create failed"
tempDB.Exec("INSERT INTO products (name, price) VALUES (?, ?)", "laptop", 8000)  // ? 参数化防注入

// 读操作: db.ScanResult 返回 []map, 每行是一个 map
rows = db.ScanResult(tempDB, "SELECT * FROM products WHERE price > ? ORDER BY price DESC", 100)~
for row in rows {
    log.info("%v -> %v", row["name"], row["price"])
}
```

完整示例：[examples/sqlite-crud.yak](examples/sqlite-crud.yak)

## 2. 键值存储 (KV)：跨脚本共享状态

写入的是 Yakit profile 数据库（持久化），适合插件/脚本之间共享配置与中间状态。

```yak
db.SetKey("my-key", "my-value")          // 写 (重复调用即覆盖)
v = db.GetKey("my-key")                   // 读, 不存在返回 ""
db.SetKeyWithTTL("tmp", "v", 60)          // 带过期 (秒)
db.DelKey("my-key")                        // 删

// 项目级配置 (随项目切换), 与全局 KV 区分
db.SetProjectKey("conf", json.dumps({"a":1}))
cfg = db.GetProjectKey("conf")
```

## 3. Payload 字典管理：把爆破字典交给 Yakit 统一管理

```yak
db.SavePayload("my-users", ["admin", "root", "guest"])~   // 存入字典组

for content in db.YieldPayload("my-users") {              // 迭代器, 逐条产出内容字符串
    log.info("payload: %s", content)
}

groups = db.GetAllPayloadGroupsName()                     // 列出所有字典组名
db.DeletePayloadByGroup("my-users")                       // 删除整组
```

完整示例（KV + Payload，带清理）：[examples/kv-and-payload.yak](examples/kv-and-payload.yak)

## 4. 真实 API 形态约定（写之前必读）

| 约定 | 错误写法 | 正确写法 |
|---|---|---|
| `.Exec(...).Error` 是字段不是函数 | `tempDB.Exec(sql).Error~` | `err = tempDB.Exec(sql).Error; assert err == nil` |
| `db.OpenTempSqliteDatabase()` 返回 (db, err) | `tempDB = db.OpenTempSqliteDatabase()` | `tempDB = db.OpenTempSqliteDatabase()~` |
| `db.YieldPayload` 产出内容字符串, 不是对象 | `for p in db.YieldPayload(g) { p.Content }` | `for content in db.YieldPayload(g) { ... }` |
| `db.GetKey` 不存在时返回空串而非 nil | `if db.GetKey(k) == nil` | `if db.GetKey(k) == ""` |
| KV / Payload 是持久化写入 | 自测用固定脏数据 | 用唯一前缀 key/group 并在结尾清理 |

> 不确定某方法时，用 `desc(db)` 或 `desc(tempDB)` 在脚本里查看可用方法。以认真查阅为荣，以暗猜接口为耻。

## 5. 常用 API 速查

| 用途 | API |
|---|---|
| 打开临时 SQLite | `db.OpenTempSqliteDatabase()~` |
| 执行 SQL（写） | `tempDB.Exec(sql, args...).Error` |
| 查询返回 []map | `db.ScanResult(tempDB, sql, args...)~` |
| 键值读写删 | `db.SetKey` / `db.GetKey` / `db.DelKey` / `db.SetKeyWithTTL` |
| 项目级配置 | `db.SetProjectKey` / `db.GetProjectKey` |
| Payload 字典 | `db.SavePayload` / `db.YieldPayload` / `db.GetAllPayloadGroupsName` / `db.DeletePayloadByGroup` |

## 6. 验证

```bash
cd /Users/v1ll4n/Projects/yaklang
go run common/yak/cmd/yak.go skills/yaklang-database/examples/sqlite-crud.yak
go run common/yak/cmd/yak.go skills/yaklang-database/examples/kv-and-payload.yak
```

每个示例应：assert 全过、log 全英文、出现 `... self test passed`。

## 参考来源

- yaklang-ai-training-materials library-usage/db/db-practice.yak
- yaklang-ai-training-materials library-usage/yakit-db/yakit-db-practice.yak
- 库导出：`common/yak/script_engine.go`
