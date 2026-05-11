#!/usr/bin/env node
// CmdClick — Live Visual Test Dashboard
// Starts a local server, opens dashboard in browser, tests ALL references.
// Each test: opens call site in VS Code → opens definition → updates dashboard live.

const fs = require('fs');
const path = require('path');
const http = require('http');
const { execSync } = require('child_process');

const { Index } = require('./dist/index/Index');
const { MoleculerParser } = require('./dist/parser/moleculer/MoleculerParser');
const { Scanner } = require('./dist/scanner/Scanner');
const { detect, CursorKind } = require('./dist/lsp/Cursor');

const PORT = 3847;
const args = process.argv.slice(2);
const DELAY = args.includes('--fast') ? 80 : 300;
const VSCODE = !args.includes('--no-vscode');

// ── Configure the target repo ────────────────────────────────────────────────
// Set ROOT to the `src/` directory of any MoleculerJS project you want to test.
// Options (in priority order):
//   1. CLI arg:  node visual-test.js --root=/path/to/your/project/src
//   2. Env var:  CW_ROOT=/path/to/your/project/src node visual-test.js
const rootArg = args.find(a => a.startsWith('--root'));
let ROOT = process.env.CW_ROOT ?? '';
if (rootArg) {
  ROOT = rootArg.includes('=') ? rootArg.split('=')[1] : args[args.indexOf(rootArg) + 1];
}
if (!ROOT) { console.error('ERROR: Set --root=/path/to/src or CW_ROOT env var'); process.exit(1); }

console.log(`🎯 Target: ${ROOT}`);

// ── Index ──
console.log('⏳ Building index...');
const idx = new Index();
const sc = new Scanner([new MoleculerParser()], idx);
sc.scan(ROOT);
const pool = idx.stringPool();
const stats = idx.stats();
console.log(`✓ ${stats.symbolCount} symbols, ${stats.referenceCount} refs`);

// Resolution helpers
function shortName(fn) { const d = fn.lastIndexOf('.'); return d < 0 ? fn : fn.slice(d+1); }
function findBestByName(name) {
  for (const s of idx.prefixSearch('')) { if (s.name === name && !s.namespace.startsWith('__mixin_')) return s; }
  for (const s of idx.prefixSearch('')) { if (s.name === name) return s; }
  return undefined;
}
function findClassByName(name) {
  for (const s of idx.prefixSearch('')) {
    if (s.name !== name) continue;
    const f = pool.get(s.sourceFileId || s.fileId);
    if (!f.endsWith('.service.js') && !f.endsWith('.mixin.js') && !f.endsWith('.mixins.js')) return s;
  }
  return undefined;
}
function findEventByRaw(raw) {
  for (const s of idx.prefixSearch('')) { if (s.kind === 'event' && s.name === raw) return s; }
  return undefined;
}
function getNamespace(fp) {
  const fid = pool.intern(fp);
  const syms = idx.symbolsByFile(fid);
  return syms.length > 0 ? (syms[0].namespace || '') : '';
}

// ── Collect ALL test pairs upfront ──
console.log('⏳ Preparing tests...');
const allTests = [];
const allSymbols = idx.prefixSearch('');

for (const sym of allSymbols) {
  const refs = idx.findReferences(sym.fullName);
  for (const ref of refs) {
    const filePath = pool.get(ref.fileId);
    let content;
    try { content = fs.readFileSync(filePath); } catch { continue; }
    const lines = content.toString().split('\n');
    const lineText = (lines[ref.line] || '').trim();
    const ns = getNamespace(filePath);

    let ctx = detect(content, ref.line, ref.column, ns);
    if (ctx.kind === CursorKind.Unknown) {
      const nameIdx = (lines[ref.line] || '').indexOf(sym.name);
      if (nameIdx >= 0) ctx = detect(content, ref.line, nameIdx, ns);
    }

    let resolved = null;
    let resolveMethod = '';
    if (ctx.kind !== CursorKind.Unknown) {
      if (ctx.rawString) { const ev = findEventByRaw(ctx.rawString); if (ev) { resolved = ev; resolveMethod = 'event'; } }
      if (!resolved && ctx.kind === CursorKind.ServiceName) { resolveMethod = 'service'; }
      else if (!resolved) {
        const name = shortName(ctx.fullName);
        if (ctx.isChained) { resolved = findClassByName(name) || findBestByName(name); resolveMethod = 'chained'; }
        else { resolved = idx.lookup(ctx.fullName); resolveMethod = resolved ? 'exact' : 'fuzzy'; if (!resolved) resolved = findBestByName(name); }
      }
    }

    let status = 'skip';
    if (resolveMethod === 'service') status = 'pass';
    else if (resolved && resolved.fullName === sym.fullName) status = 'pass';
    else if (resolved && resolved.name === sym.name) status = 'partial';
    else if (resolved) status = 'fail';
    else if (ctx.kind !== CursorKind.Unknown) status = 'fail';

    const defFile = resolved ? pool.get(resolved.sourceFileId || resolved.fileId) : '';

    allTests.push({
      symbol: sym.fullName,
      symbolName: sym.name,
      symbolKind: sym.kind,
      refFile: filePath,
      refFileShort: filePath.replace(ROOT + '/', ''),
      refLine: ref.line + 1,
      refCol: ref.column + 1,
      lineText: lineText.slice(0, 120),
      cursorKind: ctx.kind,
      resolveMethod,
      resolvedSymbol: resolved ? resolved.fullName : '',
      defFile,
      defFileShort: defFile ? defFile.replace(ROOT + '/', '') : '',
      defLine: resolved ? resolved.line + 1 : 0,
      defCol: resolved ? resolved.column + 1 : 0,
      status,
    });
  }
}

console.log(`✓ ${allTests.length} tests prepared`);

// ── SSE clients ──
const sseClients = new Set();

function broadcast(data) {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    try { res.write(msg); } catch { sseClients.delete(res); }
  }
}

// ── HTML Dashboard ──
const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>CmdClick Live Test</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap');
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',sans-serif;background:#0a0a14;color:#d0d0e0;overflow-x:hidden}
.top{background:linear-gradient(135deg,#0f0f2a,#1a1040,#0d1b3e);padding:24px 32px;border-bottom:1px solid #222;position:sticky;top:0;z-index:100}
.top h1{font-size:22px;font-weight:800;background:linear-gradient(90deg,#60a5fa,#a78bfa,#f472b6);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.top .sub{color:#666;font-size:12px;margin-top:2px}
.stats{display:flex;gap:16px;margin-top:14px;flex-wrap:wrap}
.stat{background:rgba(255,255,255,0.04);border:1px solid #222;border-radius:10px;padding:10px 18px;min-width:100px}
.stat .n{font-size:26px;font-weight:800;font-family:'JetBrains Mono'}
.stat .l{font-size:10px;color:#666;text-transform:uppercase;letter-spacing:1px;margin-top:1px}
.stat.s-pass .n{color:#4ade80}.stat.s-partial .n{color:#fbbf24}.stat.s-fail .n{color:#f87171}.stat.s-skip .n{color:#555}.stat.s-total .n{color:#60a5fa}
.bar{height:6px;background:#151525;border-radius:3px;margin-top:12px;overflow:hidden;position:relative}
.bar .fill{height:100%;border-radius:3px;transition:width .3s;background:linear-gradient(90deg,#4ade80,#22d3ee)}
.bar .pct{position:absolute;right:0;top:-16px;font-size:10px;color:#888;font-family:'JetBrains Mono'}
.current{background:rgba(96,165,250,0.06);border:1px solid #1e3a5f;border-radius:10px;margin:12px 32px;padding:14px 20px;min-height:60px;transition:all .3s}
.current .tag{font-size:10px;color:#60a5fa;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px}
.current .name{font-size:16px;font-weight:700;color:#fff}
.current .path{font-size:11px;color:#888;font-family:'JetBrains Mono';margin-top:2px}
.current .code{font-size:11px;font-family:'JetBrains Mono';color:#777;margin-top:6px;padding:6px 10px;background:rgba(0,0,0,.3);border-radius:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.current .code .hl{color:#fbbf24;background:rgba(251,191,36,.12);padding:0 3px;border-radius:2px}
.current .arrow{margin-top:6px;font-size:12px}.current .arrow .to{color:#4ade80}
.filters{padding:8px 32px;display:flex;gap:6px;align-items:center;position:sticky;top:120px;z-index:99;background:#0a0a14}
.fbtn{background:rgba(255,255,255,.04);border:1px solid #222;color:#888;padding:5px 12px;border-radius:6px;cursor:pointer;font-size:11px;font-family:'Inter';transition:all .2s}
.fbtn:hover{background:rgba(255,255,255,.08)}.fbtn.on{background:#2563eb;border-color:#3b82f6;color:#fff}
.search{background:rgba(255,255,255,.04);border:1px solid #222;color:#ccc;padding:5px 12px;border-radius:6px;font-size:11px;font-family:'Inter';width:220px;margin-left:auto}
.search::placeholder{color:#444}
#log{padding:8px 32px 40px}
.row{display:grid;grid-template-columns:44px 52px 1fr 180px 180px 70px;gap:6px;padding:6px 10px;border-radius:5px;font-size:11px;align-items:center;border-bottom:1px solid rgba(255,255,255,.02);transition:background .15s}
.row:hover{background:rgba(255,255,255,.02)}
.row .idx{color:#444;font-family:'JetBrains Mono';font-size:10px}
.badge{padding:2px 7px;border-radius:4px;font-size:9px;font-weight:700;text-transform:uppercase}
.badge.pass{background:rgba(74,222,128,.12);color:#4ade80}
.badge.partial{background:rgba(251,191,36,.12);color:#fbbf24}
.badge.fail{background:rgba(248,113,113,.12);color:#f87171}
.badge.skip{background:rgba(100,100,100,.12);color:#555}
.row .code{font-family:'JetBrains Mono';font-size:10px;color:#888;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.row .code .hl{color:#fbbf24;font-weight:500}
.row .file{color:#60a5fa;font-size:10px;font-family:'JetBrains Mono'}
.row .def{color:#4ade80;font-size:10px;font-family:'JetBrains Mono'}
.row .kind{font-size:9px;color:#555;background:rgba(255,255,255,.03);padding:2px 6px;border-radius:3px;text-align:center}
.done-banner{text-align:center;padding:40px;font-size:18px;font-weight:700;color:#4ade80}
</style>
</head>
<body>
<div class="top" id="topbar">
<h1>⚡ CmdClick — Live Integration Test</h1>
<div class="sub" id="subtitle">${stats.symbolCount.toLocaleString()} symbols · ${stats.referenceCount.toLocaleString()} refs · ${stats.fileCount} files</div>
<div class="stats">
<div class="stat s-total"><div class="n" id="n-total">0</div><div class="l">Tested</div></div>
<div class="stat s-pass"><div class="n" id="n-pass">0</div><div class="l">Exact</div></div>
<div class="stat s-partial"><div class="n" id="n-partial">0</div><div class="l">Partial</div></div>
<div class="stat s-fail"><div class="n" id="n-fail">0</div><div class="l">Failed</div></div>
<div class="stat s-skip"><div class="n" id="n-skip">0</div><div class="l">Skipped</div></div>
</div>
<div class="bar"><div class="fill" id="bar-fill" style="width:0"></div><div class="pct" id="bar-pct">0%</div></div>
</div>
<div class="current" id="current"><div class="tag">waiting...</div></div>
<div class="filters">
<button class="fbtn on" onclick="setFilter('all')">All</button>
<button class="fbtn" onclick="setFilter('pass')">✓ Pass</button>
<button class="fbtn" onclick="setFilter('partial')">⚠ Partial</button>
<button class="fbtn" onclick="setFilter('fail')">✗ Fail</button>
<input class="search" placeholder="Search..." oninput="setSearch(this.value)">
</div>
<div id="log"></div>
<script>
const TOTAL=${allTests.length};
let counts={pass:0,partial:0,fail:0,skip:0,total:0};
let allRows=[];
let filter='all',searchQ='';

const es=new EventSource('/events');
es.onmessage=function(e){
  const d=JSON.parse(e.data);
  if(d.type==='done'){document.getElementById('log').innerHTML+='<div class="done-banner">✅ ALL '+TOTAL+' TESTS COMPLETE</div>';return}
  if(d.type!=='result')return;
  const r=d.data;
  counts[r.status]++;counts.total++;
  document.getElementById('n-total').textContent=counts.total;
  document.getElementById('n-pass').textContent=counts.pass;
  document.getElementById('n-partial').textContent=counts.partial;
  document.getElementById('n-fail').textContent=counts.fail;
  document.getElementById('n-skip').textContent=counts.skip;
  const pct=((counts.total/TOTAL)*100).toFixed(1);
  document.getElementById('bar-fill').style.width=pct+'%';
  document.getElementById('bar-pct').textContent=pct+'%';
  // Current test
  const cur=document.getElementById('current');
  const hl=escHtml(r.lineText).replace(escHtml(r.symbolName),'<span class="hl">'+escHtml(r.symbolName)+'</span>');
  cur.innerHTML='<div class="tag">Testing #'+counts.total+' of '+TOTAL+'</div>'
    +'<div class="name">'+r.symbolName+' <span style="color:#555;font-weight:400;font-size:12px">('+r.symbolKind+')</span></div>'
    +'<div class="path">'+r.refFileShort+':'+r.refLine+'</div>'
    +'<div class="code">'+hl+'</div>'
    +'<div class="arrow">→ <span class="to">'+r.defFileShort+':'+r.defLine+'</span> <span style="color:#555;font-size:10px">via '+r.resolveMethod+'</span></div>';
  // Add row
  allRows.push(r);
  appendRow(r,counts.total);
};
function escHtml(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
function appendRow(r,n){
  if(filter!=='all'&&r.status!==filter)return;
  if(searchQ){const h=(r.symbol+r.refFileShort+r.lineText+r.symbolName+r.defFileShort).toLowerCase();if(!h.includes(searchQ))return}
  const log=document.getElementById('log');
  const hl=escHtml(r.lineText).replace(escHtml(r.symbolName),'<span class="hl">'+escHtml(r.symbolName)+'</span>');
  log.innerHTML+='<div class="row"><div class="idx">'+n+'</div><div><span class="badge '+r.status+'">'+r.status+'</span></div><div class="code">'+hl+'</div><div class="file">'+r.refFileShort+':'+r.refLine+'</div><div class="def">→ '+r.defFileShort+':'+r.defLine+'</div><div class="kind">'+r.symbolKind+'</div></div>';
  if(counts.total>4)window.scrollTo(0,document.body.scrollHeight);
}
function setFilter(f){filter=f;document.querySelectorAll('.fbtn').forEach(b=>b.classList.remove('on'));event.target.classList.add('on');rerender()}
function setSearch(q){searchQ=q.toLowerCase();rerender()}
function rerender(){const log=document.getElementById('log');log.innerHTML='';allRows.forEach((r,i)=>appendRow(r,i+1))}
</script>
</body>
</html>`;

// ── HTTP Server ──
const server = http.createServer((req, res) => {
  if (req.url === '/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(HTML);
});

server.listen(PORT, () => {
  console.log(`\n🌐 Dashboard: http://localhost:${PORT}`);
  console.log(`📂 VS Code navigation: ${VSCODE ? 'ON' : 'OFF'}`);
  console.log(`⏱  Delay: ${DELAY}ms per test\n`);
  execSync(`open http://localhost:${PORT}`);
  console.log('⏳ Waiting for browser to connect...');
});

// Wait for SSE client to connect, then start
const waitForClient = setInterval(() => {
  if (sseClients.size > 0) {
    clearInterval(waitForClient);
    console.log('✓ Browser connected! Starting tests...\n');
    runTests();
  }
}, 200);

async function runTests() {
  const MIN_DELAY = VSCODE ? DELAY : 15; // 15ms min so browser can render

  for (let i = 0; i < allTests.length; i++) {
    const t = allTests[i];

    // Open in VS Code
    if (VSCODE && t.status !== 'skip') {
      try { execSync(`code -g "${t.refFile}:${t.refLine}:${t.refCol}"`, { stdio: 'ignore' }); } catch {}
      await sleep(DELAY / 2);
      if (t.defFile) {
        try { execSync(`code -g "${t.defFile}:${t.defLine}:${t.defCol}"`, { stdio: 'ignore' }); } catch {}
      }
      await sleep(DELAY / 2);
    } else {
      await sleep(MIN_DELAY);
    }

    // Push to dashboard
    broadcast({ type: 'result', data: t });

    // Terminal progress
    const icon = t.status === 'pass' ? '✓' : t.status === 'partial' ? '⚠' : t.status === 'fail' ? '✗' : '⊘';
    if (t.status !== 'pass' || (i + 1) % 100 === 0) {
      console.log(`${icon} [${i+1}/${allTests.length}] ${t.symbolName} ${t.refFileShort}:${t.refLine} → ${t.defFileShort}:${t.defLine}`);
    }
  }

  broadcast({ type: 'done' });
  console.log('\n✅ All tests complete. Dashboard still live at http://localhost:' + PORT);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
