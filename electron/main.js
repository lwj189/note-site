const { app, BrowserWindow, Tray, Menu, nativeImage, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

// 标记 Electron 模式，让 server.js 不自动启动且跳过 Pinggy
process.env.ELECTRON_RUN = 'true';

const { startServer, getPort } = require('../server');

let mainWindow = null;
let tray = null;
let serverStarted = false;

// ---- Single instance lock ----
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// ---- Create tray icon ----
function createTray() {
  // Prefer the generated tray.png (document glyph); fall back to a blue circle
  let img;
  const trayPath = path.join(__dirname, 'tray.png');
  if (require('fs').existsSync(trayPath)) {
    img = nativeImage.createFromPath(trayPath);
  } else {
    const size = 16;
    const canvas = Buffer.alloc(size * size * 4, 0);
    const cx = 2, cy = 2, r = 6;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = x - (cx + r), dy = y - (cy + r);
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist <= r) {
          const idx = (y * size + x) * 4;
          canvas[idx] = 67;     // R
          canvas[idx + 1] = 97; // G
          canvas[idx + 2] = 238;// B
          canvas[idx + 3] = 255;// A
        }
      }
    }
    img = nativeImage.createFromBuffer(canvas, { width: size, height: size });
  }
  tray = new Tray(img);
  tray.setToolTip('MyNote');

  const contextMenu = Menu.buildFromTemplate([
    { label: '显示窗口', click: () => { mainWindow.show(); mainWindow.focus(); } },
    { label: '隐藏窗口', click: () => mainWindow.hide() },
    { type: 'separator' },
    { label: '重启服务', click: () => { app.relaunch(); app.exit(); } },
    { type: 'separator' },
    { label: '退出', click: () => { app.isQuitting = true; app.quit(); } }
  ]);
  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => { mainWindow.show(); mainWindow.focus(); });
}

// ---- Create main window ----
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'MyNote',
    icon: path.join(__dirname, 'icon.png'),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  mainWindow.loadURL('http://localhost:' + getPort());

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Minimize to tray instead of closing
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ---- 导出 PDF：隐藏窗口加载打印视图 → printToPDF → 另存为 ----
ipcMain.handle('export-pdf', async (event, payload) => {
  const slug = payload && payload.slug;
  const title = (payload && payload.title) || slug || 'note';
  if (!slug) return { ok: false, error: '缺少笔记标识' };
  const win = new BrowserWindow({
    show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true }
  });
  try {
    await win.loadURL('http://localhost:' + getPort() + '/print/' + encodeURIComponent(slug));
    // 等图片解码完成，否则 PDF 里可能是空白图
    await win.webContents.executeJavaScript(
      'Promise.all(Array.from(document.images).map(function (img) { return img.complete ? 1 : new Promise(function (r) { img.onload = img.onerror = r; }); })).then(function () { return document.images.length; })'
    ).catch(() => {});
    const data = await win.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      margins: { top: 0.5, bottom: 0.5, left: 0.5, right: 0.5 }
    });
    const safe = String(title).replace(/[\\/:*?"<>|]/g, '_');
    let filePath;
    // 设了 MYNOTE_PDF_DIR 就免弹窗直接写文件（便于脚本化 / 自动化测试）
    const forcedDir = process.env.MYNOTE_PDF_DIR;
    if (forcedDir) {
      if (!fs.existsSync(forcedDir)) fs.mkdirSync(forcedDir, { recursive: true });
      filePath = path.join(forcedDir, safe + '.pdf');
    } else {
      const picked = await dialog.showSaveDialog(mainWindow, {
        title: '导出 PDF',
        defaultPath: path.join(app.getPath('downloads'), safe + '.pdf'),
        filters: [{ name: 'PDF 文件', extensions: ['pdf'] }]
      });
      if (picked.canceled || !picked.filePath) return { ok: false, canceled: true };
      filePath = picked.filePath;
    }
    fs.writeFileSync(filePath, data);
    return { ok: true, path: filePath, size: data.length };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
});

// ---- App lifecycle ----
app.whenReady().then(async () => {
  // Start Express server
  try {
    await startServer();
    serverStarted = true;
    console.log('Express server started on port ' + getPort());
  } catch (err) {
    dialog.showErrorBox('启动失败', '无法启动笔记服务：' + err.message);
    app.quit();
    return;
  }

  createTray();
  createWindow();

  app.on('activate', () => {
    if (mainWindow === null) createWindow();
    else mainWindow.show();
  });
});

app.on('window-all-closed', () => {
  // Don't quit on macOS; on Windows keep running in tray
  if (process.platform === 'darwin') app.quit();
});

app.on('before-quit', () => {
  app.isQuitting = true;
});
