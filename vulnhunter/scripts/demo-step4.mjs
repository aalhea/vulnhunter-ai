// 定向复验：只跑 ④（复用已有 2-subdomains.txt，验证域名过滤 + 探活闭环）。
import { join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
const ROOT = fileURLToPath(new URL('..', import.meta.url))
const main = await import(pathToFileURL(join(ROOT, 'dist', 'index.js')).href)
const registered = []
await main.apply(
  { tools: { register(d) { registered.push(d) } }, logger: { info() {}, warn() {}, error() {} } },
  {
    toolsDir: process.env.VULNHUNTER_TOOLS_DIR ?? '',
    artifactsRoot: join(ROOT, 'demo', 'artifacts'),
    scopeFile: join(ROOT, 'demo', 'scope.yaml'),
    defaultMode: 'ask', fofaEmail: '', fofaKey: '', shodanKey: '',
  },
)
const pipeline = registered.filter(d => d.name === 'recon_pipeline').at(-1)
const out = await pipeline.execute({ target: 'demo', steps: '4' })
console.log(out.statusMarkdown)
