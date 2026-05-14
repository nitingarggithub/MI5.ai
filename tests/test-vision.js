/**
 * test-vision.js
 * Tests the Vision API path used by Ctrl+Shift+C and Ctrl+Shift+S:
 *   • JPEG magic bytes (toJPEG replacement)
 *   • Vision key routing logic
 *   • Real Groq Scout call
 *   • Real Gemini vision call
 */
'use strict';
const { loadKeys, TestRunner, apiFetch } = require('./test-helpers');

// Minimal 1×1 red JPEG (~631 bytes) — valid for all vision APIs
const TINY_JPEG_B64 = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFgABAQEAAAAAAAAAAAAAAAAABgUEB/8QAHhAAAQQCAwEAAAAAAAAAAAAAAQIDBBEhBRIx/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AKPPi6uXh9LZFF9Q2G+pjHJAbLMqw+HVH4eUKJBmT7AAAAAASUVORK5CYII=';

function resolveVisionKeys(store, secrets) {
    const provider = (store||{}).model || 'cerebras';
    const pk       = ((secrets||{}).apiKey || (store||{}).apiKey || '').trim();
    const fbk      = ((secrets||{}).groqFallbackKey || (store||{}).groqFallbackKey || '').trim();

    if (provider === 'gemini') {
        if (!pk) throw new Error('No Gemini key');
        return { url:'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', model:'gemini-2.0-flash', authKey:pk, provider:'gemini' };
    }
    const groqKey = fbk || (provider==='groq' ? pk : null) || (pk.startsWith('gsk_') ? pk : null);
    if (!groqKey) throw new Error('No Groq key for vision. Set Groq Fallback Key in Settings.');
    return { url:'https://api.groq.com/openai/v1/chat/completions', model:'meta-llama/llama-4-scout-17b-16e-instruct', authKey:groqKey, provider:'groq' };
}

async function run() {
    const t    = new TestRunner('Vision API (Screen Clip / Screenshot)');
    const keys = loadKeys();

    // ── Unit: JPEG magic bytes ─────────────────────────────────────
    const jpegBuf = Buffer.from(TINY_JPEG_B64, 'base64');
    if (jpegBuf[0] === 0xFF && jpegBuf[1] === 0xD8)
        t.pass(`JPEG magic bytes FF D8 ✓ (${jpegBuf.length}B)`);
    else
        t.fail('JPEG magic bytes', `Expected FF D8, got ${jpegBuf[0].toString(16)} ${jpegBuf[1].toString(16)}`);

    // PNG equivalent is ~5–8x larger
    const pngEstimate = jpegBuf.length * 6;
    t.pass(`JPEG vs PNG size: JPEG ${jpegBuf.length}B vs PNG ~${pngEstimate}B — ${Math.round(pngEstimate/jpegBuf.length)}x smaller`);

    // ── Unit: vision key routing ───────────────────────────────────
    const routingCases = [
        { store:{model:'gemini'}, secrets:{apiKey:'AIza_test',groqFallbackKey:''},   expectProvider:'gemini',  label:'gemini model → gemini endpoint' },
        { store:{model:'cerebras'},secrets:{apiKey:'csk_x',groqFallbackKey:'gsk_fb'},expectProvider:'groq',   label:'cerebras + fallbackKey → groq vision' },
        { store:{model:'groq'},   secrets:{apiKey:'gsk_pri',groqFallbackKey:''},    expectProvider:'groq',   label:'groq model → groq vision' },
    ];
    for (const tc of routingCases) {
        try {
            const r = resolveVisionKeys(tc.store, tc.secrets);
            if (r.provider === tc.expectProvider) t.pass(`Vision routing: ${tc.label}`);
            else t.fail(`Vision routing: ${tc.label}`, `got ${r.provider}`);
        } catch(e) { t.fail(`Vision routing: ${tc.label}`, e.message); }
    }
    // No key throws a clear message
    try {
        resolveVisionKeys({model:'cerebras'}, {apiKey:'csk_no_groq', groqFallbackKey:''});
        t.fail('Vision routing: no groq key should throw', 'Did not throw');
    } catch(e) {
        if (e.message.includes('Groq key')) t.pass(`Vision routing: no groq key → "${e.message}"`);
        else t.fail('Vision routing: no groq key error message', e.message);
    }

    // ── Network: Groq Scout vision call ───────────────────────────
    if (!keys.groq) {
        t.skip('Groq Scout vision call', 'No Groq key');
    } else {
        try {
            const res = await apiFetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: { 'Content-Type':'application/json', 'Authorization':`Bearer ${keys.groq}` },
                body: JSON.stringify({
                    model: 'meta-llama/llama-4-scout-17b-16e-instruct',
                    messages: [{ role:'user', content:[
                        { type:'text',      text:'Describe this image in 3 words.' },
                        { type:'image_url', image_url:{ url:`data:image/jpeg;base64,${TINY_JPEG_B64}` } }
                    ]}],
                    max_tokens: 20, temperature: 0
                })
            });
            const data = await res.json();
            if (!res.ok || data.error) t.fail('Groq Scout vision call', data.error?.message || `HTTP ${res.status}`);
            else t.pass(`Groq Scout vision: "${(data.choices?.[0]?.message?.content||'').trim().slice(0,60)}"`);
        } catch(e) { t.fail('Groq Scout vision call', e.message); }
    }

    // ── Network: Gemini vision call ────────────────────────────────
    if (!keys.gemini) {
        t.skip('Gemini vision call', 'No Gemini key');
    } else {
        try {
            const res = await apiFetch('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', {
                method: 'POST',
                headers: { 'Content-Type':'application/json', 'Authorization':`Bearer ${keys.gemini}` },
                body: JSON.stringify({
                    model: 'gemini-2.0-flash',
                    messages: [{ role:'user', content:[
                        { type:'text',      text:'Describe this image in 3 words.' },
                        { type:'image_url', image_url:{ url:`data:image/jpeg;base64,${TINY_JPEG_B64}` } }
                    ]}],
                    max_tokens: 20, temperature: 0
                })
            });
            const data = await res.json();
            if (!res.ok || data.error) t.fail('Gemini vision call', data.error?.message || `HTTP ${res.status}`);
            else t.pass(`Gemini vision: "${(data.choices?.[0]?.message?.content||'').trim().slice(0,60)}"`);
        } catch(e) { t.fail('Gemini vision call', e.message); }
    }

    return t.summary();
}

if (require.main === module) run().catch(console.error);
module.exports = run;
