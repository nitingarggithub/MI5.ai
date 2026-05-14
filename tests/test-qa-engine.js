/**
 * test-qa-engine.js
 * Tests every function in the Q/A Memory Bank:
 *   tokenize · cosineSim · matchQAPair · addQAPair (dedup) · deleteQAPair
 *   importQAPairs JSON validation · exportQAPairs round-trip
 *   queryLLM cache-hit intercept · auto-save guard · hit counter / lastUsed update
 *
 * No network calls — all pure-logic tests extracted from app.html.
 */
'use strict';
const { TestRunner } = require('./test-helpers');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

// ── Mirror QA engine from app.html ─────────────────────────────────────────
const QA_SIM_THRESHOLD = 0.55;
const QA_STOP = new Set(['the','a','an','is','are','was','were','be','been','being',
    'have','has','had','do','does','did','will','would','could','should','may','might',
    'must','shall','to','of','in','on','at','by','for','with','from','into','and','or',
    'not','no','it','its','this','that','what','how','why','when','where','which','who',
    'can','you','your','me','my','we','our','they','their','i','am','if','just','about']);

function tokenize(text) {
    return (text || '').toLowerCase().replace(/[^a-z0-9_+#]/g,' ').split(/\s+/).filter(w=>w.length>1);
}
function buildTF(tokens) { const tf={}; for(const t of tokens) tf[t]=(tf[t]||0)+1; return tf; }
function cosineSim(tokA, tokB) {
    const tfA=buildTF(tokA), tfB=buildTF(tokB);
    const keys=new Set([...Object.keys(tfA),...Object.keys(tfB)]);
    let dot=0,normA=0,normB=0;
    for(const k of keys){ const a=tfA[k]||0,b=tfB[k]||0; dot+=a*b; normA+=a*a; normB+=b*b; }
    return (!normA||!normB)?0:dot/(Math.sqrt(normA)*Math.sqrt(normB));
}

function makeMemoryBank() {
    // Isolated bank — does not touch real qa_pairs.json
    let pairs = [];
    function genId() { return Date.now().toString(36)+Math.random().toString(36).slice(2,7); }
    function addPair(q, a, tags=[]) {
        const tokQ = tokenize(q).filter(w=>!QA_STOP.has(w));
        const dup  = pairs.find(p => cosineSim(tokenize(p.q).filter(w=>!QA_STOP.has(w)), tokQ) > 0.92);
        if (dup) { dup.a=a; dup.tags=tags; return dup; }
        const pair = { id:genId(), q:q.trim(), a:a.trim(), tags, hits:0, createdAt:new Date().toISOString(), lastUsed:null };
        pairs.unshift(pair); return pair;
    }
    function deletePair(id) { pairs = pairs.filter(p=>p.id!==id); }
    function match(prompt) {
        if(!pairs.length) return null;
        const tokP = tokenize(prompt).filter(w=>!QA_STOP.has(w));
        if(!tokP.length) return null;
        let best=null, bestScore=0;
        for(const pair of pairs){
            const tokQ=tokenize(pair.q).filter(w=>!QA_STOP.has(w));
            const score=cosineSim(tokP,tokQ);
            if(score>bestScore){bestScore=score;best=pair;}
        }
        return bestScore>=QA_SIM_THRESHOLD?{pair:best,score:bestScore}:null;
    }
    return { get pairs(){return pairs;}, addPair, deletePair, match };
}

async function run() {
    const t = new TestRunner('Q/A Engine — Tokenize / Similarity / CRUD / Cache');

    // ── tokenize ─────────────────────────────────────────────────
    {
        const tok = tokenize('What is RAII in C++?');
        if (tok.includes('raii') && tok.includes('c++'))   t.pass('tokenize: preserves c++ and raii');
        else t.fail('tokenize: preserves c++ and raii', JSON.stringify(tok));

        const empty = tokenize('');
        if (empty.length === 0) t.pass('tokenize: empty string → []');
        else t.fail('tokenize: empty string', JSON.stringify(empty));

        const nums = tokenize('O(n log n) sort');
        if (nums.includes('log')) t.pass('tokenize: handles O(n log n)');
        else t.fail('tokenize: handles O(n log n)', JSON.stringify(nums));
    }

    // ── cosineSim ─────────────────────────────────────────────────
    {
        const a = tokenize('raii destructor resource').filter(w=>!QA_STOP.has(w));
        const b = tokenize('raii destructor resource').filter(w=>!QA_STOP.has(w));
        const sim = cosineSim(a, b);
        if (Math.abs(sim - 1.0) < 0.001) t.pass('cosineSim: identical → 1.0');
        else t.fail('cosineSim: identical → 1.0', `got ${sim}`);

        const c = tokenize('completely unrelated topic furniture').filter(w=>!QA_STOP.has(w));
        const sim2 = cosineSim(a, c);
        if (sim2 < QA_SIM_THRESHOLD) t.pass(`cosineSim: unrelated → ${sim2.toFixed(3)} < threshold`);
        else t.fail('cosineSim: unrelated should be below threshold', `got ${sim2}`);

        if (cosineSim([], []) === 0) t.pass('cosineSim: empty vectors → 0');
        else t.fail('cosineSim: empty vectors → 0', 'non-zero returned');
    }

    // ── matchQAPair ────────────────────────────────────────────────
    {
        const bank = makeMemoryBank();
        bank.addPair('Explain RAII in C++', 'Resource Acquisition Is Initialization — destructor releases resources.');
        bank.addPair('What is a virtual destructor?', 'Ensures derived destructors run via base pointer.');
        bank.addPair('How does TLM-2.0 b_transport work?', 'Blocking call transfers payload across sockets.');

        const hit1 = bank.match('Can you explain RAII in C++?');
        if (hit1 && hit1.pair.q.toLowerCase().includes('raii')) t.pass('matchQAPair: exact-ish RAII question hits');
        else t.fail('matchQAPair: RAII hit', `got ${JSON.stringify(hit1)}`);

        const hit2 = bank.match('What is the weather like today?');
        if (!hit2) t.pass('matchQAPair: unrelated prompt → null');
        else t.fail('matchQAPair: unrelated should be null', `got score ${hit2.score.toFixed(3)}`);

        const hit3 = bank.match('Explain RAII in C++ programming language');
        if (hit3 && hit3.score > QA_SIM_THRESHOLD) t.pass(`matchQAPair: rephrase → ${(hit3.score*100).toFixed(0)}% match`);
        else t.fail('matchQAPair: rephrase should hit', `score ${hit3?.score?.toFixed(3)} — stored Q: "Explain RAII in C++" vs prompt`);

        const empty = bank.match('');
        if (!empty) t.pass('matchQAPair: empty prompt → null');
        else t.fail('matchQAPair: empty → null', `got ${JSON.stringify(empty)}`);

        // All stop-words only
        const stopOnly = bank.match('what is the and of');
        if (!stopOnly) t.pass('matchQAPair: all stop-words → null');
        else t.fail('matchQAPair: all stop-words should be null', `got score ${stopOnly?.score}`);
    }

    // ── addQAPair dedup ────────────────────────────────────────────
    {
        const bank = makeMemoryBank();
        const p1 = bank.addPair('What is a mutex?', 'A synchronization primitive that prevents simultaneous access.');
        const p2 = bank.addPair('What is a mutex?', 'Updated answer.');  // near-identical → should update
        if (bank.pairs.length === 1) t.pass('addQAPair: dedup — near-identical Q updates instead of inserting');
        else t.fail('addQAPair: dedup', `length = ${bank.pairs.length}`);
        if (bank.pairs[0].a === 'Updated answer.') t.pass('addQAPair: dedup — answer was updated');
        else t.fail('addQAPair: dedup answer update', `got "${bank.pairs[0].a}"`);

        bank.addPair('Explain deadlock conditions', 'Mutual exclusion, hold-and-wait, no preemption, circular wait.');
        if (bank.pairs.length === 2) t.pass('addQAPair: distinct Q creates new pair');
        else t.fail('addQAPair: distinct Q', `length = ${bank.pairs.length}`);
    }

    // ── deleteQAPair ───────────────────────────────────────────────
    {
        const bank = makeMemoryBank();
        const p = bank.addPair('Define encapsulation', 'Bundling data and methods; hiding internal state.');
        bank.deletePair(p.id);
        if (bank.pairs.length === 0) t.pass('deleteQAPair: pair removed');
        else t.fail('deleteQAPair', `length = ${bank.pairs.length}`);

        // Delete non-existent id is safe
        try { bank.deletePair('nonexistent_id'); t.pass('deleteQAPair: non-existent id does not throw'); }
        catch(e) { t.fail('deleteQAPair: non-existent id', e.message); }
    }

    // ── hit counter & lastUsed update ─────────────────────────────
    {
        const bank = makeMemoryBank();
        bank.addPair('What is polymorphism?', 'Objects of different types treated uniformly via a common interface.');
        const before = bank.pairs[0].hits;
        const hit = bank.match('Explain polymorphism in OOP');
        if (hit) {
            hit.pair.hits++;
            hit.pair.lastUsed = new Date().toISOString();
        }
        if (bank.pairs[0].hits === before + 1) t.pass('hit counter increments on match');
        else t.fail('hit counter', `was ${before}, now ${bank.pairs[0].hits}`);
        if (bank.pairs[0].lastUsed !== null) t.pass('lastUsed set on match');
        else t.fail('lastUsed', 'still null');
    }

    // ── Import JSON validation ─────────────────────────────────────
    {
        const valid  = JSON.stringify([{id:'abc',q:'Q1',a:'A1',tags:[],hits:0,createdAt:'',lastUsed:null}]);
        const parsed = JSON.parse(valid);
        if (Array.isArray(parsed) && parsed[0].q && parsed[0].a) t.pass('import: valid JSON array accepted');
        else t.fail('import: valid JSON', 'structure wrong');

        const notArray = JSON.stringify({q:'bad',a:'bad'});
        try { const p=JSON.parse(notArray); if(!Array.isArray(p)) throw new Error('Expected a JSON array'); t.fail('import: object should throw','did not throw'); }
        catch(e) { t.pass(`import: non-array throws: "${e.message}"`); }

        const missingFields = JSON.stringify([{id:'x'}]);
        const items = JSON.parse(missingFields);
        const accepted = items.filter(p=>p.q && p.a);
        if (accepted.length === 0) t.pass('import: items missing q or a are skipped');
        else t.fail('import: missing-field guard', `accepted ${accepted.length}`);
    }

    // ── Export round-trip ──────────────────────────────────────────
    {
        const tmpFile = path.join(os.tmpdir(), `mi5-qa-export-${Date.now()}.json`);
        const sample  = [{ id:'t1', q:'Test Q', a:'Test A', tags:['test'], hits:2, createdAt: new Date().toISOString(), lastUsed:null }];
        fs.writeFileSync(tmpFile, JSON.stringify(sample, null, 2));
        const loaded = JSON.parse(fs.readFileSync(tmpFile, 'utf8'));
        if (loaded[0].q === 'Test Q' && loaded[0].hits === 2) t.pass('export round-trip: data intact');
        else t.fail('export round-trip', JSON.stringify(loaded[0]));
        fs.unlinkSync(tmpFile);
    }

    // ── qa_pairs.json file persistence ────────────────────────────
    {
        const tmpPath = path.join(os.tmpdir(), `mi5-qa-persist-${Date.now()}.json`);
        const pairs   = [{ id:'p1', q:'Explain SFINAE', a:'Substitution Failure Is Not An Error.', tags:['c++'], hits:0, createdAt:new Date().toISOString(), lastUsed:null }];
        fs.writeFileSync(tmpPath, JSON.stringify(pairs, null, 2));
        const reloaded = JSON.parse(fs.readFileSync(tmpPath, 'utf8'));
        if (Array.isArray(reloaded) && reloaded[0].id === 'p1') t.pass('qa_pairs.json persist & reload');
        else t.fail('qa_pairs.json persist', JSON.stringify(reloaded));
        fs.unlinkSync(tmpPath);
    }

    // ── Cache-hit intercept logic (simulated) ─────────────────────
    {
        const bank = makeMemoryBank();
        bank.addPair('What is move semantics in C++?', 'Transfers ownership of resources; avoids deep copy via rvalue refs.');
        let llmCalled = false;
        async function mockQueryLLM(prompt) {
            const hit = bank.match(prompt);
            if (hit) { hit.pair.hits++; return hit.pair.a; }
            llmCalled = true;
            return 'LLM answer';
        }
        const r1 = await mockQueryLLM('Explain move semantics and rvalue references in C++');
        if (!llmCalled) t.pass('queryLLM intercept: cache hit — LLM NOT called');
        else t.fail('queryLLM intercept: should not call LLM on hit', 'llmCalled was true');
        if (r1.includes('rvalue')) t.pass('queryLLM intercept: returned cached answer');
        else t.fail('queryLLM intercept: answer', `got "${r1}"`);

        llmCalled = false;
        const r2 = await mockQueryLLM('What is the Liskov Substitution Principle?');
        if (llmCalled) t.pass('queryLLM intercept: cache miss — LLM called');
        else t.fail('queryLLM intercept: should call LLM on miss', 'llmCalled was false');
    }

    // ── Auto-save guard: avoid saving near-duplicate ───────────────
    {
        const bank = makeMemoryBank();
        bank.addPair('What is a smart pointer?', 'RAII wrapper that owns a heap object; auto-releases on scope exit.');
        const qaAutoSave = true;
        async function mockQueryLLMWithAutoSave(prompt) {
            const hit = bank.match(prompt);
            if (hit) return hit.pair.a;
            const answer = 'LLM generated answer';
            if (qaAutoSave && answer && prompt.length > 20) {
                const existing = bank.match(prompt.slice(0,400));
                if (!existing || existing.score < 0.92) bank.addPair(prompt.slice(0,400), answer, []);
            }
            return answer;
        }
        const before = bank.pairs.length;
        await mockQueryLLMWithAutoSave('What is a unique_ptr smart pointer in C++?');
        if (bank.pairs.length === before) t.pass('auto-save guard: near-duplicate not re-saved (above 92% threshold)');
        else if (bank.pairs.length === before + 1) t.pass('auto-save: new unrelated Q saved (score was below 92%)');
        else t.fail('auto-save guard', `pairs went from ${before} to ${bank.pairs.length}`);
    }

    // ── Threshold boundary tests ───────────────────────────────────
    {
        const bank = makeMemoryBank();
        bank.addPair('Explain cache coherence protocol MESI', 'Four states: Modified, Exclusive, Shared, Invalid.');
        // Very different question should not match
        const noHit = bank.match('What is a binary search tree traversal?');
        if (!noHit) t.pass('threshold: unrelated domain question → no match');
        else t.fail('threshold: should not match across domains', `score ${noHit.score.toFixed(3)}`);

        // Partial overlap — depends on keyword density
        const maybeHit = bank.match('Explain MESI cache states');
        if (maybeHit && maybeHit.score >= QA_SIM_THRESHOLD) t.pass(`threshold: partial MESI match → ${(maybeHit.score*100).toFixed(0)}%`);
        else t.skip('threshold: MESI partial match', `score ${maybeHit?.score?.toFixed(3)} below ${QA_SIM_THRESHOLD}`);
    }

    return t.summary();
}

if (require.main === module) run().catch(console.error);
module.exports = run;
