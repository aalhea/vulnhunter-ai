// 第一轮实测 A 段（无 LLM）：对授权目标 example.com 直驱流水线全链路。
// 运行：node scripts/demo.mjs
import { join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const dist = (name) => pathToFileURL(join(ROOT, 'dist', name)).href

const main = await import(dist('index.js'))
const registered = []
const ctx = {
  tools: { register(def) { registered.push(def) } },
  logger: { info(...a) { console.log('[plugin]', ...a) }, warn() {}, error() {} },
}
await main.apply(ctx, {
  toolsDir: process.env.VULNHUNTER_TOOLS_DIR ?? '',
  artifactsRoot: join(ROOT, 'demo', 'artifacts'),
  scopeFile: join(ROOT, 'demo', 'scope.yaml'),
  defaultMode: 'ask',
  fofaEmail: process.env.FOFA_EMAIL ?? '',
  fofaKey: process.env.FOFA_KEY ?? '',
  shodanKey: process.env.SHODAN_KEY ?? '',
})
const byName = Object.fromEntries(registered.map(d => [d.name, d]))
const md = (t) => console.log(`\n========== ${t} ==========`)

md('① 初始状态（应为空表）')
console.log((await byName.recon_status.execute({ target: 'demo' })).statusMarkdown)

md('② 负面用例：未授权网段应被护栏拦截')
const bad = await byName.recon_pipeline.execute({ target: 'demo', steps: '3', cidrs: ['93.184.216.34/32'] })
console.log(bad.statusMarkdown)

md('③ 正面：② 子域枚举（amass 被动 + 情报无 key 自动降级）')
const s2 = await byName.recon_pipeline.execute({ target: 'demo', steps: '2', domain: 'example.com' })
console.log(s2.statusMarkdown)

md('④ 正面：④ 存活探测（url-build 合并 → httpx 探测 example.com）')
const s4 = await byName.recon_pipeline.execute({ target: 'demo', steps: '4' })
console.log(s4.statusMarkdown)

md('⑤ 账本闭环：入账 → 无证据转证实被拦 → 补证据 → 报告')
const add = await byName.ledger_add.execute({ target: 'demo', surface: 'https://example.com/', type: '信息泄露', severity: 'low', status: '已证实', evidence: 'demo/artifacts/demo/4-alive.json' })
console.log('入账:', add.id)
const report = await byName.vuln_report.execute({ target: 'demo', title: '第一轮实测报告', assets: ['https://example.com/'] })
console.log('报告:', report.reportPath, `已证实 ${report.confirmedCount} 条`)

md('⑥ 最终状态')
console.log((await byName.recon_status.execute({ target: 'demo' })).statusMarkdown)
console.log('\nDEMO DONE — 产物在 demo/artifacts/demo/')
