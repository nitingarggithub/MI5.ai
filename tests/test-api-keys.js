/**
 * test-api-keys.js
 * Validates API key format and live connectivity for each configured provider.
 * Makes a single 1-token completion call per provider — minimal quota cost.
 */
'use strict';
const { loadKeys, TestRunner, apiFetch } = require('./test-helpers');

const KEY_FORMAT = {
    groq:     { pattern: /^gsk_[A-Za-z0-9]{50,}$/, hint: 'gsk_...' },
    cerebras: { pattern: /^[A-Za-z0-9_-]{20,}$/,   hint: 'csk-... or similar' },
    gemini:   { pattern: /^AIza[A-Za-z0-9_-]{35,}$/,hint: 'AIza...' },
};

async function ping(url, model, key) {
    const res  = await apiFetch(url, {
        method: 'POST',
        headers: { 'Content-Type':'application/json', 'Authorization':`Bearer ${key}` },
        body: JSON.stringify({
            model,
            messages: [{ role:'user', content:'Reply: OK' }],
            max_tokens: 5, temperature: 0
        })
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error((data.error?.message||JSON.stringify(data.error))||`HTTP ${res.status}`);
    return data.choices?.[0]?.message?.content?.trim() || '';
}

async function run() {
    const t    = new TestRunner('API Key Format & Connectivity');
    const keys = loadKeys();

    // ── Groq ──────────────────────────────────────────────────────
    if (!keys.groq) {
        t.skip('Groq key present',      'Not found in secrets.json or store.json');
        t.skip('Groq key format',       'skipped');
        t.skip('Groq connectivity',     'skipped');
    } else {
        t.pass('Groq key present');
        if (KEY_FORMAT.groq.pattern.test(keys.groq)) t.pass('Groq key format (gsk_...)');
        else t.fail('Groq key format', `Expected ${KEY_FORMAT.groq.hint}, got "${keys.groq.slice(0,15)}..."`);
        try {
            const r = await ping('https://api.groq.com/openai/v1/chat/completions', 'llama-3.3-70b-versatile', keys.groq);
            t.pass(`Groq connectivity ✓ — "${r}"`);
        } catch(e) { t.fail('Groq connectivity', e.message); }
    }

    // ── Cerebras ──────────────────────────────────────────────────
    if (!keys.cerebras) {
        t.skip('Cerebras key present',  'Not found');
        t.skip('Cerebras connectivity', 'skipped');
    } else {
        t.pass('Cerebras key present');
        try {
            const r = await ping('https://api.cerebras.ai/v1/chat/completions', 'llama-3.3-70b', keys.cerebras);
            t.pass(`Cerebras connectivity ✓ — "${r}"`);
        } catch(e) { t.fail('Cerebras connectivity', e.message); }
    }

    // ── Gemini ────────────────────────────────────────────────────
    if (!keys.gemini) {
        t.skip('Gemini key present',    'Not found');
        t.skip('Gemini key format',     'skipped');
        t.skip('Gemini connectivity',   'skipped');
    } else {
        t.pass('Gemini key present');
        if (KEY_FORMAT.gemini.pattern.test(keys.gemini)) t.pass('Gemini key format (AIza...)');
        else t.fail('Gemini key format', `Expected ${KEY_FORMAT.gemini.hint}, got "${keys.gemini.slice(0,15)}..."`);
        try {
            const r = await ping('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', 'gemini-2.0-flash', keys.gemini);
            t.pass(`Gemini connectivity ✓ — "${r}"`);
        } catch(e) { t.fail('Gemini connectivity', e.message); }
    }

    // ── Key separation advice ─────────────────────────────────────
    const { store, secrets } = keys;
    if (secrets && Object.keys(secrets).length > 0)
        t.pass('secrets.json exists — keys stored separately from store.json ✓');
    else
        t.skip('secrets.json separation', 'secrets.json not found yet — save config once in the app');

    return t.summary();
}

if (require.main === module) run().catch(console.error);
module.exports = run;
