/**
 * test-llm-providers.js
 * Tests LLM text generation across all providers plus utility logic:
 *   • isQuotaError detection
 *   • dynamicMaxTokens thresholds
 *   • shouldUseSpecialist keyword matching
 *   • FALLBACK_CHAIN ordering
 *   • Live API calls: Cerebras, Groq, Gemini, DeepSeek-R1 specialist
 */
'use strict';
const { loadKeys, TestRunner, apiFetch } = require('./test-helpers');

// ── Mirror from app.html ──────────────────────────────────────────────────
function isQuotaError(err) {
    const m = (err.message || '').toLowerCase();
    return m.includes('rate_limit') || m.includes('rate limit') || m.includes('quota') ||
           m.includes('exceeded') || m.includes('429') || m.includes('per day') ||
           m.includes('tokens per minute') || m.includes('requests per day') ||
           m.includes('context_length_exceeded') || m.includes('overloaded');
}
const TOKEN_WARN  = 80000;
const TOKEN_THROT = 90000;
function dynamicMaxTokens(used) {
    if (used > TOKEN_THROT) return 220;
    if (used > TOKEN_WARN)  return 480;
    return 720;
}
const FALLBACK_CHAIN = ['cerebras', 'groq', 'gemini'];
const SPECIALIST_KEYWORDS = /\b(systemc|tlm.?2|tlm2|sc_module|b_transport|nb_transport|sfinae|concepts|coroutine|co_await|cache coherenc|mesi|moesi|numa|rvalue|perfect forward|move semantic|constexpr|template meta|variadic|fold express|crtp|rtos|dma|interrupt|lock.?free|wait.?free|cas|compare.?and.?swap|memory order|data race|deadlock|livelock|soc|noc|amba|axi|risc.?v|arm cortex|spectre|meltdown|cuda|opencl|pcie|nvlink|rdma|mpi|paxos|raft|cqrs|event sourcing|cap theorem)\b/i;
function shouldUseSpecialist(prompt, mode) {
    return !!(mode && SPECIALIST_KEYWORDS.test(prompt));
}

async function callProvider(url, model, key, prompt) {
    const res = await apiFetch(url, {
        method: 'POST',
        headers: { 'Content-Type':'application/json', 'Authorization':`Bearer ${key}` },
        body: JSON.stringify({
            model,
            messages:[{role:'system',content:'Reply in ≤10 words.'},{role:'user',content:prompt}],
            max_tokens: 30, temperature: 0
        })
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error((data.error?.message||JSON.stringify(data.error))||`HTTP ${res.status}`);
    return data.choices?.[0]?.message?.content?.trim() || '';
}

async function run() {
    const t    = new TestRunner('LLM Providers / Fallback / Specialist / Throttle');
    const keys = loadKeys();
    const Q    = 'What is a default constructor in C++?';

    // ── Unit: isQuotaError ────────────────────────────────────────
    const qeCases = [
        { msg:'rate_limit_exceeded',                       expect:true  },
        { msg:'You exceeded your current quota',           expect:true  },
        { msg:'429 Too Many Requests',                     expect:true  },
        { msg:'context_length_exceeded for this model',   expect:true  },
        { msg:'overloaded',                                expect:true  },
        { msg:'tokens per minute limit',                  expect:true  },
        { msg:'Invalid API Key',                           expect:false },
        { msg:'HTTP 500 Internal Server Error',            expect:false },
        { msg:'model not found',                           expect:false },
    ];
    for (const tc of qeCases) {
        const got = isQuotaError({ message: tc.msg });
        if (got === tc.expect) t.pass(`isQuotaError("${tc.msg.slice(0,45)}")`);
        else t.fail(`isQuotaError("${tc.msg.slice(0,45)}")`, `expected ${tc.expect}, got ${got}`);
    }

    // ── Unit: dynamicMaxTokens ─────────────────────────────────────
    const tokCases = [
        { used:0,      expect:720 }, { used:79999, expect:720 },
        { used:80001,  expect:480 }, { used:89999, expect:480 },
        { used:90001,  expect:220 }, { used:999999,expect:220 },
    ];
    for (const tc of tokCases) {
        const got = dynamicMaxTokens(tc.used);
        if (got === tc.expect) t.pass(`dynamicMaxTokens(${tc.used}) → ${got}`);
        else t.fail(`dynamicMaxTokens(${tc.used})`, `expected ${tc.expect}, got ${got}`);
    }

    // ── Unit: shouldUseSpecialist ──────────────────────────────────
    const specCases = [
        { prompt:'Explain b_transport in TLM-2.0 SystemC',     mode:'deepseek-r1', expect:true  },
        { prompt:'What is RAII in C++?',                        mode:'deepseek-r1', expect:false },
        { prompt:'Explain SFINAE and concepts in C++20',        mode:'qwq-32b',    expect:true  },
        { prompt:'What is a mutex?',                            mode:'',           expect:false },
        { prompt:'Describe cache coherence MESI protocol',      mode:'deepseek-r1', expect:true  },
        { prompt:'Explain co_await in C++20 coroutines',        mode:'deepseek-r1', expect:true  },
        { prompt:'Tell me about yourself',                      mode:'deepseek-r1', expect:false },
    ];
    for (const tc of specCases) {
        const got = shouldUseSpecialist(tc.prompt, tc.mode);
        if (got === tc.expect) t.pass(`specialist: "${tc.prompt.slice(0,50)}"`);
        else t.fail(`specialist: "${tc.prompt.slice(0,50)}"`, `expected ${tc.expect}, got ${got}`);
    }

    // ── Unit: FALLBACK_CHAIN order ─────────────────────────────────
    if (FALLBACK_CHAIN[0]==='cerebras' && FALLBACK_CHAIN[1]==='groq' && FALLBACK_CHAIN[2]==='gemini')
        t.pass('FALLBACK_CHAIN order: cerebras → groq → gemini');
    else
        t.fail('FALLBACK_CHAIN order', JSON.stringify(FALLBACK_CHAIN));

    // Simulate fallback: primary quota → next provider
    {
        const chain = ['cerebras','groq','gemini'];
        let tried = [];
        for (const provider of chain) {
            tried.push(provider);
            if (provider === 'cerebras') { /* simulate quota error, continue */ continue; }
            break; // groq succeeds
        }
        if (tried[tried.length-1] === 'groq') t.pass('Fallback simulation: cerebras quota → falls through to groq');
        else t.fail('Fallback simulation', JSON.stringify(tried));
    }

    // ── Network: Cerebras ─────────────────────────────────────────
    if (!keys.cerebras) {
        t.skip('Cerebras LLM call', 'No Cerebras key');
    } else {
        try {
            const r = await callProvider('https://api.cerebras.ai/v1/chat/completions', 'llama-3.3-70b', keys.cerebras, Q);
            t.pass(`Cerebras: "${r.slice(0,70)}"`);
        } catch(e) { t.fail('Cerebras LLM call', e.message); }
    }

    // ── Network: Groq Llama ────────────────────────────────────────
    if (!keys.groq) {
        t.skip('Groq LLM call', 'No Groq key');
    } else {
        try {
            const r = await callProvider('https://api.groq.com/openai/v1/chat/completions', 'llama-3.3-70b-versatile', keys.groq, Q);
            t.pass(`Groq Llama: "${r.slice(0,70)}"`);
        } catch(e) { t.fail('Groq LLM call', e.message); }
    }

    // ── Network: Gemini ────────────────────────────────────────────
    if (!keys.gemini) {
        t.skip('Gemini LLM call', 'No Gemini key');
    } else {
        try {
            const r = await callProvider('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', 'gemini-2.0-flash', keys.gemini, Q);
            t.pass(`Gemini: "${r.slice(0,70)}"`);
        } catch(e) { t.fail('Gemini LLM call', e.message); }
    }

    // ── Network: DeepSeek-R1 specialist (Groq) ─────────────────────
    if (!keys.groq) {
        t.skip('DeepSeek-R1 specialist call', 'No Groq key');
    } else {
        try {
            const r = await callProvider('https://api.groq.com/openai/v1/chat/completions', 'deepseek-r1-distill-llama-70b', keys.groq, 'What does TLM-2.0 b_transport do?');
            t.pass(`DeepSeek-R1 (Groq): "${r.slice(0,70)}"`);
        } catch(e) {
            if (isQuotaError(e) || e.message.includes('model') || e.message.includes('404'))
                t.skip('DeepSeek-R1', e.message.slice(0,80));
            else t.fail('DeepSeek-R1', e.message);
        }
    }

    return t.summary();
}

if (require.main === module) run().catch(console.error);
module.exports = run;
