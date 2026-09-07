'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const runtime = require('./scripts/local-runtime.js');
const ACTIVE = new Set(['running', 'cancelling', 'recovery_required']);
function failure(message, status = 409) { return Object.assign(new Error(message), { status }); }
function validRun(run) {
    if (typeof run !== 'string' || !/^\d{8}(00|06|12|18)$/.test(run)) return false;
    const iso = `${run.slice(0,4)}-${run.slice(4,6)}-${run.slice(6,8)}T${run.slice(8)}:00:00.000Z`;
    const parsed = new Date(iso);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString() === iso;
}
function chooseDataset(inventory, params, engine) {
    const launch = Date.parse(params.launch_datetime || '');
    const end = params.stop_datetime ? Date.parse(params.stop_datetime) : launch;
    if (!Number.isFinite(launch) || !Number.isFinite(end) || end < launch) throw failure('予測日時を正しく入力してください。', 422);
    if (!inventory.elevation.ready) throw failure('標高データがありません。「最新データを取得」を実行してください。', 422);
    const requested = params.dataset && params.dataset !== 'latest' ? Date.parse(params.dataset) : null;
    if (requested !== null && !Number.isFinite(requested)) throw failure('GFS runの指定が不正です。', 422);
    const candidates = inventory.datasets.filter(row => row.valid &&
        (requested === null || Date.parse(row.forecastStart) === requested) &&
        Date.parse(row.forecastStart) <= launch && Date.parse(row.forecastEnd) > launch && Date.parse(row.forecastEnd) >= end)
        .sort((a,b) => b.run.localeCompare(a.run));
    if (!candidates.length) throw failure('指定日時を含むGFSがありません。保存runの予報対象期間を確認してください。取得可能な予報より先の日時は、更新しても予測できません。', 422);
    const row = candidates[0];
    const revision = crypto.createHash('sha256').update(row.fingerprint + ':' + inventory.elevation.fingerprint + ':' + engine).digest('hex');
    return { run: row.run, dataset: row.forecastStart, revision, engine, forecastEnd: row.forecastEnd,
        warning: params.stop_datetime ? '' : '放球日時の範囲を確認済みです。飛行全体が予報期間内に収まる必要があります。' };
}
class LocalService {
    constructor(options = {}) {
        this.runtime = options.runtime || runtime;
        this.directory = options.directory || runtime.runtime;
        fs.mkdirSync(this.directory, { recursive: true });
        this.jobFile = path.join(this.directory, 'weather-job.json');
        this.lockFile = path.join(this.directory, 'operation.lock');
        this.job = null; this.activePredictions = 0; this.mutating = false; this.cache = null; this.reading = null;
        this.token = crypto.randomBytes(32).toString('hex');
        try { this.job = JSON.parse(fs.readFileSync(this.jobFile, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') this.loadError = 'ジョブ記録を読み込めません。local/.runtime/weather-job.json を確認してください。'; }
        this.ready = this.recover();
    }
    save() {
        fs.writeFileSync(this.jobFile + '.tmp', JSON.stringify(this.job));
        fs.renameSync(this.jobFile + '.tmp', this.jobFile);
    }
    async removeContainer(name) {
        if (!/^wasa-local-[a-f0-9]{32}$/.test(name || '')) throw failure('取得コンテナの識別情報が不正です。');
        // Query by exact name; absence is success, engine failure is not.
        const ids = await this.runtime.run('docker', ['ps', '-aq', '--filter', `name=^/${name}$`], { timeout: 15000 });
        if (ids.trim()) await this.runtime.run('docker', ['rm', '-f', name], { timeout: 30000 });
    }
    async recover(allowCurrent = false) {
        if (!this.job || !ACTIVE.has(this.job.status)) return;
        this.mutating = true;
        try {
            let removeLock = false;
            if (fs.existsSync(this.lockFile)) {
                const owner = JSON.parse(fs.readFileSync(this.lockFile, 'utf8'));
                if (owner.kind !== 'launcher') {
                    if (owner.jobId !== this.job.id) throw failure('別のローカル操作が進行中です。');
                    let alive = true;
                    try { process.kill(owner.pid, 0); } catch (error) { if (error.code === 'ESRCH') alive = false; }
                    if (alive && !(allowCurrent && owner.pid === process.pid)) throw failure('取得を実行したサーバがまだ動いています。');
                    removeLock = true;
                }
            }
            await this.removeContainer(this.job.containerName);
            await this.runtime.compose(['up', '-d', '--pull', 'never', 'tawhiri'], { timeout: 30000 }); await this.runtime.waitTawhiri();
            if (removeLock) fs.unlinkSync(this.lockFile);
            this.job.status = 'interrupted'; this.job.error = '前のデータ操作を中断・復旧しました。状態を確認して再実行してください。';
            this.job.finishedAt = new Date().toISOString(); this.mutating = false; this.cache = null;
        } catch (error) { this.job.status = 'recovery_required'; this.job.error = '復旧が必要です。Docker Desktopを起動してから「復旧を試す」を押してください。 ' + error.message; }
        this.save();
    }
    async inventory(fresh = false) {
        await this.ready;
        if (this.loadError) throw failure(this.loadError, 503);
        if (!fresh && this.cache && Date.now() - this.cache.at < 3000) return this.cache.value;
        if (this.reading && !fresh) return this.reading;
        const read = (async () => {
            const output = await this.runtime.compose(['exec', '-T', 'tawhiri', 'python3', '/opt/wasa/weather_store.py', 'inventory'], { timeout: 15000 });
            const data = JSON.parse(output);
            if (!this.engine) this.engine = await this.runtime.compose(['config', '--images', 'tawhiri']);
            this.cache = { at: Date.now(), value: data }; return data;
        })();
        this.reading = read;
        try { return await read; } finally { if (this.reading === read) this.reading = null; }
    }
    async status() {
        await this.ready;
        let weather, error;
        try { weather = await this.inventory(); } catch (e) { error = 'Tawhiri・データを確認できません。Docker Desktopとstart-local.batの起動状態を確認してください。 ' + e.message; }
        return { enabled: true, tawhiri: error ? 'unavailable' : 'running', weather: weather || null,
            activePredictions: this.activePredictions, busy: this.mutating, job: this.job, error: error || this.loadError || null };
    }
    assertIdle() {
        if (this.mutating || (this.job && ACTIVE.has(this.job.status))) throw failure('データ操作中です。完了またはキャンセル処理の終了を待ってください。');
        if (this.activePredictions) throw failure('予測中のためデータを変更できません。予測の完了を待ってください。');
    }
    lock(jobId) {
        this.assertIdle();
        let fd;
        try { fd = fs.openSync(this.lockFile, 'wx'); }
        catch (_) { throw failure('別のローカル操作が進行中です。操作画面の終了を待ってください。'); }
        fs.writeFileSync(fd, JSON.stringify({ jobId, pid: process.pid })); fs.closeSync(fd); this.mutating = true;
    }
    unlock() { fs.unlinkSync(this.lockFile); this.mutating = false; this.cache = null; }
    async resolve(params) {
        await this.ready;
        if (this.mutating) throw failure('気象データの操作中です。完了後に予測してください。');
        const inventory = await this.inventory();
        if (this.mutating) throw failure('気象データの操作中です。完了後に予測してください。');
        return chooseDataset(inventory, params, this.engine);
    }
    async acquirePrediction(params) {
        const selected = await this.resolve(params);
        if (params._local_revision && params._local_revision !== selected.revision) throw failure('気象データが更新されました。予測を再実行してください。');
        if (this.mutating) throw failure('気象データの操作中です。');
        this.activePredictions++;
        let released = false;
        return { ...selected, release: () => { if (!released) { released = true; this.activePredictions--; } } };
    }
    async startDownload(dataset) {
        await this.ready;
        if (dataset !== null && dataset !== undefined && !validRun(dataset)) throw failure('GFS runは実在する日付のYYYYMMDDHH（UTC 00/06/12/18時）で指定してください。', 400);
        const id = crypto.randomBytes(16).toString('hex');
        this.lock(id);
        this.job = { id, kind: 'download', containerName: 'wasa-local-' + id, status: 'running', stage: 'checking', dataset: dataset || null,
            startedAt: new Date().toISOString(), finishedAt: null, log: '', error: null };
        this.controller = new AbortController(); this.save();
        this.completion = this.executeDownload(dataset).catch(error => {
            this.job.status = 'recovery_required'; this.job.error = error.message; this.save();
        });
        return this.job;
    }
    async executeDownload(dataset) {
        let outcome = 'completed', errorMessage = null;
        const onStage = stage => { this.job.stage = stage; this.save(); };
        const onData = text => {
            this.job.log = (this.job.log + text).slice(-16000);
            // Persist a bounded tail; page closure does not affect the worker.
            this.save();
        };
        try {
            const data = await this.inventory(true);
            const existing = data.datasets.some(row => row.run === dataset && row.valid);
            const minimum = (existing ? 0 : 10 * 1024 ** 3) + (data.elevation.ready ? 0 : 8 * 1024 ** 3);
            if (data.freeBytes < minimum) throw failure('Dockerディスクの空き容量が不足しています。不要なGFSを削除してから再実行してください。');
            await this.runtime.performDownload(dataset, { signal: this.controller.signal, onStage, onData,
                containerName: this.job.containerName, onDataset: value => { this.job.dataset = value; this.save(); } });
        } catch (error) { outcome = this.controller.signal.aborted ? 'cancelled' : 'failed'; errorMessage = outcome === 'cancelled' ? '取得をキャンセルしました。一時ファイルは一覧から整理できます。' : error.message; }
        // Confirm cleanup before allowing prediction or another mutation.
        await this.removeContainer(this.job.containerName);
        try { await this.runtime.compose(['restart', 'tawhiri'], { timeout: 30000 }); await this.runtime.waitTawhiri(); }
        catch (error) { outcome = 'failed'; errorMessage = 'Tawhiriの再起動に失敗しました。start-local.batで起動し直してください。 ' + error.message; }
        this.job.status = outcome; this.job.error = errorMessage; this.job.finishedAt = new Date().toISOString(); this.save();
        this.unlock();
    }
    async cancel(id) {
        await this.ready;
        if (!this.job || this.job.kind === 'delete' || this.job.id !== id || !['running', 'cancelling'].includes(this.job.status)) throw failure('キャンセルできる取得ジョブがありません。');
        this.job.status = 'cancelling'; this.save(); this.controller.abort();
        return this.job;
    }
    async deleteFile(action, target, fingerprint) {
        await this.ready;
        if (typeof fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(fingerprint)) throw failure('削除対象を一覧から選び直してください。', 400);
        const data = await this.inventory(true);
        const entry = action === 'delete-run' ? data.datasets.find(row => row.run === target) : data.temporary.find(row => row.name === target);
        if (!entry || entry.fingerprint !== fingerprint) throw failure('対象データが変更されています。一覧を更新してください。');
        const id = crypto.randomBytes(16).toString('hex');
        this.lock(id);
        this.job = { id, kind: 'delete', containerName: 'wasa-local-' + id, status: 'running', stage: 'deleting', dataset: target,
            startedAt: new Date().toISOString(), finishedAt: null, log: '', error: null };
        this.save();
        let result;
        try {
            await this.runtime.compose(['stop', 'tawhiri'], { timeout: 30000 });
            result = JSON.parse(await this.runtime.compose(['run', '--rm', '--no-deps', '--name', this.job.containerName, 'maintenance', 'python3', '/opt/wasa/weather_store.py', action, target, fingerprint], { timeout: 30000 }));
            this.job.status = 'completed';
        } catch (error) { this.job.status = 'failed'; this.job.error = error.message; throw error; } finally {
            try {
                await this.removeContainer(this.job.containerName);
                await this.runtime.compose(['up', '-d', '--pull', 'never', 'tawhiri'], { timeout: 30000 });
                await this.runtime.waitTawhiri();
                this.job.finishedAt = new Date().toISOString(); this.save(); this.unlock();
            } catch (error) { this.job.status = 'recovery_required'; this.job.error = error.message; this.save(); throw error; }
        }
        return result;
    }
    async shutdown() {
        await this.ready;
        if (this.job && this.job.status === 'recovery_required') await this.recover(true);
        if (this.job && this.job.kind !== 'delete' && ['running', 'cancelling'].includes(this.job.status)) {
            await this.cancel(this.job.id); await this.completion;
            if (this.job.status === 'recovery_required') throw failure(this.job.error, 503);
        }
        if (this.mutating) throw failure('データ操作の終了を待ってから停止してください。');
    }
}
module.exports = { LocalService, chooseDataset, validRun, failure };
