/**
 * test-helpers.js — shared utilities for all MI5.ai tests
 */
'use strict';
const fs   = require('fs');
const path = require('path');

const APP_DIR    = path.join(__dirname, '..', 'source', 'MI5.ai');
const STORE_PATH = path.join(APP_DIR, 'store.json');
const SECRETS_PATH = path.join(APP_DIR, 'secrets.json');
const CFG_PATH   = path.join(__dirname, 'test-config.json');

/** Load API keys: test-config.json first, then live secrets.json / store.json */
function loadKeys() {
    let cfg = {};
    try { if (fs.existsSync(CFG_PATH)) cfg = JSON.parse(fs.readFileSync(CFG_PATH, 'utf8')); } catch(_) {}

    let store   = {};
    let secrets = {};
    try { if (fs.existsSync(STORE_PATH))   store   = JSON.parse(fs.readFileSync(STORE_PATH,   'utf8')); } catch(_) {}
    try { if (fs.existsSync(SECRETS_PATH)) secrets = JSON.parse(fs.readFileSync(SECRETS_PATH, 'utf8')); } catch(_) {}

    const primaryKey = secrets.apiKey || store.apiKey || '';
    const model      = store.model || 'cerebras';
    const groqFbKey  = secrets.groqFallbackKey || store.groqFallbackKey || '';

    return {
        groq:     (cfg.groqKey     || groqFbKey || (model === 'groq' ? primaryKey : '') || (primaryKey.startsWith('gsk_') ? primaryKey : '')).trim(),
        cerebras: (cfg.cerebrasKey || (model === 'cerebras' ? primaryKey : '')).trim(),
        gemini:   (cfg.geminiKey   || (model === 'gemini'   ? primaryKey : '')).trim(),
        model,
        store,
        secrets
    };
}

/** Minimal test runner */
class TestRunner {
    constructor(suiteName) {
        this.suite   = suiteName;
        this.passed  = 0;
        this.failed  = 0;
        this.skipped = 0;
        this.results = [];
        console.log(`\n${'='.repeat(62)}`);
        console.log(`  ${suiteName}`);
        console.log('='.repeat(62));
    }
    pass(name)          { this.passed++;  this.results.push({name, status:'PASS'});         console.log(`  ✅  ${name}`); }
    fail(name, reason)  { this.failed++;  this.results.push({name, status:'FAIL', reason}); console.log(`  ❌  ${name}\n       → ${reason}`); }
    skip(name, reason)  { this.skipped++; this.results.push({name, status:'SKIP', reason}); console.log(`  ⏭   ${name}  (${reason})`); }
    summary() {
        console.log('-'.repeat(62));
        console.log(`  Passed: ${this.passed}  Failed: ${this.failed}  Skipped: ${this.skipped}`);
        return { suite: this.suite, passed: this.passed, failed: this.failed, skipped: this.skipped };
    }
}

/** Fetch (Node 18+ built-in, no dep needed) */
async function apiFetch(url, opts) {
    if (typeof fetch !== 'undefined') return fetch(url, opts);
    const mod = await import('node-fetch');
    return mod.default(url, opts);
}

module.exports = { loadKeys, TestRunner, apiFetch, APP_DIR, STORE_PATH };
