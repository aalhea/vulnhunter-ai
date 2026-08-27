import { readFileSync, writeFileSync } from 'node:fs'
const p = 'd:/codeproject/agent/dsh-vulnhunter/scripts/console-server.mjs'
let c = readFileSync(p, 'utf8')
c = c.replace(/\)\+'>>/g, ")+'></td>")
const i1 = c.indexOf('(function(){var svg')
if (i1 >= 0) {
  const i2 = c.indexOf('loadTargets()', i1)
  if (i2 >= 0) c = c.slice(0, i1) + c.slice(i2)
}
writeFileSync(p, c)
console.log('[ok] cleaned')
