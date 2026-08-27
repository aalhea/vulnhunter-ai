import { writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
const text = await (await fetch('http://127.0.0.1:3095/')).text()
const code = text.match(/<script>([\s\S]*?)<\/script>/)[1]
const f = 'd:/codeproject/agent/dsh-vulnhunter/.smoke-tmp/blk.js'
writeFileSync(f, code)
try {
  execFileSync('node', ['--check', f])
  console.log('[ok] browser block compiles')
} catch (e) {
  console.log(String(e.stderr ?? e))
}
