(function (root) {
    'use strict';
    var discovery, managed = false, latest = null, renderingKey = '', pendingDelete = null, deleteTrigger = null, polling = false;
    var stages = { checking: '環境・空き容量を確認中', selecting: '取得可能なGFSを確認中', elevation: '標高データを取得中', 'validating-elevation': '標高データを検証中', gfs: 'GFSを取得中', validating: 'データを検証中', deleting: 'GFSを削除中' };
    var states = { running: '処理中', cancelling: 'キャンセル処理中', completed: '完了', failed: '失敗', cancelled: 'キャンセル済み', interrupted: '中断', recovery_required: '復旧が必要' };
    function el(id) { return root.document.getElementById(id); }
    function bytes(value) { return (Number(value || 0) / Math.pow(1024, 3)).toFixed(2) + ' GiB'; }
    function date(value) { return new Date(value).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', hour12: false }) + ' JST'; }
    async function request(url, options) {
        options = options || {};
        var response = await root.fetch(url, Object.assign({ cache: 'no-store', signal: AbortSignal.timeout(45000) }, options));
        var data = await response.json();
        if (!response.ok) throw new Error(data.error && data.error.description || 'ローカル環境に接続できません。');
        return data;
    }
    function discover() {
        if (!discovery) discovery = (async function () {
            if (!root.location || ['localhost', '127.0.0.1', '[::1]'].indexOf(root.location.hostname) === -1) return false;
            try { var info = await request('/__server-info'); managed = info.app === 'Falling-position-simulator2026' && info.localManagement === true; }
            catch (error) { managed = false; }
            return managed;
        }());
        return discovery;
    }
    async function prepare(params, signal) {
        if (!await discover()) return null;
        var query = new URLSearchParams();
        ['launch_datetime', 'stop_datetime', 'dataset'].forEach(function (key) { if (params[key]) query.set(key, params[key]); });
        return request('/local/weather/resolve?' + query, signal ? { signal: signal } : {});
    }
    async function mutate(route, method, data) {
        var session = await request('/local/session');
        return request(route, { method: method, headers: { 'Content-Type': 'application/json', 'X-Local-Token': session.token }, body: JSON.stringify(data) });
    }
    function message(text, error) { el('local_message').textContent = text; el('local_message').classList.toggle('local-error', Boolean(error)); }
    function text(parent, tag, value, className) { var node = root.document.createElement(tag); node.textContent = value; if (className) node.className = className; parent.appendChild(node); return node; }
    function confirmDelete(entry, temporary, trigger) {
        pendingDelete = { entry: entry, temporary: temporary }; deleteTrigger = trigger;
        el('local_delete_text').textContent = (temporary ? entry.name : 'GFS ' + entry.run) + '（' + bytes(entry.bytes) + '）を削除します。保存済みの予測結果と標高データは保持されます。GFSの再計算には再取得が必要になります。';
        el('local_delete_confirm').hidden = false; el('local_delete_cancel').focus();
    }
    function dismissDelete() { pendingDelete = null; el('local_delete_confirm').hidden = true; if (deleteTrigger && deleteTrigger.isConnected) deleteTrigger.focus(); }
    function renderFiles(status) {
        var weather = status.weather;
        var disabled = status.busy || status.activePredictions > 0;
        var key = JSON.stringify([weather && weather.revision, weather && weather.temporary, disabled]);
        if (key === renderingKey) return;
        renderingKey = key;
        var list = el('local_datasets'); list.replaceChildren();
        if (!weather || !weather.datasets.length) text(list, 'p', '保存済みGFSはありません。');
        if (weather) weather.datasets.forEach(function (entry) {
            var row = text(list, 'div', '', 'local-dataset');
            text(row, 'strong', 'GFS ' + entry.run);
            text(row, 'span', bytes(entry.bytes) + ' · ' + (entry.valid ? '標準形式' : '不完全なデータ'));
            text(row, 'small', date(entry.forecastStart) + ' ～ ' + date(entry.forecastEnd));
            var button = text(row, 'button', 'このGFSを削除', 'local-danger'); button.type = 'button'; button.disabled = disabled;
            button.addEventListener('click', function () { confirmDelete(entry, false, button); });
        });
        var temporary = el('local_temporary'); temporary.replaceChildren();
        if (weather && weather.temporary.length) weather.temporary.forEach(function (entry) {
            var row = text(temporary, 'div', '', 'local-dataset');
            text(row, 'span', entry.name + ' · 実使用 ' + bytes(entry.allocatedBytes === undefined ? entry.bytes : entry.allocatedBytes) + ' / ファイルサイズ ' + bytes(entry.bytes));
            var button = text(row, 'button', '一時ファイルを削除', 'local-danger'); button.type = 'button'; button.disabled = disabled;
            button.addEventListener('click', function () { confirmDelete(entry, true, button); });
        });
        else text(temporary, 'p', '整理できる一時ファイルはありません。');
    }
    function render(status) {
        var previous = latest && latest.weather && latest.weather.revision;
        latest = status;
        el('local_summary').textContent = status.busy ? 'データ操作中' : status.tawhiri === 'running' ? '起動中' : '接続を確認';
        el('local_tawhiri').textContent = status.tawhiri === 'running' ? '起動中' : '確認できません';
        el('local_elevation').textContent = status.weather && status.weather.elevation.ready ? '取得済み' : '未取得・不完全';
        el('local_storage').textContent = status.weather ? 'データ使用量 ' + bytes(status.weather.usedBytes) + ' / Docker内の空き ' + bytes(status.weather.freeBytes) : '確認できません';
        el('local_download').disabled = status.busy || status.activePredictions > 0 || status.tawhiri !== 'running';
        el('local_delete_execute').disabled = status.busy || status.activePredictions > 0;
        el('local_busy').textContent = status.activePredictions > 0 ? '予測中はデータを変更できません。' : status.busy ? 'データ操作中は新しい予測を開始できません。' : '';
        renderFiles(status);
        var job = status.job;
        el('local_job').hidden = !job;
        if (job) {
            var elapsed = Math.max(0, Math.floor(((job.finishedAt ? Date.parse(job.finishedAt) : Date.now()) - Date.parse(job.startedAt)) / 1000));
            el('local_job_status').textContent = (states[job.status] || job.status) + ' · ' + (stages[job.stage] || job.stage) + ' · ' + Math.floor(elapsed / 60) + '分' + elapsed % 60 + '秒';
            el('local_job_dataset').textContent = job.dataset ? '対象GFS: ' + job.dataset : '対象runを確認中';
            el('local_job_log').textContent = job.log || 'まだログはありません。';
            el('local_job_error').textContent = job.error || '';
            el('local_cancel').hidden = job.kind === 'delete' || ['running', 'cancelling'].indexOf(job.status) === -1;
            el('local_cancel').disabled = job.status === 'cancelling';
            el('local_recover').hidden = job.status !== 'recovery_required';
            el('local_retry').hidden = ['failed', 'cancelled', 'interrupted'].indexOf(job.status) === -1 || job.kind === 'delete';
            el('local_retry').disabled = status.busy || status.activePredictions > 0;
        }
        if (status.error) message(status.error, true);
        if (previous !== (status.weather && status.weather.revision)) root.dispatchEvent(new CustomEvent('wasa:local-weather-change'));
    }
    async function refresh() {
        if (polling) return;
        polling = true;
        try { render(await request('/local/status')); }
        catch (error) { message(error.message + ' サーバ停止後はstart-local.batで起動してください。', true); }
        finally { polling = false; }
    }
    async function act(task, success) {
        try { await task(); message(success, false); }
        catch (error) { message(error.message, true); }
        await refresh();
    }
    async function checkDate() {
        if (!managed || typeof root.getSettings !== 'function') return;
        if (el('api_source').value !== 'local') { el('local_date_check').textContent = 'Local APIを選ぶと、入力日時を確認できます。'; return; }
        try {
            var selected = await prepare(root.getSettings());
            el('local_date_check').textContent = '使用予定: GFS ' + selected.run + '。' + selected.warning;
            el('local_date_check').classList.remove('local-error');
        } catch (error) { el('local_date_check').textContent = error.message; el('local_date_check').classList.add('local-error'); }
    }
    function historyNote(datasets) {
        if (!datasets || !datasets.length) return '';
        var runs = Array.from(new Set(datasets.map(function (d) { return d.dataset; })));
        var missing = latest && latest.weather && runs.some(function (run) { return !latest.weather.datasets.some(function (d) { return d.valid && Date.parse(d.forecastStart) === Date.parse(run); }); });
        return '使用GFS: ' + runs.join(', ') + (missing ? '。元データなし：再計算には再取得が必要です。' : '。再計算には同じGFS・エンジン版が必要です。');
    }
    async function init() {
        if (!await discover()) return;
        el('local_environment').hidden = false;
        el('local_refresh').addEventListener('click', refresh);
        el('local_download').addEventListener('click', function () { act(function () { return mutate('/local/weather/download', 'POST', {}); }, '取得を開始しました。画面を閉じてもサーバが処理を続けます。'); });
        el('local_retry').addEventListener('click', function () { act(function () { return mutate('/local/weather/download', 'POST', { dataset: latest.job.dataset }); }, '再取得を開始しました。'); });
        el('local_cancel').addEventListener('click', function () { act(function () { return mutate('/local/weather/cancel', 'POST', { id: latest.job.id }); }, 'キャンセルを要求しました。コンテナ停止までお待ちください。'); });
        el('local_recover').addEventListener('click', function () { act(function () { return mutate('/local/weather/recover', 'POST', {}); }, '復旧状態を確認しました。'); });
        el('local_delete_cancel').addEventListener('click', dismissDelete);
        el('local_delete_confirm').addEventListener('keydown', function (event) { if (event.key === 'Escape') dismissDelete(); });
        el('local_delete_execute').addEventListener('click', async function () {
            if (!pendingDelete) return;
            var choice = pendingDelete; el('local_delete_execute').disabled = true;
            await act(function () { return mutate(choice.temporary ? '/local/weather/temporary' : '/local/weather/dataset', 'DELETE', { run: choice.entry.run, name: choice.entry.name, fingerprint: choice.entry.fingerprint }); }, '削除しました。履歴の予測結果は保持されています。');
            dismissDelete(); await checkDate();
        });
        el('local_check_date').addEventListener('click', checkDate);
        await refresh(); await checkDate();
        root.setInterval(function () { if (!root.document.hidden) refresh(); }, 3000);
        root.document.addEventListener('visibilitychange', function () { if (!root.document.hidden) refresh(); });
    }
    root.LocalEnvironment = { prepare: prepare, discover: discover, historyNote: historyNote };
    root.AppShell.registerInitializer('local-environment', function () { init().catch(function (error) { if (root.reportNonFatalError) root.reportNonFatalError(error, 'local.init'); }); }, 95);
}(typeof globalThis !== 'undefined' ? globalThis : this));
