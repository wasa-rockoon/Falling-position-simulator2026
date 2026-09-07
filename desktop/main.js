'use strict';
const { app, BrowserWindow, dialog, ipcMain, shell, utilityProcess, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { allowedExternal, isSimulator } = require('./navigation');
if (require('electron-squirrel-startup')) app.quit();
else if (!app.requestSingleInstanceLock()) app.quit();
else {
    let window, runtime, startup, startupController, owned = false, closing = false, quitting = false;
    const splash = path.join(__dirname, 'startup.html');
    const splashUrl = pathToFileURL(splash).href;
    function progress(message) { if (window && !window.isDestroyed()) window.webContents.send('desktop:status', message); }
    async function launch() {
        startupController = new AbortController();
        try {
            await runtime.runAction('start', {
                noBrowser: true, signal: startupController.signal, onStage: progress, onOwn: () => { owned = true; },
                spawnServer: (entry, settings) => {
                    const child = utilityProcess.fork(entry, [], { cwd: settings.cwd, env: settings.env, stdio: 'pipe', serviceName: 'WASA Simulator server' });
                    for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => fs.appendFileSync(path.join(runtime.runtime, 'server.log'), chunk));
                    return child;
                }
            });
            await window.loadURL('http://localhost:3100/?api_source=local');
        } catch (error) {
            fs.appendFileSync(path.join(runtime.runtime, 'desktop.log'), new Date().toISOString() + ' ' + error.stack + '\n');
            progress('起動できませんでした。\n' + error.message + '\nDocker Desktopと他のSimulatorの起動状態を確認し、再試行してください。');
        }
    }
    async function close() {
        if (closing) return;
        closing = true;
        if (window.webContents.getURL() === splashUrl) startupController?.abort();
        try {
            await startup;
            if (owned) {
                const state = await runtime.jsonRequest('http://127.0.0.1:3100/local/status').catch(() => null);
                if (state && (state.data.busy || state.data.activePredictions > 0)) {
                    const choice = await dialog.showMessageBox(window, { type: 'question', buttons: ['アプリに戻る', '処理を終了して閉じる'], defaultId: 0, cancelId: 0, message: '予測またはデータ操作が進行中です。', detail: '取得中の場合は安全にキャンセルして終了します。保存済みGFSは保持します。削除中は完了を待ってください。' });
                    if (choice.response === 0) return;
                }
                progress('ローカル環境を停止しています');
                await runtime.runAction('stop'); owned = false;
            }
            quitting = true; app.quit();
        } catch (error) { await dialog.showMessageBox(window, { type: 'error', message: '停止できませんでした', detail: error.message + '\n状態を確認して、もう一度アプリを閉じてください。' }); }
        finally { closing = false; }
    }
    app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.focus(); } });
    app.on('before-quit', event => { if (!quitting && window) { event.preventDefault(); close(); } });
    app.whenReady().then(async () => {
        const payload = app.isPackaged ? path.join(process.resourcesPath, 'simulator') : path.resolve(__dirname, '..');
        process.env.LOCAL_APP_ROOT = payload;
        process.env.LOCAL_RUNTIME_DIR = path.join(app.getPath('userData'), 'runtime');
        fs.mkdirSync(process.env.LOCAL_RUNTIME_DIR, { recursive: true });
        runtime = require(path.join(payload, 'local/scripts/local-runtime.js'));
        // Keep IndexedDB/localStorage, remove only web-shell caches when the installed app changes.
        const storage = session.fromPartition('persist:wasa-simulator');
        await storage.clearStorageData({ storages: ['serviceworkers', 'cachestorage'] });
        storage.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
        storage.setPermissionCheckHandler(() => false);
        storage.on('will-download', (_event, item) => item.setSaveDialogOptions({ title: '予測結果を保存' }));
        window = new BrowserWindow({ width: 1440, height: 960, minWidth: 800, minHeight: 600, title: 'WASA Falling Position Simulator', icon: path.join(payload, 'favicon.ico'), autoHideMenuBar: true,
            webPreferences: { preload: path.join(__dirname, 'preload.js'), partition: 'persist:wasa-simulator', nodeIntegration: false, contextIsolation: true, sandbox: true } });
        window.on('close', event => { if (!quitting) { event.preventDefault(); close(); } });
        window.webContents.on('will-navigate', (event, url) => { if (!isSimulator(url) && url !== splashUrl) event.preventDefault(); });
        window.webContents.on('will-redirect', (event, url) => { if (!isSimulator(url)) event.preventDefault(); });
        window.webContents.setWindowOpenHandler(({url}) => { if (allowedExternal(url)) shell.openExternal(url).catch(() => {}); return { action: 'deny' }; });
        ipcMain.handle('desktop:retry', async event => {
            if (event.sender !== window.webContents || event.senderFrame.url !== splashUrl || closing) return;
            await startup;
            if (owned) { try { await runtime.runAction('stop'); owned = false; } catch (error) { progress(error.message); return; } }
            startup = launch();
        });
        await window.loadFile(splash); startup = launch();
    }).catch(error => { dialog.showErrorBox('アプリを起動できません', error.message); quitting = true; app.quit(); });
}
