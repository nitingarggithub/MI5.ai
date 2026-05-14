/**
 * test-ipc-handlers.js
 * Static analysis of main.js — verifies all IPC channels, global shortcuts,
 * contentProtection config, and JPEG compression are correct.
 */
'use strict';
const { TestRunner, APP_DIR } = require('./test-helpers');
const fs   = require('fs');
const path = require('path');

const MAIN_JS   = path.join(APP_DIR, 'main.js');
const APP_HTML  = path.join(APP_DIR, 'app.html');
const OVERLAY   = path.join(APP_DIR, 'overlay.html');
const CLIP_SEL  = path.join(APP_DIR, 'clip-selector.html');

async function run() {
    const t = new TestRunner('IPC Handlers / Shortcuts / main.js Static Analysis');

    if (!fs.existsSync(MAIN_JS)) {
        t.fail('main.js found', MAIN_JS); return t.summary();
    }
    const src = fs.readFileSync(MAIN_JS, 'utf8');
    t.pass('main.js exists and is readable');

    // ── IPC handlers (ipcMain.on / ipcMain.handle) ────────────────
    const handlers = [
        'clip-region-selected',
        'clip-cancelled',
        'stash-manual-draft',
        'update-buffer-state',
        'overlay-undo-clear',
        'overlay-bring-to-front',
        'overlay-manual-ask',
        'update-overlay-text',
        'update-overlay-status',
        'log-interaction',
        'parse-file',
        'scrape-url',
    ];
    for (const ch of handlers) {
        const found = src.includes(`'${ch}'`);
        if (found) t.pass(`IPC handler: '${ch}'`);
        else       t.fail(`IPC handler: '${ch}'`, 'Not found in main.js');
    }

    // ── webContents.send channels ──────────────────────────────────
    const sends = [
        'process-screenshot', 'process-audio-answer', 'undo-clear',
        'update-overlay-status', 'update-buffer-state', 'open-settings',
        'set-screenshot', 'set-manual-draft', 'manual-ask', 'manual-ack',
    ];
    for (const ch of sends) {
        if (src.includes(`send('${ch}'`)) t.pass(`webContents.send: '${ch}'`);
        else                               t.fail(`webContents.send: '${ch}'`, 'Not found in main.js');
    }

    // ── Global shortcuts ───────────────────────────────────────────
    const shortcuts = [
        'CommandOrControl+Shift+O',
        'CommandOrControl+Shift+S',
        'CommandOrControl+Shift+C',
        'CommandOrControl+Shift+A',
        'CommandOrControl+Shift+Z',
    ];
    for (const sc of shortcuts) {
        if (src.includes(`'${sc}'`)) t.pass(`globalShortcut: '${sc}'`);
        else                          t.fail(`globalShortcut: '${sc}'`, 'Not found in main.js');
    }

    // ── contentProtection: overlay YES, clipWindow NO ────────────
    const afterClipShortcut = src.slice(src.indexOf('CommandOrControl+Shift+C'));
    const clipSection = afterClipShortcut.slice(0, afterClipShortcut.indexOf('ipcMain.on(\'clip-region-selected\''));
    const clipHasProtection = clipSection.includes('setContentProtection(true)') || clipSection.includes('contentProtection: true');
    if (!clipHasProtection) t.pass('clipWindow: NO contentProtection (correct for Windows interaction)');
    else                    t.fail('clipWindow contentProtection', 'Still set — breaks drag-to-select on Windows');

    if (src.includes('contentProtection: true') && src.includes('setContentProtection(true)'))
        t.pass('overlayWindow: contentProtection enabled (hides from screen share)');
    else
        t.fail('overlayWindow contentProtection', 'Missing — overlay visible to screen share');

    // ── JPEG compression: no raw toDataURL ───────────────────────
    const toDataUrlCount = (src.match(/\.toDataURL\(\)/g) || []).length;
    const toJpegCount    = (src.match(/\.toJPEG\(/g) || []).length;
    if (toDataUrlCount === 0) t.pass('main.js: 0 raw .toDataURL() calls (all use .toJPEG())');
    else                      t.fail('.toDataURL() still present', `${toDataUrlCount} call(s) — oversized PNG breaks Groq vision limit`);
    if (toJpegCount >= 3) t.pass(`main.js: JPEG compression in ${toJpegCount} capture points`);
    else                  t.fail('JPEG compression coverage', `Only ${toJpegCount} calls — expected ≥3`);

    // ── session_logs.jsonl logging ────────────────────────────────
    if (src.includes('session_logs.jsonl') && src.includes('log-interaction'))
        t.pass('Interaction logging: log-interaction → session_logs.jsonl');
    else
        t.fail('Interaction logging', 'log-interaction handler or session_logs.jsonl not found');

    // ── app.html checks ───────────────────────────────────────────
    if (!fs.existsSync(APP_HTML)) {
        t.fail('app.html found', APP_HTML); return t.summary();
    }
    const appSrc = fs.readFileSync(APP_HTML, 'utf8');

    // Section 4 QA Bank present
    if (appSrc.includes('Q/A Memory Bank') && appSrc.includes('qaTableBody'))
        t.pass('app.html: Section 4 Q/A Memory Bank present');
    else
        t.fail('app.html: Section 4 Q/A Memory Bank', 'Not found');

    // QA engine functions
    const qaFns = ['tokenize','cosineSim','matchQAPair','addQAPair','deleteQAPair','renderQATable','openQAAddDialog','exportQAPairs','importQAPairs'];
    for (const fn of qaFns) {
        if (appSrc.includes(`function ${fn}`) || appSrc.includes(`${fn}(`))
            t.pass(`app.html: QA function '${fn}' present`);
        else
            t.fail(`app.html: QA function '${fn}'`, 'Not found');
    }

    // queryLLM cache intercept
    if (appSrc.includes('matchQAPair(prompt)') && appSrc.includes('Check Q/A Memory Bank'))
        t.pass('app.html: queryLLM cache intercept wired');
    else
        t.fail('app.html: queryLLM cache intercept', 'matchQAPair not called in queryLLM');

    // Whisper key helper
    if (appSrc.includes('getWhisperApiKey') || appSrc.includes('groqFallbackKey') && appSrc.includes('startSpeechMonitor'))
        t.pass('app.html: Whisper Groq key logic present');
    else
        t.fail('app.html: Whisper key logic', 'getWhisperApiKey or fallback key logic not found');

    // ── overlay.html checks ───────────────────────────────────────
    if (fs.existsSync(OVERLAY)) {
        const ov = fs.readFileSync(OVERLAY, 'utf8');
        if (ov.includes('update-buffer-state')) t.pass('overlay.html: update-buffer-state listener present');
        else                                     t.fail('overlay.html: update-buffer-state', 'listener not found');
        if (ov.includes('overlay-undo-clear'))  t.pass('overlay.html: overlay-undo-clear send present');
        else                                     t.fail('overlay.html: overlay-undo-clear', 'send not found');
    } else { t.skip('overlay.html checks', 'File not found'); }

    // ── clip-selector.html checks ──────────────────────────────────
    if (fs.existsSync(CLIP_SEL)) {
        const cs = fs.readFileSync(CLIP_SEL, 'utf8');
        if (cs.includes('clip-region-selected')) t.pass('clip-selector.html: sends clip-region-selected');
        else                                      t.fail('clip-selector.html: clip-region-selected send', 'Not found');
        if (cs.includes('clip-cancelled'))        t.pass('clip-selector.html: sends clip-cancelled on ESC/tiny drag');
        else                                      t.fail('clip-selector.html: clip-cancelled', 'Not found');
        if (!cs.includes('setContentProtection')) t.pass('clip-selector.html: no contentProtection');
        else                                      t.fail('clip-selector.html: contentProtection', 'Should not have it');
    } else { t.skip('clip-selector.html checks', 'File not found'); }

    return t.summary();
}

if (require.main === module) run().catch(console.error);
module.exports = run;
