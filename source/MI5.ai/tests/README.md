# MI5.ai Test Suite

This directory contains diagnostic and unit tests for the MI5.ai Interview Assistant.

## Diagnostic Tests

### 1. Whisper Logic Diagnostic
Tests the transcription filtering and question detection logic.
```bash
node tests/whisper_diagnostic.js
```

### 2. Full Test Suite
Runs a series of unit tests on the core logic functions.
```bash
node tests/full_test_suite.js
```

## Manual Verification Protocol
Refer to [WHISPER_TEST_PROTOCOL.txt](../test/WHISPER_TEST_PROTOCOL.txt) for manual end-to-end testing instructions using the mock interview HTML files.

## Troubleshooting "Empty Buffer"
If Engage Whisper is active but the buffer remains empty:
1. **Check API Key**: Ensure you have a valid Groq API key (starts with `gsk_`). If you use Cerebras as your primary model, you MUST provide a Groq key in the "Groq Fallback Key" field in Settings.
2. **Microphone Selection**: Click "Refresh microphone list" in the dashboard and ensure your correct headset is selected.
3. **Signal Strength**: Look for the "⚠ Mic signal weak or silent" warning in the HUD. If you see this, the app is receiving very little audio data.
4. **API Errors**: Check the HUD for "Whisper Error" messages (e.g., rate limits, invalid keys).
