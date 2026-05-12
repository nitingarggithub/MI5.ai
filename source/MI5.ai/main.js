const { app, BrowserWindow, globalShortcut, ipcMain, desktopCapturer, Menu } = require('electron');
const path = require('path');

let mainWindow;
let overlayWindow;

function bringOverlayToFront() {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  try {
    if (process.platform === 'win32') {
      overlayWindow.setAlwaysOnTop(true, 'screen-saver');
    } else {
      overlayWindow.setAlwaysOnTop(true);
    }
  } catch (e) {
    overlayWindow.setAlwaysOnTop(true);
  }
  overlayWindow.setSkipTaskbar(true);
  overlayWindow.show();
  overlayWindow.moveTop();
  overlayWindow.focus();
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    title: "MI5.ai",
    width: 1200,
    height: 800,
    webPreferences: { 
      nodeIntegration: true,
      contextIsolation: false
    }
  });
  mainWindow.loadFile('app.html');
}

function toggleOverlay() {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    if (overlayWindow.isVisible()) {
      overlayWindow.hide();
    } else {
      bringOverlayToFront();
    }
  } else {
    overlayWindow = new BrowserWindow({
      width: 420,
      height: 680,
      transparent: true,
      frame: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      /** Excludes HUD from most screen-share / capture paths (Teams, Meet, etc.) on Windows 10 2004+ and macOS. */
      contentProtection: true,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false
      }
    });
    overlayWindow.setContentProtection(true);
    overlayWindow.loadFile('overlay.html');
    overlayWindow.once('ready-to-show', () => {
      try {
        if (process.platform === 'win32') overlayWindow.setAlwaysOnTop(true, 'screen-saver');
        else overlayWindow.setAlwaysOnTop(true);
      } catch (e) {
        overlayWindow.setAlwaysOnTop(true);
      }
      overlayWindow.setSkipTaskbar(true);
    });
  }
}

app.whenReady().then(() => {
  const { session } = require('electron');
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(true);
  });
  session.defaultSession.setPermissionCheckHandler(() => true);

  const template = [
    {
      label: 'MI5.ai',
      submenu: [
        { label: 'Settings', click: () => { if(mainWindow) mainWindow.webContents.send('open-settings'); } },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggledevtools' }
      ]
    }
  ];
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);

  createMainWindow();

  globalShortcut.register('CommandOrControl+Shift+O', () => {
    toggleOverlay();
  });

  globalShortcut.register('CommandOrControl+Shift+S', async () => {
    try {
        const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1920, height: 1080 } });
        if (sources.length > 0) {
            const dataUrl = sources[0].thumbnail.toDataURL();
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('process-screenshot', dataUrl);
            }
            if (overlayWindow && !overlayWindow.isDestroyed()) {
                overlayWindow.webContents.send('update-overlay-status', '<em>Processing screenshot…</em>');
                if (!overlayWindow.isVisible()) overlayWindow.show();
            }
        }
    } catch(e) { console.error(e); }
  });

  globalShortcut.register('CommandOrControl+Shift+A', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('process-audio-answer');
    }
    if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.webContents.send('update-overlay-status', '<em style="color:#268bd2;">Transcribing / answering audio…</em>');
        if (!overlayWindow.isVisible()) overlayWindow.show();
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

ipcMain.on('update-overlay-text', (event, text) => {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send('update-overlay', text);
    if (!overlayWindow.isVisible()) {
      overlayWindow.show();
    }
  } else {
// If window doesn't exist, create it and then populate
    toggleOverlay();
    setTimeout(() => {
      if (overlayWindow && !overlayWindow.isDestroyed()) {
         overlayWindow.webContents.send('update-overlay', text);
      }
    }, 1000);
  }
});

ipcMain.on('update-overlay-status', (event, html) => {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send('update-overlay-status', html);
    if (!overlayWindow.isVisible()) {
      overlayWindow.show();
    }
  }
});

ipcMain.on('overlay-bring-to-front', () => {
  bringOverlayToFront();
});

// HUD manual typing -> run answer in main renderer
ipcMain.on('overlay-manual-ask', (event, text) => {
  try {
    bringOverlayToFront();
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.webContents.send('manual-ack', 'Processing…');
      if (!overlayWindow.isVisible()) overlayWindow.show();
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('manual-ask', String(text || ''));
    } else if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.webContents.send('manual-ack', 'Main window not ready');
    }
  } catch (e) {
    console.error(e);
  }
});

// Prefill HUD manual box with last captured question/buffer
ipcMain.on('stash-manual-draft', (event, draft) => {
  try {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.webContents.send('set-manual-draft', String(draft || ''));
      if (!overlayWindow.isVisible()) overlayWindow.show();
      bringOverlayToFront();
    }
  } catch (e) {
    console.error(e);
  }
});

const fs = require('fs');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');

ipcMain.handle('parse-file', async (event, { buffer, name }) => {
  try {
    const nodeBuffer = Buffer.from(buffer);
    if (name.toLowerCase().endsWith('.pdf')) {
      const data = await pdfParse(nodeBuffer);
      if (!data || !data.text) throw new Error("PDF parsed but no text returned");
      return { text: data.text };
    } else if (name.toLowerCase().endsWith('.docx')) {
      const result = await mammoth.extractRawText({buffer: nodeBuffer});
      return { text: result.value };
    } else {
      return { text: nodeBuffer.toString('utf8') };
    }
  } catch (error) {
    return { error: error.message };
  }
});

ipcMain.handle('scrape-url', async (event, url) => {
  return new Promise((resolve) => {
    let bw = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
    
    bw.webContents.on('did-finish-load', async () => {
      try {
        const text = await bw.webContents.executeJavaScript('document.body.innerText');
        bw.destroy();
        resolve({ text });
      } catch(e) {
        bw.destroy();
        resolve({ error: e.message });
      }
    });
    
    bw.webContents.on('did-fail-load', (event, code, desc) => {
      bw.destroy();
      resolve({ error: desc });
    });

    bw.loadURL(url).catch(err => {
      if (!bw.isDestroyed()) bw.destroy();
      resolve({ error: err.message });
    });
  });
});