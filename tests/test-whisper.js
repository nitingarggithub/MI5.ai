/**
 * test-whisper.js
 * Tests Whisper STT feature:
 *   • getWhisperApiKey resolution logic
 *   • hallucination filter (unit)
 *   • buildWhisperPrompt format
 *   • real Groq Whisper API call with minimal WAV
 */
'use strict';
const { loadKeys, TestRunner, apiFetch } = require('./test-helpers');

// ── Mirror hallucination filter from app.html ─────────────────────────────
const HALLUCINATION_SUBSTR = ['subscribe','thank you for watching','thanks for watching',
    'see you in the next','like and comment','like and subscribe','transcribed by','amara.org',
    'importance of currency','concept of the universe','can you see my face','music playing',
    'applause','subtitle','closed captioning','copyright','all rights reserved'];
function isLikelyWhisperHallucination(text) {
    const t = (text||'').toLowerCase();
    if (!t.trim()) return true;
    for (const sub of HALLUCINATION_SUBSTR) if (t.includes(sub)) return true;
    if (/^\s*(hi|hello|hey)\b[^.]{0,80}\bhow are you\b/i.test(t) && t.length < 120 &&
        !/(copy|constructor|class|template|pointer|virtual|override)/i.test(t)) return true;
    return false;
}

// ── Mirror getWhisperApiKey from app.html ─────────────────────────────────
function getWhisperApiKey(store, secrets) {
    const fbk = ((secrets||{}).groqFallbackKey || (store||{}).groqFallbackKey || '').trim();
    if (fbk) return fbk;
    const model = (store||{}).model || 'cerebras';
    const pk    = ((secrets||{}).apiKey || (store||{}).apiKey || '').trim();
    if (model === 'groq') return pk;
    if (pk.startsWith('gsk_')) return pk;
    return null;
}

// ── Minimal WAV: 16 kHz mono PCM 16-bit, 1.2 s silence (~>4800 bytes) ────
function makeWav(durationSecs = 1.2) {
    const sr = 16000, n = Math.floor(sr * durationSecs), dataSize = n * 2;
    const buf = Buffer.alloc(44 + dataSize, 0);
    buf.write('RIFF', 0); buf.writeUInt32LE(36 + dataSize, 4); buf.write('WAVE', 8);
    buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
    buf.writeUInt16LE(1, 22); buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr*2, 28);
    buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36);
    buf.writeUInt32LE(dataSize, 40);
    return buf;
}

async function run() {
    const t    = new TestRunner('Whisper STT Feature');
    const keys = loadKeys();

    // ── Unit: hallucination filter ─────────────────────────────────
    const halluCases = [
        { text: '',                                     expected: true,  label: 'empty → hallucination' },
        { text: 'thanks for watching',                  expected: true,  label: 'youtube phrase' },
        { text: 'Please subscribe to the channel.',    expected: true,  label: 'subscribe phrase' },
        { text: 'Hi how are you doing?',               expected: true,  label: 'short greeting' },
        { text: 'What is a virtual destructor in C++?',expected: false, label: 'real technical Q' },
        { text: 'Explain RAII and copy constructor.',  expected: false, label: 'C++ keyword present — not hallucination' },
        { text: 'closed captioning provided by',       expected: true,  label: 'closed captioning phrase' },
    ];
    for (const tc of halluCases) {
        const got = isLikelyWhisperHallucination(tc.text);
        if (got === tc.expected) t.pass(`Hallucination filter: ${tc.label}`);
        else t.fail(`Hallucination filter: ${tc.label}`, `expected ${tc.expected}, got ${got} for: "${tc.text}"`);
    }

    // ── Unit: getWhisperApiKey resolution ──────────────────────────
    const keyScenarios = [
        { store:{model:'cerebras',apiKey:'csk_abc'}, secrets:{groqFallbackKey:'gsk_fb',apiKey:'csk_abc'}, expected:'gsk_fb',    label:'fallbackKey preferred' },
        { store:{model:'groq',    apiKey:''},        secrets:{groqFallbackKey:'',       apiKey:'gsk_pri'}, expected:'gsk_pri',   label:'model=groq uses primary' },
        { store:{model:'cerebras',apiKey:''},        secrets:{groqFallbackKey:'',       apiKey:'gsk_looks'},expected:'gsk_looks',label:'gsk_ prefix on primary OK' },
        { store:{model:'cerebras',apiKey:''},        secrets:{groqFallbackKey:'',       apiKey:'csk_nope'}, expected:null,       label:'no groq key → null' },
    ];
    for (const sc of keyScenarios) {
        const got = getWhisperApiKey(sc.store, sc.secrets);
        if (got === sc.expected) t.pass(`Key resolution: ${sc.label}`);
        else t.fail(`Key resolution: ${sc.label}`, `expected "${sc.expected}", got "${got}"`);
    }

    // ── Unit: WAV buffer size ──────────────────────────────────────
    const wav = makeWav(1.2);
    const WHISPER_MIN_BLOB_BYTES = 4800;
    if (wav.length > WHISPER_MIN_BLOB_BYTES) t.pass(`WAV size: ${wav.length}B > ${WHISPER_MIN_BLOB_BYTES} minimum`);
    else t.fail('WAV minimum size', `${wav.length}B is below threshold`);
    if (wav[0] === 0x52 && wav[1] === 0x49) t.pass('WAV magic bytes: RIFF header valid');
    else t.fail('WAV magic bytes', `${wav[0].toString(16)} ${wav[1].toString(16)}`);

    // ── Unit: buildWhisperPrompt characteristics ───────────────────
    function buildPrompt(store, tail = '') {
        const base = 'Technical software engineering job interview. Interviewer asks about programming: C++ copy constructor move semantics RAII STL algorithms Python async. ';
        const jd   = (store.jdContext  ||'').replace(/\s+/g,' ').trim().slice(0,220);
        const dom  = (store.domainContext||'').replace(/\s+/g,' ').trim().slice(0,220);
        let p = base + jd + ' ' + dom;
        if (tail) p += ' Continuation after: ' + tail;
        return p.trim().slice(0,750);
    }
    const p1 = buildPrompt({ jdContext:'SystemC engineer',domainContext:'TLM-2.0 sockets' });
    if (p1.length <= 750) t.pass(`buildWhisperPrompt: length ${p1.length} ≤ 750`);
    else t.fail('buildWhisperPrompt: length', `${p1.length} > 750`);
    if (p1.includes('SystemC') && p1.includes('TLM-2.0')) t.pass('buildWhisperPrompt: JD/domain injected');
    else t.fail('buildWhisperPrompt: JD/domain', p1.slice(0,100));

    // ── Network: Groq Whisper API call ─────────────────────────────
    if (!keys.groq) {
        t.skip('Whisper API call', 'No Groq key — set in test-config.json or Settings → Groq Fallback Key');
    } else {
        const wavBuf  = makeWav(1.5);
        const boundary = '----Mi5WavBoundary' + Date.now();
        const CRLF     = '\r\n';
        const header   = [
            `--${boundary}${CRLF}Content-Disposition: form-data; name="model"${CRLF}${CRLF}whisper-large-v3`,
            `--${boundary}${CRLF}Content-Disposition: form-data; name="language"${CRLF}${CRLF}en`,
            `--${boundary}${CRLF}Content-Disposition: form-data; name="temperature"${CRLF}${CRLF}0`,
            `--${boundary}${CRLF}Content-Disposition: form-data; name="response_format"${CRLF}${CRLF}json`,
        ].map(s => s + CRLF).join('');
        const filePart = `--${boundary}${CRLF}Content-Disposition: form-data; name="file"; filename="chunk.wav"${CRLF}Content-Type: audio/wav${CRLF}${CRLF}`;
        const body = Buffer.concat([Buffer.from(header + filePart), wavBuf, Buffer.from(`${CRLF}--${boundary}--${CRLF}`)]);

        try {
            const res  = await apiFetch('https://api.groq.com/openai/v1/audio/transcriptions', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${keys.groq}`, 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': body.length },
                body
            });
            const data = await res.json();
            if (!res.ok) {
                t.fail('Whisper API call', data.error?.message || `HTTP ${res.status}`);
            } else {
                t.pass('Whisper API call: HTTP 200');
                const raw = (data.text || '').trim();
                const filtered = isLikelyWhisperHallucination(raw) ? '' : raw;
                t.pass(`Whisper response: "${raw||'(empty — correct for silence)'}" → filtered: "${filtered||'(suppressed)'}"`);
            }
        } catch(e) { t.fail('Whisper API call', e.message); }
    }

    return t.summary();
}

if (require.main === module) run().catch(console.error);
module.exports = run;
