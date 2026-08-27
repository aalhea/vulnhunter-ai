// 功能冒烟测试：工具注册、账本三态、质量门、scope 护栏（经 pipeline）、报告生成。
// 运行：node scripts/smoke.mjs
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const dist = (name) => pathToFileURL(join(ROOT, 'dist', name)).href
const TMP = join(ROOT, '.smoke-tmp')

// 每轮从干净状态开始：账本 ID 断言依赖空账本。
await rm(TMP, { recursive: true, force: true })

const main = await import(dist('index.js'))
const bridge = await import(dist('mcp-sse-bridge.js'))
assert.equal(main.name, 'vulnhunter')
assert.equal(bridge.name, 'mcp-sse-bridge')
console.log('[ok] 两个产物模块可加载')

const registered = []
const fakeCtx = {
  tools: { register(def) { registered.push(def) } },
  logger: { info() {}, warn() {}, error() {} },
}
await main.apply(fakeCtx, {
  toolsDir: '', artifactsRoot: join(TMP, 'artifacts'), scopeFile: '',
  defaultMode: 'ask', fofaEmail: '', fofaKey: '', shodanKey: '',
})
assert.equal(registered.length, 11, `注册数应为 11，实际 ${registered.length}`)
console.log('[ok] 注册 11 个工具:', registered.map(d => d.name).join(', '))

// ---- 账本三态 + 质量门 ----
const byName = Object.fromEntries(registered.map(def => [def.name, def]))
const add = await byName.ledger_add.execute({ target: 'smoke', surface: 'http://demo/api/id', type: '越权', severity: 'high' })
assert.match(add.id, /^L001/)
await assert.rejects(
  () => byName.ledger_update.execute({ target: 'smoke', id: add.id, status: '已证实' }),
  /质量门/,
)
console.log('[ok] 质量门拦截无证据的「已证实」')
await byName.ledger_update.execute({ target: 'smoke', id: add.id, status: '已证实', evidence: 'artifacts/smoke/poc.md' })
const state = await byName.ledger_state.execute({ target: 'smoke' })
assert.match(state.ledgerMarkdown, /L001/)
const report = await byName.vuln_report.execute({ target: 'smoke', title: '冒烟报告' })
assert.equal(report.confirmedCount, 1)
assert.ok(report.reportPath.endsWith('.md'))
console.log('[ok] 账本三态 + 报告生成 →', report.reportPath)

// ---- scope 护栏（经 recon_pipeline 的 gogo 步骤）----
await mkdir(TMP, { recursive: true })
const scopeFile = join(TMP, 'scope.yaml')
await writeFile(
  scopeFile,
  'target: t\ndomains:\n  - example.com\nexcludes:\n  - mail.example.com\ncidr:\n  - 192.168.1.0/24\nrules:\n  passive_first: true\n',
)
await main.apply(fakeCtx, {
  toolsDir: '', artifactsRoot: join(TMP, 'scoped'), scopeFile,
  defaultMode: 'ask', fofaEmail: '', fofaKey: '', shodanKey: '',
})
const scopedPipeline = registered.filter(d => d.name === 'recon_pipeline').at(-1)
const out = await scopedPipeline.execute({ target: 'guardtest', steps: '3', cidrs: ['10.0.0.0/24'] })
assert.match(out.statusMarkdown, /护栏拦截/)
console.log('[ok] CIDR 出界被护栏拒绝（fail-fast 终止）')

// 选段缺依赖 → 明确提示
const missing = await byName.recon_pipeline.execute({ target: 'smoke', steps: '2' })
assert.match(missing.statusMarkdown, /需要 --domain/)
console.log('[ok] 选段缺依赖提示明确')

// 状态表渲染
const st = await byName.recon_status.execute({ target: 'smoke' })
assert.match(st.statusMarkdown, /流水线状态/)
console.log('[ok] recon_status 渲染正常')

console.log('\nALL SMOKE TESTS PASSED')
