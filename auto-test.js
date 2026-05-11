#!/usr/bin/env node
// Generates an interactive HTML test report for ALL references in the index.
// Opens in browser — you scroll through and see every click + navigation.

const fs = require('fs');
const path = require('path');

const { Index } = require('./dist/index/Index');
const { MoleculerParser } = require('./dist/parser/moleculer/MoleculerParser');
const { Scanner } = require('./dist/scanner/Scanner');
const { detect, CursorKind } = require('./dist/lsp/Cursor');

// ── Configure the target repo ────────────────────────────────────────────────
// Set ROOT to the `src/` directory of any MoleculerJS project you want to test.
// Options (in priority order):
//   1. CLI arg:  node auto-test.js --root=/path/to/your/project/src
//   2. Env var:  CW_ROOT=/path/to/your/project/src node auto-test.js
//   3. Default:  set below
const rootArg = process.argv.slice(2).find(a => a.startsWith('--root'));
const ROOT = rootArg
  ? rootArg.includes('=') ? rootArg.split('=')[1] : process.argv[process.argv.indexOf(rootArg) + 1]
  : process.env.CW_ROOT
  ?? (() => { console.error('ERROR: Set --root=/path/to/src or CW_ROOT env var'); process.exit(1); })();


console.log('⏳ Building index...');
const t0 = Date.now();
const idx = new Index();
const sc = new Scanner([new MoleculerParser()], idx);
sc.scan(ROOT);
const pool = idx.stringPool();
const scanMs = Date.now() - t0;
const stats = idx.stats();
console.log(`✓ ${stats.symbolCount} symbols, ${stats.referenceCount} references in ${scanMs}ms`);

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

const fileCache = new Map();
function readFile(fp) {
  if (fileCache.has(fp)) return fileCache.get(fp);
  try { const c = fs.readFileSync(fp, 'utf8'); fileCache.set(fp, c); return c; } catch { return null; }
}

console.log('⏳ Testing every reference...');

const results = [];
const allSymbols = idx.prefixSearch('');
let tested = 0;

for (const sym of allSymbols) {
  const refs = idx.findReferences(sym.fullName);
  for (const ref of refs) {
    tested++;
    const filePath = pool.get(ref.fileId);
    const content = readFile(filePath);
    if (!content) continue;
    
    const lines = content.split('\n');
    const lineText = lines[ref.line] || '';
    const ns = getNamespace(filePath);
    const contentBuf = Buffer.from(content);
    
    let ctx = detect(contentBuf, ref.line, ref.column, ns);
    if (ctx.kind === CursorKind.Unknown) {
      const nameIdx = lineText.indexOf(sym.name);
      if (nameIdx >= 0) ctx = detect(contentBuf, ref.line, nameIdx, ns);
    }
    
    let resolved = null;
    let resolveMethod = '';
    
    if (ctx.kind !== CursorKind.Unknown) {
      if (ctx.rawString) {
        const ev = findEventByRaw(ctx.rawString);
        if (ev) { resolved = ev; resolveMethod = 'event rawString'; }
      }
      if (!resolved && ctx.kind === CursorKind.ServiceName) {
        resolveMethod = 'service name';
      } else if (!resolved) {
        const name = shortName(ctx.fullName);
        if (ctx.isChained) {
          resolved = findClassByName(name) || findBestByName(name);
          resolveMethod = 'chained → ' + (findClassByName(name) ? 'classSymbol' : 'bestByName');
        } else {
          resolved = idx.lookup(ctx.fullName);
          if (resolved) resolveMethod = 'exact lookup';
          else { resolved = findBestByName(name); resolveMethod = 'bestByName fallback'; }
        }
      }
    }
    
    let status = 'skip';
    if (resolveMethod === 'service name') status = 'pass';
    else if (resolved && resolved.fullName === sym.fullName) status = 'pass';
    else if (resolved && resolved.name === sym.name) status = 'partial';
    else if (resolved) status = 'fail';
    else if (ctx.kind === CursorKind.Unknown) status = 'skip';
    else status = 'fail';
    
    const defFile = resolved ? pool.get(resolved.sourceFileId || resolved.fileId) : '';
    
    results.push({
      expectedSymbol: sym.fullName,
      expectedKind: sym.kind,
      refFile: filePath.replace(ROOT + '/', ''),
      refLine: ref.line + 1,
      lineText: lineText.trim(),
      clickTarget: sym.name,
      cursorKind: ctx.kind,
      cursorFull: ctx.fullName,
      resolveMethod,
      resolvedSymbol: resolved ? resolved.fullName : '',
      resolvedFile: defFile.replace(ROOT + '/', ''),
      resolvedLine: resolved ? resolved.line + 1 : 0,
      defFile: pool.get(sym.sourceFileId || sym.fileId).replace(ROOT + '/', ''),
      defLine: sym.line + 1,
      status,
    });
  }
}

const passCount = results.filter(r => r.status === 'pass').length;
const partialCount = results.filter(r => r.status === 'partial').length;
const failCount = results.filter(r => r.status === 'fail').length;
const skipCount = results.filter(r => r.status === 'skip').length;

console.log(`✓ Tested ${tested} references`);
console.log(`  Pass: ${passCount}, Partial: ${partialCount}, Fail: ${failCount}, Skip: ${skipCount}`);

// Generate HTML
console.log('⏳ Generating HTML report...');

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>CmdClick — Exhaustive Test Report</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Inter', sans-serif; background: #0f0f1a; color: #e0e0e8; min-height: 100vh; }
  
  .header { background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%); padding: 32px 40px; border-bottom: 1px solid #2a2a4a; position: sticky; top: 0; z-index: 100; }
  .header h1 { font-size: 24px; font-weight: 700; color: #fff; }
  .header .sub { color: #8888aa; font-size: 14px; margin-top: 4px; }
  
  .stats { display: flex; gap: 24px; margin-top: 16px; flex-wrap: wrap; }
  .stat { background: rgba(255,255,255,0.05); border-radius: 8px; padding: 12px 20px; min-width: 120px; }
  .stat .num { font-size: 28px; font-weight: 700; font-family: 'JetBrains Mono', monospace; }
  .stat .label { font-size: 11px; color: #8888aa; text-transform: uppercase; letter-spacing: 1px; margin-top: 2px; }
  .stat.pass .num { color: #4ade80; }
  .stat.partial .num { color: #fbbf24; }
  .stat.fail .num { color: #f87171; }
  .stat.skip .num { color: #6b7280; }
  .stat.total .num { color: #60a5fa; }
  
  .filters { padding: 16px 40px; background: #13132a; border-bottom: 1px solid #2a2a4a; display: flex; gap: 8px; align-items: center; position: sticky; top: 130px; z-index: 99; }
  .filters label { font-size: 13px; color: #8888aa; }
  .filter-btn { background: rgba(255,255,255,0.06); border: 1px solid #333; color: #aaa; padding: 6px 14px; border-radius: 6px; cursor: pointer; font-size: 12px; font-family: 'Inter', sans-serif; transition: all 0.2s; }
  .filter-btn:hover { background: rgba(255,255,255,0.1); }
  .filter-btn.active { background: #2563eb; border-color: #3b82f6; color: #fff; }
  .search { background: rgba(255,255,255,0.06); border: 1px solid #333; color: #e0e0e8; padding: 6px 14px; border-radius: 6px; font-size: 12px; font-family: 'Inter', sans-serif; width: 250px; margin-left: auto; }
  .search::placeholder { color: #555; }
  
  .container { padding: 20px 40px; }
  .row { display: grid; grid-template-columns: 40px 60px 1fr 200px 200px 100px; gap: 8px; padding: 8px 12px; border-radius: 6px; font-size: 12px; align-items: center; border-bottom: 1px solid #1a1a30; transition: background 0.15s; }
  .row:hover { background: rgba(255,255,255,0.03); }
  .row.header-row { background: #1a1a30; font-weight: 600; color: #8888aa; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; position: sticky; top: 180px; z-index: 98; border-radius: 0; }
  
  .badge { padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 600; text-transform: uppercase; }
  .badge.pass { background: rgba(74,222,128,0.15); color: #4ade80; }
  .badge.partial { background: rgba(251,191,36,0.15); color: #fbbf24; }
  .badge.fail { background: rgba(248,113,113,0.15); color: #f87171; }
  .badge.skip { background: rgba(107,114,128,0.15); color: #6b7280; }
  
  .code { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: #a0a0b8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .code .highlight { color: #fbbf24; font-weight: 500; background: rgba(251,191,36,0.1); padding: 1px 3px; border-radius: 2px; }
  .file { color: #60a5fa; font-size: 11px; }
  .arrow { color: #4ade80; font-size: 11px; }
  .kind { font-size: 10px; padding: 1px 6px; border-radius: 3px; background: rgba(255,255,255,0.05); color: #888; }
  
  .expand { cursor: pointer; color: #555; }
  .expand:hover { color: #aaa; }
  .detail { display: none; grid-column: 1 / -1; background: #16162e; padding: 12px 16px; border-radius: 6px; margin: 4px 0; font-size: 11px; }
  .detail.open { display: block; }
  .detail-row { display: flex; gap: 8px; margin: 4px 0; }
  .detail-label { color: #6b7280; min-width: 120px; }
  .detail-value { color: #c0c0d0; font-family: 'JetBrains Mono', monospace; }
  
  .progress-bar { height: 4px; background: #1a1a30; border-radius: 2px; overflow: hidden; margin-top: 12px; }
  .progress-fill { height: 100%; background: linear-gradient(90deg, #4ade80, #22d3ee); border-radius: 2px; transition: width 0.3s; }
</style>
</head>
<body>
<div class="header">
  <h1>⚡ CmdClick — Exhaustive Test Report</h1>
  <div class="sub">${stats.symbolCount.toLocaleString()} symbols · ${stats.referenceCount.toLocaleString()} references · ${stats.fileCount} files · scanned in ${scanMs}ms</div>
  <div class="stats">
    <div class="stat total"><div class="num">${results.length.toLocaleString()}</div><div class="label">Total Tested</div></div>
    <div class="stat pass"><div class="num">${passCount.toLocaleString()}</div><div class="label">Exact Match</div></div>
    <div class="stat partial"><div class="num">${partialCount}</div><div class="label">Name Match</div></div>
    <div class="stat fail"><div class="num">${failCount}</div><div class="label">Failed</div></div>
    <div class="stat skip"><div class="num">${skipCount}</div><div class="label">Skipped</div></div>
  </div>
  <div class="progress-bar"><div class="progress-fill" style="width: ${((passCount+partialCount)/(results.length-skipCount)*100).toFixed(1)}%"></div></div>
</div>

<div class="filters">
  <label>Filter:</label>
  <button class="filter-btn active" onclick="filter('all')">All</button>
  <button class="filter-btn" onclick="filter('pass')">✓ Pass</button>
  <button class="filter-btn" onclick="filter('partial')">⚠ Partial</button>
  <button class="filter-btn" onclick="filter('fail')">✗ Fail</button>
  <button class="filter-btn" onclick="filter('skip')">⊘ Skip</button>
  <input class="search" type="text" placeholder="Search symbol, file, or code..." oninput="search(this.value)">
</div>

<div class="container">
  <div class="row header-row">
    <div>#</div>
    <div>Status</div>
    <div>Source Line (click target highlighted)</div>
    <div>Called From</div>
    <div>Navigates To</div>
    <div>Kind</div>
  </div>
  <div id="rows"></div>
</div>

<script>
const DATA = ${JSON.stringify(results)};
let currentFilter = 'all';
let currentSearch = '';

function escHtml(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function highlightCode(lineText, target) {
  const esc = escHtml(lineText);
  const escTarget = escHtml(target);
  const idx = esc.indexOf(escTarget);
  if (idx < 0) return esc;
  return esc.slice(0, idx) + '<span class="highlight">' + escTarget + '</span>' + esc.slice(idx + escTarget.length);
}

function renderRows() {
  const container = document.getElementById('rows');
  let html = '';
  let shown = 0;
  for (let i = 0; i < DATA.length; i++) {
    const r = DATA[i];
    if (currentFilter !== 'all' && r.status !== currentFilter) continue;
    if (currentSearch) {
      const q = currentSearch.toLowerCase();
      const hay = (r.expectedSymbol + r.refFile + r.lineText + r.resolvedFile + r.clickTarget).toLowerCase();
      if (!hay.includes(q)) continue;
    }
    shown++;
    const code = highlightCode(r.lineText.slice(0, 100), r.clickTarget);
    html += '<div class="row" data-idx="'+i+'" onclick="toggleDetail('+i+')">';
    html += '<div class="expand">'+(shown)+'</div>';
    html += '<div><span class="badge '+r.status+'">'+r.status+'</span></div>';
    html += '<div class="code">'+code+'</div>';
    html += '<div class="file">'+r.refFile+':'+r.refLine+'</div>';
    html += '<div class="arrow">→ '+r.resolvedFile+(r.resolvedLine?':'+r.resolvedLine:'')+'</div>';
    html += '<div><span class="kind">'+r.expectedKind+'</span></div>';
    html += '</div>';
    html += '<div class="detail" id="detail-'+i+'">';
    html += '<div class="detail-row"><span class="detail-label">Expected Symbol</span><span class="detail-value">'+r.expectedSymbol+'</span></div>';
    html += '<div class="detail-row"><span class="detail-label">Resolved Symbol</span><span class="detail-value">'+(r.resolvedSymbol||'—')+'</span></div>';
    html += '<div class="detail-row"><span class="detail-label">Cursor Kind</span><span class="detail-value">'+r.cursorKind+'</span></div>';
    html += '<div class="detail-row"><span class="detail-label">Cursor fullName</span><span class="detail-value">'+r.cursorFull+'</span></div>';
    html += '<div class="detail-row"><span class="detail-label">Resolve Method</span><span class="detail-value">'+r.resolveMethod+'</span></div>';
    html += '<div class="detail-row"><span class="detail-label">Definition File</span><span class="detail-value">'+r.defFile+':'+r.defLine+'</span></div>';
    html += '</div>';
  }
  container.innerHTML = html;
  document.querySelector('.header .sub').textContent = 'Showing ' + shown + ' of ' + DATA.length + ' references';
}

function filter(f) {
  currentFilter = f;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  event.target.classList.add('active');
  renderRows();
}

function search(q) {
  currentSearch = q;
  renderRows();
}

function toggleDetail(idx) {
  const el = document.getElementById('detail-' + idx);
  if (el) el.classList.toggle('open');
}

renderRows();
</script>
</body>
</html>`;

const reportPath = path.join(__dirname, 'test-report.html');
fs.writeFileSync(reportPath, html);
console.log(`\n✓ Report saved: ${reportPath}`);
console.log('Opening in browser...');

const { execSync } = require('child_process');
execSync('open ' + reportPath);
