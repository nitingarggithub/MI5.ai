/**
 * MI5.ai Full Test Suite
 * Unit tests for core application logic.
 */

const assert = require('assert');

// --- Mocking logic from app.html ---

const Q_STARTERS = /\b(how|what|why|when|where|explain|describe|implement|write|design|tell me|can you|could you|walk me through|what's|what is|how does|how would|have you|do you|are you|which|define|compare|difference between|tradeoff|pros and cons|give me|show me|code|debug|fix|optimize|refactor)\b/i;
const TECH_KEYWORDS = /\b(async|await|mutex|deadlock|race condition|cache|memory|pointer|reference|virtual|override|template|generic|complexity|algorithm|tree|graph|queue|stack|heap|sort|search|api|rest|grpc|http|sql|nosql|index|join|concurrency|thread|process|container|docker|kubernetes|ci.?cd|pipeline|lambda|closure|singleton|factory|observer|pattern|architecture|microservice|monolith|latency|throughput|scalab|availab|consist|partition|cap theorem|distributed|consensus|raft|paxos|transformer|embedding|fine.?tun|llm|model|inference|gradient|backprop|tensorflow|pytorch|systemverilog|vhdl|fpga|rtl|synthesis|timing|setup|hold|clock|dma|interrupt|rtos|kernel)\b/i;

function isLikelyQuestion(text) {
    const t = (text || '').trim();
    if (!t || t.length < 15) return false;
    if (t.includes('?')) return true;
    if (/^(how|what|why|when|where|explain|describe|implement|write|design|tell me|can you|could you|walk me through|which|define|compare|give me|show me|code|debug|fix|optimize)/i.test(t)) return true;
    if (Q_STARTERS.test(t) && TECH_KEYWORDS.test(t)) return true;
    return false;
}

const WHISPER_HALLUCINATION_SUBSTR = [
    'subscribe', 'thank you for watching', 'thanks for watching', 'see you in the next',
    'like and comment', 'like and subscribe', 'transcribed by', 'amara.org', 'importance of currency',
    'concept of the universe', 'can you see my face', 'music playing', 'applause', 'subtitle',
    'closed captioning', 'copyright', 'all rights reserved'
];

function isLikelyWhisperHallucination(text) {
    const t = (text || '').toLowerCase();
    if (!t.trim()) return true;
    for (let i = 0; i < WHISPER_HALLUCINATION_SUBSTR.length; i++) {
        if (t.includes(WHISPER_HALLUCINATION_SUBSTR[i])) return true;
    }
    if (/^\s*(hi|hello|hey)\b[^.]{0,80}\bhow are you\b/i.test(t) && t.length < 120 && !/(copy|constructor|class|template|pointer|virtual|override)/i.test(t)) return true;
    return false;
}

function getGroqApiKey(store) {
    const primary = store.apiKey || '';
    const fallback = store.groqFallbackKey || '';
    if (primary.startsWith('gsk_')) return primary;
    if (fallback.startsWith('gsk_')) return fallback;
    return primary;
}

// --- Test Runner ---

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test('isLikelyQuestion correctly identifies technical questions', () => {
    assert.strictEqual(isLikelyQuestion("How do you handle race conditions in C++?"), true);
    assert.strictEqual(isLikelyQuestion("Explain the difference between b_transport and nb_transport"), true);
    assert.strictEqual(isLikelyQuestion("Write a Python decorator for logging"), true);
    assert.strictEqual(isLikelyQuestion("This is just a normal sentence about nothing."), false);
    assert.strictEqual(isLikelyQuestion("short?"), false); // Too short
});

test('isLikelyWhisperHallucination identifies junk text', () => {
    assert.strictEqual(isLikelyWhisperHallucination("Thank you for watching this video."), true);
    assert.strictEqual(isLikelyWhisperHallucination("Please subscribe to my channel."), true);
    assert.strictEqual(isLikelyWhisperHallucination("The interviewer said move semantics are important."), false);
    assert.strictEqual(isLikelyWhisperHallucination("hi how are you"), true);
    assert.strictEqual(isLikelyWhisperHallucination("hi how are you, tell me about virtual destructors"), false);
});

test('getGroqApiKey picks the correct key', () => {
    const store1 = { apiKey: 'gsk_123', groqFallbackKey: '' };
    assert.strictEqual(getGroqApiKey(store1), 'gsk_123');

    const store2 = { apiKey: 'csk_456', groqFallbackKey: 'gsk_789' };
    assert.strictEqual(getGroqApiKey(store2), 'gsk_789');

    const store3 = { apiKey: 'AIza_abc', groqFallbackKey: '' };
    assert.strictEqual(getGroqApiKey(store3), 'AIza_abc'); // Returns primary if no gsk fallback
});

// Run Tests
console.log('--- Running MI5.ai Test Suite ---');
let passed = 0;
let failed = 0;

tests.forEach(t => {
    try {
        t.fn();
        console.log(`[PASS] ${t.name}`);
        passed++;
    } catch (e) {
        console.error(`[FAIL] ${t.name}: ${e.message}`);
        failed++;
    }
});

console.log(`\nTests finished: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
