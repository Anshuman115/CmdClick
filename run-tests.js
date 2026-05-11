#!/usr/bin/env node
// CmdClick Interactive Test Runner
// Usage: node run-tests.js
// Opens each test file, prompts pass/fail, generates report at end.

const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');
const readline = require('readline');

const allTests = JSON.parse(fs.readFileSync(path.join(__dirname, 'test_cases.json'), 'utf8'));
const results = [];

// Parse --only flag: node run-tests.js --only 8,9,10,27
const onlyArg = process.argv.find(a => a.startsWith('--only'));
let onlyIds = null;
if (onlyArg) {
  const val = onlyArg.includes('=') ? onlyArg.split('=')[1] : process.argv[process.argv.indexOf(onlyArg) + 1];
  if (val) onlyIds = val.split(',').map(Number);
}
const tests = onlyIds ? allTests.filter(t => onlyIds.includes(t.id)) : allTests;

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((resolve) => rl.question(q, resolve));

function clear() { process.stdout.write('\x1Bc'); }

async function runTest(test, index) {
  clear();
  const total = tests.length;
  const progress = `[${index + 1}/${total}]`;
  const bar = '█'.repeat(Math.round(((index + 1) / total) * 30)) + '░'.repeat(30 - Math.round(((index + 1) / total) * 30));

  console.log(`\x1b[90m${bar} ${progress}\x1b[0m\n`);
  console.log(`\x1b[1;36m━━━ Test #${test.id} ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m`);
  console.log(`  \x1b[1mCategory:\x1b[0m  ${test.category}`);
  console.log(`  \x1b[1mAction:\x1b[0m    ${test.desc}`);

  if (test.filePath) {
    const shortFile = test.filePath.split('/').slice(-2).join('/');
    console.log(`  \x1b[1mFile:\x1b[0m      \x1b[90m${shortFile}:${test.line}\x1b[0m`);
    console.log(`  \x1b[1mClick:\x1b[0m     Cmd+Click on \x1b[1;33m"${test.clickTarget}"\x1b[0m`);
  } else {
    console.log(`  \x1b[1mCheck:\x1b[0m     ${test.clickTarget}`);
  }

  console.log(`  \x1b[1;32mExpected:\x1b[0m  ${test.expected}`);
  console.log(`\x1b[90m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m\n`);

  // Open file in VS Code
  if (test.filePath) {
    try {
      execSync(`code -g "${test.filePath}:${test.line}:${test.col}"`, { stdio: 'ignore' });
      console.log(`  \x1b[90m✓ File opened at line ${test.line}\x1b[0m\n`);
    } catch {
      console.log(`  \x1b[31m✗ Could not open file\x1b[0m\n`);
    }
  }

  // Prompt for result
  console.log('  \x1b[1mResult:\x1b[0m');
  console.log('    \x1b[32m[P]\x1b[0m Pass');
  console.log('    \x1b[31m[F]\x1b[0m Fail');
  console.log('    \x1b[33m[S]\x1b[0m Skip');
  console.log('');

  const answer = await ask('  Enter P / F / S: ');
  const choice = answer.trim().toUpperCase();

  let status = 'SKIP';
  let remark = '';

  if (choice === 'P' || choice === '') {
    status = 'PASS';
  } else if (choice === 'F') {
    status = 'FAIL';
    remark = await ask('  \x1b[33mBug/remark:\x1b[0m ');
  } else {
    status = 'SKIP';
  }

  results.push({
    id: test.id,
    category: test.category,
    desc: test.desc,
    clickTarget: test.clickTarget,
    expected: test.expected,
    status,
    remark: remark.trim(),
  });

  const icon = status === 'PASS' ? '\x1b[32m✓\x1b[0m' : status === 'FAIL' ? '\x1b[31m✗\x1b[0m' : '\x1b[33m⊘\x1b[0m';
  console.log(`\n  ${icon} Test #${test.id} → ${status}${remark ? ' — ' + remark : ''}\n`);
  
  // Brief pause so user sees result
  await new Promise(r => setTimeout(r, 500));
}

async function main() {
  clear();
  const mode = onlyIds ? `Retest ${tests.length} failed` : `${tests.length} tests`;
  console.log(`\n\x1b[1m╔══════════════════════════════════════════════════════════╗`);
  console.log(`║         CmdClick — Interactive Test Suite                ║`);
  console.log(`║              ${mode.padEnd(30)}              ║`);
  console.log(`╚══════════════════════════════════════════════════════════╝\x1b[0m\n`);
  console.log('  For each test, the file opens at the exact line.');
  console.log('  Cmd+Click the highlighted target, then mark P/F/S.\n');
  
  await ask('  \x1b[90mPress Enter to start...\x1b[0m');

  for (let i = 0; i < tests.length; i++) {
    await runTest(tests[i], i);
  }

  // Generate report
  clear();
  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  const skipped = results.filter(r => r.status === 'SKIP').length;

  console.log('\n\x1b[1m╔══════════════════════════════════════════════════════════╗');
  console.log('║                    TEST RESULTS                          ║');
  console.log('╚══════════════════════════════════════════════════════════╝\x1b[0m\n');

  console.log(`  \x1b[32m✓ Passed:  ${passed}\x1b[0m`);
  console.log(`  \x1b[31m✗ Failed:  ${failed}\x1b[0m`);
  console.log(`  \x1b[33m⊘ Skipped: ${skipped}\x1b[0m`);
  console.log(`  ─────────────`);
  console.log(`  Total:    ${results.length}\n`);

  // Show failures
  const failures = results.filter(r => r.status === 'FAIL');
  if (failures.length > 0) {
    console.log('\x1b[1;31m── FAILURES ──────────────────────────────────────────────\x1b[0m\n');
    for (const f of failures) {
      console.log(`  #${f.id} [${f.category}] ${f.desc}`);
      console.log(`     Expected: ${f.expected}`);
      console.log(`     \x1b[31mBug: ${f.remark || '(no remark)'}\x1b[0m\n`);
    }
  }

  // Show all results table
  console.log('\x1b[1m── FULL RESULTS ─────────────────────────────────────────\x1b[0m\n');
  let lastCat = '';
  for (const r of results) {
    if (r.category !== lastCat) {
      console.log(`  \x1b[1;33m${r.category}\x1b[0m`);
      lastCat = r.category;
    }
    const icon = r.status === 'PASS' ? '\x1b[32m✓\x1b[0m' : r.status === 'FAIL' ? '\x1b[31m✗\x1b[0m' : '\x1b[33m⊘\x1b[0m';
    const remark = r.remark ? ` \x1b[90m— ${r.remark}\x1b[0m` : '';
    console.log(`    ${icon} #${String(r.id).padStart(2)} ${r.clickTarget}${remark}`);
  }

  // Save to file
  const report = {
    date: new Date().toISOString(),
    summary: { total: results.length, passed, failed, skipped },
    results,
  };
  const reportPath = path.join(__dirname, 'test-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  // Also save markdown report
  let md = `# CmdClick Test Report\n\n`;
  md += `**Date:** ${new Date().toLocaleString()}\n\n`;
  md += `| Metric | Count |\n|---|---|\n`;
  md += `| ✓ Passed | ${passed} |\n`;
  md += `| ✗ Failed | ${failed} |\n`;
  md += `| ⊘ Skipped | ${skipped} |\n`;
  md += `| **Total** | **${results.length}** |\n\n`;

  if (failures.length > 0) {
    md += `## Failures\n\n`;
    for (const f of failures) {
      md += `- **#${f.id}** [${f.category}] ${f.desc}\n`;
      md += `  - Expected: ${f.expected}\n`;
      md += `  - Bug: ${f.remark || '(no remark)'}\n\n`;
    }
  }

  md += `## All Results\n\n`;
  md += `| # | Category | Target | Result | Remark |\n`;
  md += `|---|----------|--------|--------|--------|\n`;
  for (const r of results) {
    const icon = r.status === 'PASS' ? '✓' : r.status === 'FAIL' ? '✗' : '⊘';
    md += `| ${r.id} | ${r.category} | ${r.clickTarget} | ${icon} ${r.status} | ${r.remark || ''} |\n`;
  }

  const mdPath = path.join(__dirname, 'test-report.md');
  fs.writeFileSync(mdPath, md);

  console.log(`\n  \x1b[90mReports saved:\x1b[0m`);
  console.log(`    ${reportPath}`);
  console.log(`    ${mdPath}\n`);

  rl.close();
}

main().catch(console.error);
