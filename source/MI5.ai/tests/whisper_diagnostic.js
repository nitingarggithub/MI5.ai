/**
 * Whisper Logic Diagnostic Test
 * Run with: node tests/whisper_diagnostic.js
 */

const hallucinationSubstrings = [
    'subscribe', 'thank you for watching', 'thanks for watching', 'see you in the next',
    'like and comment', 'like and subscribe', 'transcribed by', 'amara.org', 'importance of currency',
    'concept of the universe', 'can you see my face', 'music playing', 'applause', 'subtitle',
    'closed captioning', 'copyright', 'all rights reserved'
];

function isLikelyWhisperHallucination(text) {
    const t = (text || '').toLowerCase();
    if (!t.trim()) return true;
    for (let i = 0; i < hallucinationSubstrings.length; i++) {
        if (t.includes(hallucinationSubstrings[i])) return true;
    }
    // Filter out typical short hallucinations that aren't technical
    if (/^\s*(hi|hello|hey)\b[^.]{0,80}\bhow are you\b/i.test(t) && t.length < 120 && !/(copy|constructor|class|template|pointer|virtual|override)/i.test(t)) return true;
    return false;
}

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

// Test cases
const tests = [
    { text: "Thank you for watching!", expectedHallucination: true },
    { text: "Can you explain how a mutex works in C++?", expectedHallucination: false, expectedQuestion: true },
    { text: "The concept of the universe is vast.", expectedHallucination: true }, // Substring match
    { text: "What is the difference between b_transport and nb_transport?", expectedHallucination: false, expectedQuestion: true },
    { text: "Hi how are you", expectedHallucination: true },
    { text: "I'm doing well, let's talk about move semantics.", expectedHallucination: false, expectedQuestion: false },
    { text: "How would you design a scalable microservice architecture?", expectedHallucination: false, expectedQuestion: true },
    { text: "Please implement a thread-safe queue in Python.", expectedHallucination: false, expectedQuestion: true }
];

console.log("Running Whisper Logic Diagnostic...");
let passed = 0;

tests.forEach((t, i) => {
    const isHal = isLikelyWhisperHallucination(t.text);
    const isQ = isLikelyQuestion(t.text);
    
    let ok = true;
    if (typeof t.expectedHallucination !== 'undefined' && isHal !== t.expectedHallucination) {
        console.error(`Test ${i} Failed: "${t.text}" -> Hallucination? Expected ${t.expectedHallucination}, got ${isHal}`);
        ok = false;
    }
    if (typeof t.expectedQuestion !== 'undefined' && isQ !== t.expectedQuestion) {
        console.error(`Test ${i} Failed: "${t.text}" -> Question? Expected ${t.expectedQuestion}, got ${isQ}`);
        ok = false;
    }
    
    if (ok) {
        console.log(`Test ${i} Passed: "${t.text.substring(0, 30)}..."`);
        passed++;
    }
});

console.log(`\nResults: ${passed}/${tests.length} passed.`);

if (passed === tests.length) {
    console.log("All logic tests passed!");
} else {
    process.exit(1);
}
