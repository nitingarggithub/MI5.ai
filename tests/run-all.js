/**
 * run-all.js — MI5.ai master test runner
 *
 * Usage:
 *   node run-all.js               — all tests (includes network calls)
 *   node run-all.js --no-network  — offline / unit tests only
 */
'use strict';
const noNetwork = process.argv.includes('--no-network');

const SUITES = [
    { name: 'Q/A Engine',          file: './test-qa-engine.js',      network: false },
    { name: 'Store & Persistence', file: './test-store.js',          network: false },
    { name: 'IPC / Static Analysis',file: './test-ipc-handlers.js',  network: false },
    { name: 'LLM Providers',       file: './test-llm-providers.js',  network: true  },
    { name: 'Whisper STT',         file: './test-whisper.js',        network: true  },
    { name: 'Vision API',          file: './test-vision.js',         network: true  },
    { name: 'API Keys',            file: './test-api-keys.js',       network: true  },
];

async function main() {
    console.log(`\nMI5.ai Test Suite  •  ${new Date().toLocaleString()}`);
    if (noNetwork) console.log('Mode: OFFLINE (--no-network) — skipping API calls\n');
    else           console.log('Mode: FULL (including network calls)\n');

    const results = [];
    for (const suite of SUITES) {
        if (noNetwork && suite.network) {
            console.log(`⏭  SKIPPED (offline): ${suite.name}`);
            results.push({ suite: suite.name, passed:0, failed:0, skipped:0, _skippedSuite:true });
            continue;
        }
        try {
            const mod = require(suite.file);
            const r   = await mod();
            results.push(r);
        } catch(e) {
            console.error(`\n💥 Suite "${suite.name}" crashed:`, e.message);
            results.push({ suite: suite.name, passed:0, failed:1, skipped:0, _crashed:true });
        }
    }

    // ── Summary table ──────────────────────────────────────────────
    const W = 64;
    console.log('\n\n' + '═'.repeat(W));
    console.log('  MI5.ai — Final Test Summary');
    console.log('═'.repeat(W));
    console.log(`  ${'Suite'.padEnd(26)} ${'Pass'.padEnd(7)} ${'Fail'.padEnd(7)} ${'Skip'.padEnd(7)} Status`);
    console.log('─'.repeat(W));

    let totalPass=0, totalFail=0, totalSkip=0;
    for (const r of results) {
        let status;
        if (r._skippedSuite)  status = '⏭  suite skipped';
        else if (r._crashed)  status = '💥 CRASHED';
        else if (r.failed>0)  status = '❌ FAIL';
        else                  status = '✅ PASS';
        console.log(`  ${(r.suite||'?').padEnd(26)} ${String(r.passed||0).padEnd(7)} ${String(r.failed||0).padEnd(7)} ${String(r.skipped||0).padEnd(7)} ${status}`);
        totalPass += r.passed||0;
        totalFail += r.failed||0;
        totalSkip += r.skipped||0;
    }
    console.log('─'.repeat(W));
    const verdict = totalFail===0 ? '🎉 All tests passed!' : `⚠  ${totalFail} failure(s)`;
    console.log(`  ${'TOTAL'.padEnd(26)} ${String(totalPass).padEnd(7)} ${String(totalFail).padEnd(7)} ${String(totalSkip).padEnd(7)} ${verdict}`);
    console.log('═'.repeat(W) + '\n');

    process.exit(totalFail > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
