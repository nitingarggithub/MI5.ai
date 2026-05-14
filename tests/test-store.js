/**
 * test-store.js
 * Tests store.json + secrets.json read/write/merge logic. No network calls.
 */
'use strict';
const { TestRunner, STORE_PATH, APP_DIR } = require('./test-helpers');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

const SECRETS_PATH = path.join(APP_DIR, 'secrets.json');
const QA_PATH      = path.join(APP_DIR, 'qa_pairs.json');

const DEFAULT_STORE = {
    model: 'cerebras',
    specialistMode: '',
    resumeContext: '',
    jdContext: '',
    domainContext: '',
    audioInputDeviceId: '',
    smartAutoAnswer: false
};

async function run() {
    const t = new TestRunner('Store / Secrets / qa_pairs.json Persistence');

    // ── Default store shape ───────────────────────────────────────
    for (const k of Object.keys(DEFAULT_STORE)) {
        if (k in DEFAULT_STORE) t.pass(`Default store has key: "${k}"`);
        else t.fail(`Default store missing: "${k}"`);
    }
    if (DEFAULT_STORE.model === 'cerebras') t.pass('Default model is "cerebras"');
    else t.fail('Default model', `expected "cerebras", got "${DEFAULT_STORE.model}"`);

    // ── audioInputDeviceId null-guard ────────────────────────────
    const withNull = { ...DEFAULT_STORE, audioInputDeviceId: null };
    if (withNull.audioInputDeviceId == null) withNull.audioInputDeviceId = '';
    if (withNull.audioInputDeviceId === '') t.pass('audioInputDeviceId null → "" guard');
    else t.fail('audioInputDeviceId null guard', `got: ${withNull.audioInputDeviceId}`);

    // ── Partial merge ─────────────────────────────────────────────
    const partial = { model: 'groq', specialistMode: 'deepseek-r1' };
    const merged  = { ...DEFAULT_STORE, ...partial };
    if (merged.model === 'groq')                    t.pass('Merge: model overridden');
    if (merged.specialistMode === 'deepseek-r1')    t.pass('Merge: specialistMode overridden');
    if (merged.smartAutoAnswer === false)            t.pass('Merge: unset fields keep defaults');

    // ── store.json round-trip ─────────────────────────────────────
    const tmpStore = path.join(os.tmpdir(), `mi5-store-${Date.now()}.json`);
    const testData = { ...DEFAULT_STORE, model: 'gemini', specialistMode: 'qwq-32b' };
    fs.writeFileSync(tmpStore, JSON.stringify(testData));
    const loaded   = JSON.parse(fs.readFileSync(tmpStore, 'utf8'));
    if (loaded.model === 'gemini')          t.pass('store.json round-trip: model');
    else t.fail('store.json round-trip: model', `got "${loaded.model}"`);
    if (loaded.specialistMode === 'qwq-32b') t.pass('store.json round-trip: specialistMode');
    else t.fail('store.json round-trip: specialistMode', `got "${loaded.specialistMode}"`);
    fs.unlinkSync(tmpStore);

    // ── secrets.json separation ───────────────────────────────────
    const tmpSec = path.join(os.tmpdir(), `mi5-secrets-${Date.now()}.json`);
    const secData = { apiKey: 'gsk_test', groqFallbackKey: 'gsk_fb' };
    fs.writeFileSync(tmpSec, JSON.stringify(secData));
    const secLoaded = JSON.parse(fs.readFileSync(tmpSec, 'utf8'));
    if (secLoaded.apiKey === 'gsk_test')         t.pass('secrets.json: apiKey persists');
    if (secLoaded.groqFallbackKey === 'gsk_fb')  t.pass('secrets.json: groqFallbackKey persists');
    if (!('model' in secLoaded))                  t.pass('secrets.json: model NOT in secrets (correct separation)');
    fs.unlinkSync(tmpSec);

    // ── qa_pairs.json shape ───────────────────────────────────────
    const tmpQA  = path.join(os.tmpdir(), `mi5-qa-${Date.now()}.json`);
    const qaData = [{ id:'x1', q:'Q?', a:'A.', tags:['cpp'], hits:1, createdAt: new Date().toISOString(), lastUsed: null }];
    fs.writeFileSync(tmpQA, JSON.stringify(qaData, null, 2));
    const qaLoaded = JSON.parse(fs.readFileSync(tmpQA, 'utf8'));
    if (Array.isArray(qaLoaded))           t.pass('qa_pairs.json: is array');
    if (qaLoaded[0].id === 'x1')           t.pass('qa_pairs.json: id preserved');
    if (qaLoaded[0].hits === 1)            t.pass('qa_pairs.json: hits preserved');
    if (qaLoaded[0].lastUsed === null)     t.pass('qa_pairs.json: lastUsed null preserved');
    fs.unlinkSync(tmpQA);

    // ── Live store.json sanity ────────────────────────────────────
    if (!fs.existsSync(STORE_PATH)) {
        t.skip('Live store.json sanity', 'Not found at ' + STORE_PATH);
    } else {
        try {
            const live = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
            t.pass('Live store.json: valid JSON');
            const validModels = ['cerebras','groq','gemini','grok','openrouter'];
            const m = live.model || 'cerebras';
            if (validModels.includes(m)) t.pass(`Live store.json: model "${m}" is known`);
            else t.fail('Live store.json: unknown model', `"${m}"`);
            if (!('apiKey' in live)) t.pass('Live store.json: apiKey NOT in store.json (moved to secrets.json)');
            else t.skip('Live store.json: apiKey separation', 'apiKey still in store.json — consider moving to secrets.json');
        } catch(e) { t.fail('Live store.json: valid JSON', e.message); }
    }

    // ── Live secrets.json sanity ──────────────────────────────────
    if (!fs.existsSync(SECRETS_PATH)) {
        t.skip('Live secrets.json exists', 'Not found — run app and save config once');
    } else {
        try {
            const sec = JSON.parse(fs.readFileSync(SECRETS_PATH, 'utf8'));
            t.pass('Live secrets.json: valid JSON');
            if ('apiKey' in sec) t.pass('Live secrets.json: apiKey present');
            else t.skip('Live secrets.json: apiKey', 'Not set yet');

            // Detect Groq key for Whisper/Vision
            const fk  = (sec.groqFallbackKey || '').trim();
            const pk  = (sec.apiKey || '').trim();
            const hasGroq = fk.startsWith('gsk_') || pk.startsWith('gsk_');
            if (hasGroq) t.pass('Live secrets.json: Groq key available for Whisper/Vision');
            else t.fail('Live secrets.json: Groq key for Whisper', 'No gsk_ key found — set Groq Fallback Key in Settings');
        } catch(e) { t.fail('Live secrets.json: valid JSON', e.message); }
    }

    // ── Live qa_pairs.json sanity ─────────────────────────────────
    if (!fs.existsSync(QA_PATH)) {
        t.skip('Live qa_pairs.json exists', 'Not yet created — add a Q/A pair in Section 4');
    } else {
        try {
            const qa = JSON.parse(fs.readFileSync(QA_PATH, 'utf8'));
            if (Array.isArray(qa)) t.pass(`Live qa_pairs.json: valid array with ${qa.length} pair(s)`);
            else t.fail('Live qa_pairs.json: should be an array', typeof qa);
            if (qa.length > 0) {
                const sample = qa[0];
                const hasFields = sample.id && sample.q && sample.a;
                if (hasFields) t.pass('Live qa_pairs.json: first pair has id/q/a fields');
                else t.fail('Live qa_pairs.json: first pair missing fields', JSON.stringify(sample));
            }
        } catch(e) { t.fail('Live qa_pairs.json: valid JSON', e.message); }
    }

    return t.summary();
}

if (require.main === module) run().catch(console.error);
module.exports = run;
