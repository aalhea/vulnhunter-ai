// VulnHunter Console —— 零依赖本地指挥台（暗黑）。
// 运行：node scripts/console-server.mjs  → http://127.0.0.1:3095
// 数据源：demo/artifacts/<target>/state.json（recon_pipeline / ledger_* 的落盘产物）。
import { createServer } from 'node:http'
import { access, readdir, readFile, stat } from 'node:fs/promises'
import { join, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { connect } from 'node:net'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const ARTIFACTS = join(ROOT, 'demo', 'artifacts')
const SKILLS_DIR = join(ROOT, 'skills')
const TOOLS_DIR = process.env.VULNHUNTER_TOOLS_DIR ?? ''
const PORT = 3095

/** 环境自检：CLI 文件存在性 + TCP 端口连通 + key 配置。 */
async function envCheck() {
  const fileExists = async (p) => { try { await access(p); return true } catch { return false } }
  const portOpen = (port) => new Promise((resolve) => {
    const s = connect(port, '127.0.0.1')
    s.once('connect', () => { s.destroy(); resolve(true) })
    s.once('error', () => resolve(false))
    s.setTimeout(1200, () => { s.destroy(); resolve(false) })
  })
  const [enscan, amass, gogo, httpx] = await Promise.all(
    ['enscan', 'amass', 'gogo', 'httpx'].map(name => fileExists(join(TOOLS_DIR, name, `${name}.exe`))),
  )
  const [yakit, miniapp, dshWeb] = await Promise.all([11432, 4554, 3080].map(portOpen))
  return {
    tools: [
      { name: 'enscan', ok: enscan, path: `${TOOLS_DIR}/enscan/enscan.exe` },
      { name: 'amass', ok: amass, path: `${TOOLS_DIR}/amass/amass.exe` },
      { name: 'gogo', ok: gogo, path: `${TOOLS_DIR}/gogo/gogo.exe` },
      { name: 'httpx', ok: httpx, path: `${TOOLS_DIR}/httpx/httpx.exe` },
    ],
    services: [
      { name: 'dsh web', ok: dshWeb, note: '127.0.0.1:3080' },
      { name: 'yakit mcp', ok: yakit, note: '127.0.0.1:11432/sse' },
      { name: 'first-miniapp mcp', ok: miniapp, note: '127.0.0.1:4554/sse' },
    ],
    keys: {
      fofa: Boolean(process.env.FOFA_KEY),
      shodan: Boolean(process.env.SHODAN_KEY),
      deepseek: Boolean(process.env.DEEEPSEEK_API_KEY ?? process.env.DEEPSEEK_API_KEY),
    },
  }
}

const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)) }

async function listTargets() {
  try {
    const entries = await readdir(ARTIFACTS, { withFileTypes: true })
    const out = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const statePath = join(ARTIFACTS, entry.name, 'state.json')
      try {
        const state = JSON.parse(await readFile(statePath, 'utf8'))
        out.push({
          target: entry.name,
          ledger: state.ledger?.length ?? 0,
          confirmed: state.ledger?.filter(i => i.status === '已证实').length ?? 0,
          runs: state.runs?.length ?? 0,
          lastRun: state.runs?.at(-1)?.startedAt ?? '',
        })
      } catch { /* 无 state.json 的目录跳过 */ }
    }
    return out
  } catch { return [] }
}

async function skillList() {
  try {
    const dirs = await readdir(SKILLS_DIR, { withFileTypes: true })
    return dirs.filter(d => d.isDirectory()).map(d => d.name)
  } catch { return [] }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`)
  if (url.pathname === '/api/targets') return json(res, 200, await listTargets())
  if (url.pathname === '/api/skills') return json(res, 200, await skillList())
  if (url.pathname === '/api/env') return json(res, 200, await envCheck())
  if (url.pathname === '/api/state') {
    const target = url.searchParams.get('target') ?? ''
    const safe = target.replace(/[^A-Za-z0-9_-]/g, '_')
    try {
      const state = JSON.parse(await readFile(join(ARTIFACTS, safe, 'state.json'), 'utf8'))
      return json(res, 200, state)
    } catch { return json(res, 404, { error: 'target not found' }) }
  }
  if (url.pathname === '/api/artifacts') {
    const target = (url.searchParams.get('target') ?? '').replace(/[^A-Za-z0-9_-]/g, '_')
    const dir = join(ARTIFACTS, target)
    const out = []
    async function walk(current, rel) {
      for (const entry of await readdir(current, { withFileTypes: true })) {
        const full = join(current, entry.name)
        const r = rel === '' ? entry.name : `${rel}/${entry.name}`
        if (entry.isDirectory()) await walk(full, r)
        else out.push({ file: r, size: (await stat(full)).size })
      }
    }
    try { await walk(dir, '') } catch { /* 目录不存在 */ }
    return json(res, 200, out)
  }

  // ---- 单页 UI（暗黑 · 拓扑 · 三模式 · 面板）----
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  res.end(`<!doctype html>
<html lang="zh"><head><meta charset="utf-8">
<title>VulnHunter Console</title>
<link rel="icon" type="image/svg+xml" href="http://127.0.0.1:3080/favicon.svg">
<style>
:root{--bg:#070a0f;--panel:rgba(17,22,29,.72);--line:rgba(148,163,184,.14);--amber:#f59e0b;--amber2:#fbbf24;--txt:#e5e7eb;--dim:#8b95a5;--red:#ef4444;--green:#34d399}
*{box-sizing:border-box}
body{margin:0;color:var(--txt);font-family:'Segoe UI',system-ui,-apple-system,sans-serif;background:var(--bg)}
body::before{content:'';position:fixed;inset:0;background:
 radial-gradient(600px 300px at 85% -10%,rgba(245,158,11,.12),transparent 60%),
 radial-gradient(500px 400px at -10% 110%,rgba(239,68,68,.07),transparent 60%),
 linear-gradient(rgba(148,163,184,.04) 1px,transparent 1px),
 linear-gradient(90deg,rgba(148,163,184,.04) 1px,transparent 1px);
 background-size:auto,auto,26px 26px,26px 26px;pointer-events:none;z-index:0}
header,main{position:relative;z-index:1}
header{display:flex;align-items:center;gap:14px;padding:16px 24px;border-bottom:1px solid var(--line);background:rgba(11,15,20,.6);backdrop-filter:blur(10px);position:relative;z-index:2}
header svg{filter:drop-shadow(0 0 10px rgba(245,158,11,.45))}
header h1{font-size:19px;margin:0;letter-spacing:2px;font-weight:800;
 background:linear-gradient(92deg,var(--amber),#fde68a 55%,var(--amber));-webkit-background-clip:text;background-clip:text;color:transparent}
header h1 span{background:none;-webkit-background-clip:initial;color:var(--txt);font-weight:300}
header small{color:var(--dim);font-weight:400;margin-left:6px}
main{display:grid;grid-template-columns:300px 1fr;gap:18px;padding:18px 24px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:16px;backdrop-filter:blur(8px);box-shadow:0 8px 28px rgba(0,0,0,.35)}
h2{font-size:11px;color:var(--dim);margin:0 0 12px;text-transform:uppercase;letter-spacing:2px;font-weight:700}
h2::before{content:'▮ ';color:var(--amber)}
.modes{display:flex;flex-direction:column;gap:12px}
.mode{cursor:pointer;border:1px solid var(--line);border-radius:12px;padding:13px 14px;position:relative;overflow:hidden;transition:.18s;background:linear-gradient(135deg,rgba(245,158,11,.06),transparent 40%)}
.mode::after{content:'';position:absolute;left:0;top:0;bottom:0;width:3px;background:linear-gradient(var(--amber),transparent);opacity:.5;transition:.18s}
.mode:hover{border-color:rgba(245,158,11,.55);transform:translateX(3px) translateY(-1px);box-shadow:0 6px 20px rgba(245,158,11,.12)}
.mode:hover::after{opacity:1}
.mode b{color:var(--amber);font-size:13px}.mode p{margin:5px 0 0;font-size:12px;color:var(--dim);line-height:1.5}
table{width:100%;border-collapse:collapse;font-size:12px}
th{color:var(--dim);text-align:left;border-bottom:1px solid var(--line);padding:7px 6px;font-weight:600;letter-spacing:.5px}
td{padding:7px 6px;border-bottom:1px solid rgba(148,163,184,.08)}
tbody:hover td,tr:hover td{background:rgba(245,158,11,.04)}
.tag{padding:2px 9px;border-radius:99px;font-size:11px;font-weight:600}
.ok{background:rgba(52,211,153,.12);color:var(--green);border:1px solid rgba(52,211,153,.3)}
.err{background:rgba(239,68,68,.12);color:var(--red);border:1px solid rgba(239,68,68,.3)}
.sev{background:rgba(245,158,11,.1);color:var(--amber);border:1px solid rgba(245,158,11,.3)}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:18px}
pre{background:rgba(7,10,15,.7);border:1px solid var(--line);border-radius:10px;padding:12px;font-size:11px;line-height:1.7;overflow:auto;max-height:230px;color:#cbd5e1}
.topo text{fill:var(--dim);font-size:11px}.topo .node rect{fill:rgba(17,22,29,.9);stroke:var(--line);stroke-width:1.5;transition:.2s}
.topo .node{cursor:grab}.topo .node.drag{cursor:grabbing}
.topo .node:hover rect{stroke:rgba(245,158,11,.6);filter:drop-shadow(0 0 8px rgba(245,158,11,.35))}
.topo .node.done rect{stroke:var(--green);filter:drop-shadow(0 0 7px rgba(52,211,153,.35))}
.topo .node.fail rect{stroke:var(--red);filter:drop-shadow(0 0 7px rgba(239,68,68,.4))}
.topo .node.sel rect{stroke:var(--amber);stroke-width:2.5;filter:drop-shadow(0 0 12px rgba(245,158,11,.55))}
.topo .edge path{stroke:rgba(245,158,11,.75);stroke-dasharray:7 6;animation:dash 1s linear infinite}
@keyframes dash{to{stroke-dashoffset:-13}}
.topo .node text:first-child{fill:var(--txt)}
select,input{background:rgba(7,10,15,.8);color:var(--txt);border:1px solid var(--line);border-radius:8px;padding:7px 10px;outline:none}
select:focus,input:focus{border-color:rgba(245,158,11,.5)}
input[type=checkbox]{accent-color:var(--amber);width:14px;height:14px;cursor:pointer}
a{color:var(--amber);text-decoration:none}a:hover{text-decoration:underline}
button{font-family:inherit}
#nodeInfo{margin-top:10px;font-size:12px;background:rgba(7,10,15,.7);border:1px solid var(--line);border-radius:10px;padding:10px 12px;min-height:38px;line-height:1.6}
</style></head><body>
<header>
<svg width="34" height="34" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#0b0f14"/><circle cx="32" cy="32" r="17" fill="none" stroke="#f59e0b" stroke-width="3.5"/><circle cx="32" cy="32" r="4.5" fill="#f59e0b"/><path d="M32 6v12M32 46v12M6 32h12M46 32h12" stroke="#f59e0b" stroke-width="3.5" stroke-linecap="round"/></svg>
<h1>VULN<span>HUNTER</span> <small>console · DeepSeek Harness Edition</small></h1>
<select id="targetSel" onchange="loadState()"><option>加载中…</option></select>
<a href="http://127.0.0.1:3080" target="_blank">→ 打开 Agent 会话</a>
</header>
<main>
<div class="modes card"><h2>作战模式（预设）</h2>
<div class="mode" onclick="go('vulnhunter-recon')"><b>① 信息收集</b><p>enscan→amass+fofa/shodan→gogo→httpx 五步流水线，任意选段断点续跑</p></div>
<div class="mode" onclick="go('vulnhunter-web')"><b>② Web 渗透</b><p>威胁建模+认证攻击面，yakit/chrome MCP 联动，三态账本质量门</p></div>
<div class="mode" onclick="go('vulnhunter-miniapp')"><b>③ 小程序挖掘</b><p>vh-jss 反编译静态分析 + first-miniapp 动态调试双链路</p></div>
<div class="mode" onclick="go('vulnhunter')"><b>▸ 完整模式</b><p>全量 persona v3.0-dsh（侦察+渗透+记忆一体）</p></div>
<h2 style="margin-top:14px">Skills（26）</h2><pre id="skills">…</pre>
<h2 style="margin-top:14px">MCP 槽位</h2><pre>yakit     sse  127.0.0.1:11432/sse   抓包/重放/热补丁
chrome    stdio npx chrome-devtools-mcp  浏览器自动化
first-miniapp sse 127.0.0.1:4554/sse   小程序动态调试</pre>
<h2 style="margin-top:14px">环境自检 <button onclick="loadEnv()" style="background:none;border:1px solid var(--line);color:var(--dim);border-radius:6px;cursor:pointer">刷新</button></h2>
<div id="env" style="font-size:12px">检测中…</div>
<h2 style="margin-top:14px">自定义命令模板</h2><pre id="cmds">在 dev.patch.yml 的 vulnhunter.config.toolCommands 配置：
enscan: 'exe -company {company} -o {output}'
amass:  'subfinder -d {domain}'
gogo:   'gogo -i {targets} -p {ports} --af {output}'
httpx:  'httpx -l {input} -json -o {output}'</pre>
</div>
<div>
<div class="card"><h2>侦察流水线拓扑</h2>
<svg class="topo" width="100%" height="120" viewBox="0 0 900 110" preserveAspectRatio="xMidYMid meet">
<defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto"><path d="M0,0 L7,3 L0,6" fill="var(--amber)"/></marker></defs>
<g class="edge"><path d="M150 55 H210"/><path d="M330 55 H390"/><path d="M510 55 H570"/><path d="M690 55 H750"/></g>
<g class="node" id="n1"><rect x="30" y="30" width="120" height="50" rx="8"/><text x="52" y="52">① enscan 测绘</text><text x="52" y="68" class="s"></text></g>
<g class="node" id="n2"><rect x="215" y="30" width="115" height="50" rx="8"/><text x="237" y="52">② amass+情报</text><text x="237" y="68"></text></g>
<g class="node" id="n3"><rect x="395" y="30" width="115" height="50" rx="8"/><text x="420" y="52">③ gogo 端口</text><text x="420" y="68"></text></g>
<g class="node" id="n4"><rect x="575" y="30" width="115" height="50" rx="8"/><text x="600" y="52">④ httpx 探活</text><text x="600" y="68">url-build 合并</text></g>
<g class="node" id="n5"><rect x="755" y="30" width="115" height="50" rx="8"/><text x="782" y="52">⑤ report</text><text x="782" y="68"></text></g>
</svg><div id="nodeInfo">提示：拖拽节点重排 · 点击节点查看该步骤最近一次运行详情。</div></div>
<div class="grid2">
<div class="card"><h2>攻击面账本</h2><table id="ledger"><tr><th>ID</th><th>攻击面</th><th>状态</th><th>严重性</th><th>证据</th></tr></table></div>
<div class="card"><h2>流水线运行记录</h2><table id="runs"><tr><th>seq</th><th>步骤</th><th>状态</th><th>耗时</th><th>摘要</th></tr></table></div>
</div>
<div class="grid2">
<div class="card"><h2>Artifacts</h2><table id="arts"><tr><th>文件</th><th>大小</th></tr></table></div>
<div class="card"><h2>使用提示</h2><pre>会话内可用：
recon_pipeline steps:"1,2,4"  选段执行
ledger_add / ledger_update    三态账本
vuln_report                   生成报告
toolCommands                  自定义每步命令
scope.yaml                    授权边界（护栏强制）
长扫描建议让 agent 用 jobs 后台跑。</pre></div>
</div>
</div></main>
<script>
function go(preset){window.open('http://127.0.0.1:3080?preset='+preset,'_blank')}
async function j(url){return (await fetch(url)).json()}
async function loadTargets(){const ts=await j('/api/targets');const sel=document.getElementById('targetSel');sel.innerHTML=ts.length?ts.map(t=>'<option>'+t.target+'</option>').join(''):'<option value="">暂无目标（先跑 recon_pipeline）</option>';if(ts[0])loadState();else render(null)}
async function loadState(){const t=document.getElementById('targetSel').value;if(!t)return render(null);render(await j('/api/state?target='+t))}
let lastRuns=[]
function markTopo(runs){var ids=['n1','n2','n3','n4','n5'];var i;for(i=0;i<ids.length;i++){var el=document.getElementById(ids[i]);if(el)el.classList.remove('done','fail')}
 var bySeq={};(runs||[]).forEach(function(r){bySeq[String(r.seq)]=r.state})
 Object.keys(bySeq).forEach(function(s){var el=document.getElementById('n'+s);if(el)el.classList.add(bySeq[s]==='ok'?'done':'fail')})}
function render(state){const L=document.getElementById('ledger');const R=document.getElementById('runs');
 L.innerHTML='<tr><th>ID</th><th>攻击面</th><th>状态</th><th>严重性</th><th>证据</th></tr>'
 R.innerHTML='<tr><th>seq</th><th>步骤</th><th>状态</th><th>耗时</th><th>摘要</th></tr>'
 if(!state)return
 ;(state.ledger||[]).forEach(i=>{L.innerHTML+='<tr><td>'+i.id+'</td><td>'+i.surface+'</td><td>'+i.status+'</td><td><span class="tag sev">'+i.severity+'</span></td><td>'+(i.evidence||'-')+'</td></tr>'})
 lastRuns=(state.runs||[]).slice(-5)
 ;(state.runs||[]).slice(-8).reverse().forEach(r=>{R.innerHTML+='<tr><td>'+r.seq+'</td><td>'+r.stepId+'</td><td><span class="tag '+(r.state==='ok'?'ok':'err')+'">'+r.state+'</span></td><td>'+r.durationMs+'ms</td><td>'+(r.summary||'').replace(/</g,'&lt;').slice(0,80)+'</td></tr>'})
 markTopo(lastRuns)
 fetch('/api/artifacts?target='+state.target).then(r=>r.json()).then(a=>{const A=document.getElementById('arts');A.innerHTML='<tr><th>文件</th><th>大小</th></tr>';a.forEach(f=>{A.innerHTML+='<tr><td>'+f.file+'</td><td>'+(f.size/1024).toFixed(1)+'KB</td></tr>'})})}
;loadTargets()
</script></body></html>`)
})

server.listen(PORT, () => console.log(`[VulnHunter Console] http://127.0.0.1:${PORT}`))
