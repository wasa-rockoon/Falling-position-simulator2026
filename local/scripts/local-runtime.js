'use strict';
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { randomBytes } = require('node:crypto');
const root = process.env.LOCAL_APP_ROOT || path.resolve(__dirname, '../..');
const runtime = process.env.LOCAL_RUNTIME_DIR || path.join(root, 'local/.runtime');
const stateFile = path.join(runtime, 'server.json');
const composeArgs = ['compose', '--project-directory', path.join(root, 'local'), '-f', path.join(root, 'local/docker-compose.yml')];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function run(command, args, { timeout = 120000, live = false, signal, onData, containerName } = {}) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) { reject(new Error('操作をキャンセルしました。')); return; }
        const child = spawn(command, args, { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        let output = '', stdout = '', terminalError, cleanup = Promise.resolve(), settled = false;
        function interrupt(message) {
            if (terminalError) return;
            terminalError = new Error(message);
            if (containerName) cleanup = run('docker', ['rm', '-f', containerName], { timeout: 30000 }).catch(() => {});
            child.kill();
        }
        const abort = () => interrupt('操作をキャンセルしました。');
        const timer = setTimeout(() => interrupt(command + ': タイムアウトしました。Docker Desktopの状態を確認してください。'), timeout);
        if (signal) signal.addEventListener('abort', abort, { once: true });
        for (const [name, stream] of [['stdout', child.stdout], ['stderr', child.stderr]]) stream.setEncoding('utf8').on('data', chunk => {
            if (name === 'stdout') stdout = (stdout + chunk).slice(-200000);
            output = (output + chunk).slice(-200000);
            if (onData) onData(chunk.toString());
            if (live) {
                process.stdout.write(chunk);
                fs.appendFileSync(path.join(runtime, 'operations.log'), chunk);
            }
        });
        async function finish(code, error) {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            if (signal) signal.removeEventListener('abort', abort);
            await cleanup;
            if (terminalError || error || code !== 0) reject(terminalError || error || new Error(command + ' failed (' + code + ')\n' + output));
            else resolve(stdout.trim());
        }
        child.on('error', error => finish(null, error));
        child.on('close', code => finish(code));
    });
}
const compose = (args, options) => run('docker', [...composeArgs, ...args], options);
async function checkEnvironment() {
    if (Number(process.versions.node.split('.')[0]) < 20) throw new Error('Node.js 20以上をインストールしてください。');
    try { await run('docker', ['--version'], { timeout: 15000 }); await compose(['version'], { timeout: 20000 }); }
    catch (error) { throw new Error('Docker Desktop / Docker Composeが利用できません。Docker Desktopをインストールし、WSL2 backendを有効にしてください。\n' + error.message); }
    try {
        const type = await run('docker', ['info', '--format', '{{.OSType}}'], { timeout: 20000 });
        if (type !== 'linux') throw new Error('Linux containersに切り替えてください。');
    } catch (error) { throw new Error('Docker Desktopが起動していないか、Linux Engineに接続できません。Docker Desktopを起動してからもう一度実行してください。\n' + error.message); }
}
async function ensureImages(services, options = {}) {
    for (const service of services) {
        const image = await compose(['config', '--images', service]);
        try { await run('docker', ['image', 'inspect', image], { timeout: 15000 }); }
        catch (_) {
            console.log(`初回イメージ取得: ${image}`);
            await compose(['pull', service], { ...options, timeout: 30 * 60000 });
        }
    }
}
async function jsonRequest(url, options = {}, timeout = 5000) {
    const response = await fetch(url, { ...options, signal: AbortSignal.timeout(timeout) });
    return { status: response.status, data: await response.json() };
}
async function waitTawhiri() {
    console.log('Tawhiri APIの応答を確認しています...');
    for (let attempt = 0; attempt < 60; attempt++) {
        try {
            const result = await jsonRequest('http://127.0.0.1:8000/api/v1/');
            if (result.status === 400 && result.data.error?.type === 'RequestException') return;
        } catch (_) { /* start-up in progress */ }
        await sleep(1000);
    }
    throw new Error('Tawhiriの起動に失敗しました。local/.runtime/launcher.log を確認してください。');
}
// Uses the installed Tawhiri reader, including its expected GFS file size.
const statusCode = `import json, os, sys
from tawhiri.dataset import Dataset
from datetime import datetime, timedelta
result = {"weather": "missing", "elevation": "missing", "dataset": None}
try:
 ds = Dataset(datetime.strptime(sys.argv[1], "%Y%m%d%H")) if len(sys.argv) > 1 else Dataset.open_latest()
 result["dataset"] = ds.ds_time.strftime("%Y%m%d%H")
 result["weather"] = "ready"
 result["forecastStart"] = ds.ds_time.isoformat() + "Z"
 result["forecastEnd"] = (ds.ds_time + timedelta(hours=Dataset.axes.hour[-1])).isoformat() + "Z"
 ds.close()
except Exception as error:
 result["weatherDetail"] = str(error)
p = "/srv/ruaumoko-dataset"
if os.path.isfile(p) and os.path.getsize(p) == 4 * 6 * 10801 * 14401 * 2:
 result["elevation"] = "ready"
result["ready"] = result["weather"] == "ready" and result["elevation"] == "ready"
print(json.dumps(result))`;
async function weatherStatus(dataset) {
    const output = await compose(['exec', '-T', 'tawhiri', 'python3', '-c', statusCode, ...(dataset ? [dataset] : [])]);
    return JSON.parse(output);
}
function printWeather(status) {
    console.log(`GFS: ${status.weather} / Dataset: ${status.dataset || 'なし'} / 標高: ${status.elevation}`);
    if (status.forecastEnd) console.log(`GFS対象範囲（UTC）: ${status.forecastStart} ～ ${status.forecastEnd}`);
    if (!status.ready) console.log('Tawhiriは起動しましたが、気象・標高データが未取得または不完全です。download-weather.bat を実行してください。予測はデータ取得後に利用できます。');
}
async function checkPort() {
    await new Promise((resolve, reject) => {
        const server = net.createServer();
        server.once('error', () => reject(new Error('3100番ポートは使用中です。既存のSimulatorは stop-local.bat で停止してください。他のアプリの場合はそのアプリを終了してください。')));
        server.listen(3100, '127.0.0.1', () => server.close(resolve));
    });
}
async function start(options = {}) {
    const checkpoint = () => options.signal?.throwIfAborted();
    checkpoint();
    await checkPort();
    options.onStage?.('Dockerを確認しています');
    await checkEnvironment();
    options.onStage?.('必要なイメージを確認・取得しています');
    await ensureImages(['tawhiri', 'downloader'], { signal: options.signal });
    checkpoint();
    options.onOwn?.();
    options.onStage?.('Tawhiriを起動しています');
    await compose(['up', '-d', '--pull', 'never', 'tawhiri'], { live: true });
    await waitTawhiri();
    printWeather(await weatherStatus());
    checkpoint();
    const token = randomBytes(32).toString('hex');
    const out = fs.openSync(path.join(runtime, 'server.log'), 'a');
    options.onStage?.('Simulatorを起動しています');
    const spawnServer = options.spawnServer || ((entry, settings) => spawn(process.execPath, [entry], settings));
    const child = spawnServer(path.join(root, 'cors-proxy.js'), {
        cwd: root, detached: true, windowsHide: true, stdio: ['ignore', out, out],
        env: { ...process.env, PORT: '3100', HOST: '127.0.0.1', STRICT_PORT: '1', TAWHIRI_HOST: '127.0.0.1', TAWHIRI_PORT: '8000', LOCAL_SHUTDOWN_TOKEN: token, LOCAL_MANAGEMENT: '1' }
    });
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    child.unref?.(); fs.closeSync(out);
    fs.writeFileSync(stateFile, JSON.stringify({ token }));
    for (let attempt = 0; attempt < 30; attempt++) {
        checkpoint();
        try {
            const result = await jsonRequest('http://127.0.0.1:3100/__server-info');
            if (result.data.localInstance === token.slice(0, 16)) {
                console.log('Simulator準備完了: http://localhost:3100');
                if (!options.noBrowser && !process.env.LOCAL_NO_BROWSER) await run('cmd.exe', ['/d', '/c', 'start', '', 'http://localhost:3100/?api_source=local']);
                return;
            }
        } catch (_) { /* wait for server */ }
        await sleep(500);
    }
    throw new Error('Simulatorサーバの起動に失敗しました。local/.runtime/server.log を確認してください。stop-local.bat で停止できます。');
}
async function stop() {
    // Never stop the shared Compose project when another launcher owns port 3100.
    if (!fs.existsSync(stateFile)) await checkPort();
    let failure;
    if (fs.existsSync(stateFile)) {
        const { token } = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
        try {
            const response = await jsonRequest('http://127.0.0.1:3100/local/shutdown', { method: 'POST', headers: { Authorization: `Bearer ${token}` } }, 120000);
            if (response.status !== 200) throw new Error('Simulator停止を確認できません。server.jsonを保持しました。');
            fs.unlinkSync(stateFile);
        } catch (error) {
            // A stopped server is fine; never kill an unrelated PID or port owner.
            try { await checkPort(); fs.unlinkSync(stateFile); } catch (_) { failure = error; }
        }
    }
    if (failure) throw failure;
    try { await compose(['down'], { live: true }); } catch (error) { failure = error; }
    if (failure) throw failure;
    console.log('停止しました。GFS・標高データvolumeは保持されています。');
}
async function latestRun(signal) {
    // Same completion criterion as Project Horus download.py: f192 exists on S3.
    const candidate = new Date();
    candidate.setUTCMinutes(0, 0, 0);
    candidate.setUTCHours(Math.floor(candidate.getUTCHours() / 6) * 6);
    for (let n = 0; n < 30; n++, candidate.setUTCHours(candidate.getUTCHours() - 6)) {
        const date = candidate.toISOString().slice(0, 10).replaceAll('-', '');
        const hour = String(candidate.getUTCHours()).padStart(2, '0');
        const controller = new AbortController();
        const abort = () => controller.abort();
        const timer = setTimeout(abort, 15000);
        if (signal) { signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort(); }
        let response;
        try { response = await fetch(`https://noaa-gfs-bdp-pds.s3.amazonaws.com/gfs.${date}/${hour}/atmos/gfs.t${hour}z.pgrb2.0p50.f192`, { method: 'HEAD', signal: controller.signal }); }
        finally { clearTimeout(timer); if (signal) signal.removeEventListener('abort', abort); }
        if (response.ok) return date + hour;
        if (response.status !== 404) throw new Error(`GFS確認失敗: HTTP ${response.status}`);
    }
    throw new Error('取得可能なGFS runが見つかりません。インターネット接続を確認してください。');
}
async function runDataContainer(service, args, options, containerName, timeout) {
    try {
        await compose(['run', '-d', '--no-deps', '--name', containerName, service, ...args], { onData: options.onData, timeout: 120000 });
        if (options.signal?.aborted) throw new Error('操作をキャンセルしました。');
        const result = await Promise.all([
            run('docker', ['logs', '-f', containerName], { ...options, containerName, timeout }),
            run('docker', ['wait', containerName], { signal: options.signal, timeout: timeout + 30000 })
        ]);
        if (result[1].trim() !== '0') throw new Error('データ取得コンテナが失敗しました。取得ログを確認してください。');
    } finally {
        const ids = await run('docker', ['ps', '-aq', '--filter', 'name=^/' + containerName + '$'], { timeout: 15000 });
        if (ids.trim()) await run('docker', ['rm', '-f', containerName], { timeout: 30000 });
    }
}
async function performDownload(dataset, options = {}) {
    const stage = name => { if (options.signal?.aborted) throw new Error('操作をキャンセルしました。'); if (options.onStage) options.onStage(name); };
    const jobOptions = { signal: options.signal, onData: options.onData };
    const containerName = options.containerName || 'wasa-tawhiri-download-job';
    stage('checking');
    await checkEnvironment();
    await ensureImages(['tawhiri', 'downloader'], jobOptions);
    if (!dataset) { stage('selecting'); dataset = await latestRun(options.signal); }
    if (!/^\d{8}(00|06|12|18)$/.test(dataset)) throw new Error('GFS runの形式が不正です。');
    if (options.onDataset) options.onDataset(dataset);
    const before = await weatherStatus();
    if (before.elevation !== 'ready') {
        stage('elevation');
        await runDataContainer('elevation', [], jobOptions, containerName, 6 * 3600000);
        stage('validating-elevation');
        await compose(['run', '--rm', '--no-deps', 'elevation', 'python3', '-c',
            'import os; p="/srv/ruaumoko-dataset.partial"; assert os.path.getsize(p) == 4*6*10801*14401*2; os.replace(p,"/srv/ruaumoko-dataset")']);
    }
    const selected = await weatherStatus(dataset);
    if (selected.weather !== 'ready') {
        stage('gfs');
        await runDataContainer('downloader', ['one', '-base-url', 'aws-mirror', dataset], jobOptions, containerName, 3 * 3600000);
    }
    stage('validating');
    const after = await weatherStatus(dataset);
    if (!after.ready) throw new Error('取得後のデータ検証に失敗しました。ログを確認して再実行してください。');
    return after;
}
async function download() {
    let session;
    try { session = await jsonRequest('http://127.0.0.1:3100/local/session'); }
    catch (_) { throw new Error('先に start-local.bat を実行してください。データ取得はSimulatorサーバが管理します。'); }
    if (!session.data.token) throw new Error('Phase 2のstart-local.batで起動し直してください。');
    const headers = { 'Content-Type': 'application/json', 'X-Local-Token': session.data.token };
    const result = await jsonRequest('http://127.0.0.1:3100/local/weather/download', { method: 'POST', headers, body: JSON.stringify({ dataset: process.argv[3] || null }) });
    if (result.status !== 202) throw new Error(result.data.error?.description || 'データ取得を開始できません。');
    console.log('取得を開始しました。ブラウザのローカル環境パネルでも確認・キャンセルできます。');
    let previous = '';
    while (true) {
        const response = await jsonRequest('http://127.0.0.1:3100/local/status');
        const job = response.data.job;
        if (!job || job.id !== result.data.job.id) throw new Error('ジョブ状態を確認できません。画面で確認してください。');
        if (job.stage !== previous) { console.log(job.stage); previous = job.stage; }
        if (!['running', 'cancelling'].includes(job.status)) {
            if (job.status !== 'completed') throw new Error(job.error || '取得を完了できませんでした。');
            console.log('取得・検証が完了しました。'); return;
        }
        await sleep(2000);
    }
}
async function runAction(action, options = {}) {
    fs.mkdirSync(runtime, { recursive: true });
    if (action === 'download') { await download(); return; }
    if (action === 'stop') { await stop(); return; }
    if (action === 'check') { await checkEnvironment(); return; }
    if (action === 'status') { await checkEnvironment(); printWeather(await weatherStatus()); return; }
    // Exclusive file lock prevents two launchers/downloaders modifying the same environment.
    const lockPath = path.join(runtime, 'operation.lock');
    let lock;
    if (action === 'start' && fs.existsSync(lockPath)) {
        let owner;
        try { owner = JSON.parse(fs.readFileSync(lockPath, 'utf8')); } catch (_) { /* Legacy locks require manual confirmation. */ }
        if (owner && Number.isInteger(owner.pid) && (owner.kind === 'launcher' || /^[a-f0-9]{32}$/.test(owner.jobId || ''))) {
            let alive = true;
            try { process.kill(owner.pid, 0); } catch (error) { if (error.code === 'ESRCH') alive = false; }
            if (!alive) fs.unlinkSync(lockPath); // The server recovers the persisted job/container before enabling operations.
        }
    }
    try { lock = fs.openSync(lockPath, 'wx'); fs.writeFileSync(lock, JSON.stringify({ kind: 'launcher', pid: process.pid })); }
    catch (_) { throw new Error('別のローカル操作が進行中です。終了を待ってください。異常終了した場合はREADMEのロック解除手順を参照してください。'); }
    try {
        if (action === 'start') await start(options);
        else throw new Error('操作: start / stop / download / status / check');
    } finally { fs.closeSync(lock); fs.unlinkSync(lockPath); }
}
if (require.main === module) runAction(process.argv[2]).catch(async error => {
    console.error('ローカル環境の操作に失敗しました。詳細は local/.runtime/launcher.log を確認してください。\n' + error.message);
    fs.mkdirSync(runtime, { recursive: true });
    fs.appendFileSync(path.join(runtime, 'launcher.log'), `${new Date().toISOString()} ${error.stack}\n`);
    try { fs.appendFileSync(path.join(runtime, 'launcher.log'), await compose(['logs', '--no-color', '--tail', '80'], { timeout: 10000 })); } catch (_) { /* Docker may be unavailable */ }
    process.exitCode = 1;
});
module.exports = { runAction, latestRun, jsonRequest, checkPort, statusCode, weatherStatus, compose, run, performDownload, waitTawhiri, root, runtime };
