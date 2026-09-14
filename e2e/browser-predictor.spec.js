const { readFile } = require('node:fs/promises');
const { test, expect } = require('./fixture-app');
const reference = require('../poc/browser-predictor/fixtures/reference.json');

async function selectSample(page) {
    await page.locator('#api_source').selectOption('browser-fixture');
    await expect(page.locator('#browser_fixture_info')).toBeVisible();
    await applyProviderSample(page);
    await expect(page.locator('#hour')).toHaveValue('13');
    await expect(page.locator('#min')).toHaveValue('30');
    await expect(page.locator('#initial_alt')).toHaveValue('100');
}
async function predict(page) {
    await page.locator('#run_pred_btn').click();
    await expect(page.locator('#results_status_badge')).toHaveText('完了');
    await expect(page.locator('#error_window')).toBeHidden();
}
async function historyRecord(page) {
    await page.locator('.sidebar-tab[data-panel="panel-results"]').click();
    await page.locator('[data-results-view="history"]').click();
    const item = page.locator('.run-history-item').first();
    await expect(item).toContainText('ブラウザ固定データ');
    const id = await item.getAttribute('data-run-id');
    await expect.poll(() => page.evaluate(id => window.RunRepository.get(id).then(r => r.status), id)).toBe('completed');
    return page.evaluate(id => window.RunRepository.get(id), id);
}
async function applyProviderSample(page) {
    await page.evaluate(async () => {
        const c = await BrowserPredictor.getClient().sample();
        const jst = moment.utc(c.launchDatetime).utcOffset(9 * 60);
        const values = { year:jst.year(), month:jst.month()+1, day:jst.date(), hour:jst.hour(), min:jst.minute(),
            lat:c.launchLatitude, lon:c.launchLongitude, initial_alt:c.launchAltitude,
            ascent:c.ascentRate, drag:c.descentRate, burst:c.burstAltitude,
            flight_profile:'standard_profile', prediction_type:'single' };
        Object.entries(values).forEach(([id,value]) => {
            const input=document.getElementById(id);
            input.value=String(value);
            input.dispatchEvent(new Event('change',{bubbles:true}));
        });
        time_was_now=false;
    });
}
async function builtinPackageBuffer() {
    const Package=require('../js/pred/weather-package.js');
    const manifest=JSON.parse(await readFile('poc/browser-predictor/fixtures/manifest.json','utf8'));
    const terrainMeta=JSON.parse(await readFile('poc/browser-predictor/fixtures/terrain.json','utf8'));
    const sampleCase=JSON.parse(await readFile('poc/browser-predictor/fixtures/case.json','utf8'));
    const toArrayBuffer=b=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);
    return Buffer.from(await Package.encode({manifest,terrainMeta,sampleCase,
        weatherBuffer:toArrayBuffer(await readFile('poc/browser-predictor/fixtures/weather.bin')),
        terrainBuffer:toArrayBuffer(await readFile('poc/browser-predictor/fixtures/terrain.bin'))}));
}

test('GitHub Pages相当の静的配信からWindows用Weather Builder ZIPを取得できる', async ({ app }) => {
    await app.page.locator('#api_source').selectOption('browser-fixture');
    const link = app.page.getByRole('link', { name: '気象データ作成ツールをダウンロード' });
    await expect(link).toHaveAttribute('download', '');
    const href = await link.getAttribute('href');
    const response = await app.page.request.get(new URL(href, app.page.url()).href);
    expect(response.ok()).toBe(true);
    const bytes = await response.body();
    expect(bytes.subarray(0, 2).toString('ascii')).toBe('PK');
    expect(bytes.byteLength).toBeGreaterThan(100000);
});

test('実Workerで通常予測・履歴・CSV/KML・オフライン再計算ができる', async ({ app }) => {
    const { page } = app;
    const fixtureLoads = [];
    const workers = [];
    page.on('request', r => { if (/fixtures\/(manifest.json|terrain.json|weather.bin|terrain.bin)$/.test(r.url())) fixtureLoads.push(r.url()); });
    page.on('worker', worker => workers.push(worker.url()));
    await selectSample(page);
    await predict(page);
    const record = await historyRecord(page);
    const points = record.output.trajectories[0].points;
    const landing = reference.prediction[1].trajectory.at(-1);
    expect(points.length).toBe(146);
    expect(points.at(-1).latitude).toBeCloseTo(landing.latitude, 9);
    expect(points.at(-1).longitude).toBeCloseTo(landing.longitude, 9);
    expect(Date.parse(points.at(-1).timeUtc)).toBe(Date.parse(landing.datetime));
    expect(points[0].phase).toBe('ascent');
    expect(points.at(-1).phase).toBe('descent');
    expect(record.provenance.fixedFixture).toBe(true);
    expect(record.provenance.weatherSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(record.provenance.predictorSource).toBe('browser-fixture');
    expect(record.progress.httpAttempts).toBe(0);
    expect(record.progress.computations).toBe(1);
    await page.locator('.run-history-item').first().getByRole('button', { name: '地図表示' }).click();
    await expect(page.locator('.run-history-item').first().getByRole('button', { name: '地図から消す' })).toBeVisible();
    await page.locator('[data-results-view="overview"]').click();
    await expect(page.locator('#dataset')).toContainText('固定データ');
    for (const format of ['csv', 'kml']) {
        const downloadPromise = page.waitForEvent('download');
        await page.locator('#dl' + format).click();
        const download = await downloadPromise;
        expect(download.suggestedFilename()).toBe('BrowserFixture.' + format);
        const content = await readFile(await download.path(), 'utf8');
        expect(content).toContain(String(points.at(-1).longitude));
        expect(content).toContain(format === 'csv' ? '2026-09-10T04:30:00' : '<coordinates>');
    }
    await page.context().setOffline(true);
    await page.locator('.sidebar-tab[data-panel="panel-settings"]').click();
    await predict(page);
    const second = await historyRecord(page);
    expect(second.id).not.toBe(record.id);
    expect(second.output.trajectories[0].points).toEqual(points);
    expect(workers.filter(url => url.includes('browser-provider.worker.js'))).toHaveLength(1);
    expect(fixtureLoads).toHaveLength(4);
    expect(app.apiCalls).toEqual([]);
    expect(app.publicRequestsBlocked.filter(url => /tawhiri|sondehub/i.test(url))).toEqual([]);
});

test('実測ポリシーの4 Worker Poolで愛媛13条件を計算できる', async ({ app }) => {
    const { page } = app;
    const workers = [];
    page.on('worker', worker => workers.push(worker.url()));
    await selectSample(page);
    await page.locator('#prediction_type').selectOption('ehime');
    await page.locator('#run_pred_btn').click();
    await expect(page.locator('#ehime_total')).toHaveText('13');
    await expect(page.locator('#ehime_completed')).toHaveText('13', { timeout: 30000 });
    await expect(page.locator('#error_window')).toBeHidden();
    expect(workers.filter(url => url.includes('browser-provider.worker.js'))).toHaveLength(4);
    expect(app.apiCalls).toEqual([]);
    expect(app.publicRequestsBlocked.filter(url => /tawhiri|sondehub/i.test(url))).toEqual([]);
});

test('同じ気象データでBrowser Predictor Sobol解析を並列完了できる', async ({ app }) => {
    const { page } = app;
    const workers = [];
    page.on('worker', worker => workers.push(worker.url()));
    await selectSample(page);
    await page.locator('#open_uncertainty_btn').click();
    await expect(page.getByRole('dialog', { name: '不確実性解析' })).toBeVisible();
    await page.locator('#uncertainty_select_none').click();
    await page.locator('#uncertainty_method').selectOption('sobol');
    await page.locator('#uncertainty_min_samples').fill('4');
    await page.locator('#uncertainty_batch_size').fill('2');
    await page.locator('#uncertainty_max_samples').fill('4');
    await page.locator('#uncertainty_call_limit').fill('5');
    await page.locator('#uncertainty_start').click();
    await expect(page.locator('#uncertainty_status')).toHaveText('完了', { timeout: 30000 });
    const state = await page.evaluate(() => window.UncertaintyAnalysis.getState());
    expect(state.requestConfig.source).toBe('browser-fixture');
    expect(state.siteRuns).toHaveLength(1);
    expect(state.siteRuns[0].centralObservation.isCentral).toBe(true);
    expect(state.siteRuns[0].observations.filter(row => !row.error)).toHaveLength(4);
    expect(state.networkCalls).toBe(0);
    expect(workers.filter(url => url.includes('browser-provider.worker.js'))).toHaveLength(2);
    expect(app.apiCalls).toEqual([]);
    expect(app.publicRequestsBlocked.filter(url => /tawhiri|sondehub/i.test(url))).toEqual([]);
});

test('同じ気象データでBrowser Predictor Latin Hypercube解析を完了できる', async ({ app }) => {
    const { page } = app;
    await selectSample(page);
    await page.locator('#open_uncertainty_btn').click();
    await page.locator('#uncertainty_select_none').click();
    await page.locator('#uncertainty_method').selectOption('lhs');
    await page.locator('#uncertainty_min_samples').fill('4');
    await page.locator('#uncertainty_batch_size').fill('2');
    await page.locator('#uncertainty_max_samples').fill('4');
    await page.locator('#uncertainty_call_limit').fill('5');
    await page.locator('#uncertainty_start').click();
    await expect(page.locator('#uncertainty_status')).toHaveText('完了', { timeout: 30000 });
    const state = await page.evaluate(() => window.UncertaintyAnalysis.getState());
    expect(state.configuration.method).toBe('lhs');
    expect(state.siteRuns[0].observations.filter(row => !row.error)).toHaveLength(4);
    expect(state.networkCalls).toBe(0);
    expect(app.apiCalls).toEqual([]);
    expect(app.publicRequestsBlocked.filter(url => /tawhiri|sondehub/i.test(url))).toEqual([]);
});

test('Browser Predictorで自動探索の粗探索と13条件精密探索を完了できる', async ({ app }) => {
    const { page } = app;
    await selectSample(page);
    await page.locator('#run_auto_search_btn').click();
    await expect(page.locator('#auto_search_modal')).toBeVisible();
    await page.locator('#auto_select_none').click();
    await page.locator('#auto_sites_container input').first().check();
    await page.locator('#auto_search_mode').selectOption('full');
    await page.locator('#auto_start_date').fill('2026-09-10');
    await page.locator('#auto_start_time').fill('13:30');
    await page.locator('#auto_end_date').fill('2026-09-10');
    await page.locator('#auto_end_time').fill('13:30');
    await page.locator('#auto_max_calls').fill('20');
    await page.locator('#auto_action_btn').click();
    await expect(page.locator('#auto_action_btn')).toHaveText('Phase 1 開始');
    await page.locator('#auto_action_btn').click();
    await expect.poll(() => page.evaluate(() => window.__autoSearch.getState().phase)).toBe(2);
    await page.locator('#auto_action_btn').click();
    await expect.poll(() => page.evaluate(() => window.__autoSearch.getState().phase), { timeout: 30000 }).toBe(3);
    await page.locator('#auto_action_btn').click();
    await expect.poll(() => page.evaluate(() => window.__autoSearch.getState().status), { timeout: 30000 }).toBe('completed');
    const state = await page.evaluate(() => window.__autoSearch.getState());
    expect(state.requestConfig.source).toBe('browser-fixture');
    expect(state.p1Passed).toHaveLength(1);
    expect(state.coarseCandidates).toHaveLength(1);
    expect(state.fineCandidates).toHaveLength(1);
    expect(state.requestContext.diagnostics.computations).toBe(14);
    expect(state.httpDiagnostics.computations).toBe(14);
    expect(state.httpDiagnostics.httpAttempts).toBe(1);
    expect(app.apiCalls.filter(url => /tawhiri|sondehub|\/api\/v1\//i.test(url))).toEqual([]);
});

test('範囲外・未対応モードは明示的に失敗し外部APIへ切り替わらない', async ({ app }) => {
    const { page } = app;
    await selectSample(page);
    for (const [field, value, message] of [
        ['hour', '17', '固定気象データの範囲を超え'],
        ['day', '11', '固定気象データの日時範囲外'],
        ['lat', '31', '固定地表標高の範囲外'],
        ['prediction_type', 'fall', '標準フライト']
    ]) {
        await selectSample(page);
        const control = page.locator('#' + field);
        if (field === 'prediction_type') await control.selectOption(value);
        else await control.fill(value);
        await page.locator('#run_pred_btn').click();
        await expect(page.locator('#error_window')).toContainText(message);
        await expect(page.locator('#api_source')).toHaveValue('browser-fixture');
    }
    await selectSample(page);
    await predict(page);
    expect(app.apiCalls).toEqual([]);
    expect(app.publicRequestsBlocked.filter(url => /tawhiri|sondehub/i.test(url))).toEqual([]);
});

test('固定データの読み込み失敗後に再試行できる', async ({ app }) => {
    const { page } = app;
    await page.locator('#site').selectOption('Other');
    await selectSample(page);
    const pattern = '**/fixtures/weather.bin';
    await page.route(pattern, route => route.fulfill({ status: 503, body: 'fixture unavailable' }));
    await page.locator('#run_pred_btn').click();
    await expect(page.locator('#error_window')).toContainText('固定データを読み込めません');
    expect(app.apiCalls).toEqual([]);
    await page.unroute(pattern);
    await predict(page);
});

test('GitHub Pages相当のサブパス配信でも固定データとWorkerをロードできる', async ({ app }) => {
    const { page } = app;
    await page.route('**/Falling-position-simulator2026/**', async route => {
        const url = new URL(route.request().url());
        url.pathname = url.pathname.replace('/Falling-position-simulator2026', '');
        const response = await route.fetch({ url: url.href });
        await route.fulfill({ response });
    });
    await page.goto('/Falling-position-simulator2026/');
    await page.waitForFunction(() => Boolean(window.AppShell && window.PredictionRunner));
    await selectSample(page);
    await predict(page);
    expect(app.apiCalls).toEqual([]);
});
test('ブラウザ試験後もSondeHub・Localhost・Customの接続先とCSVリンクを保持する', async ({ app }) => {
    const { page } = app;
    await selectSample(page);
    await predict(page);
    const remoteCalls = [];
    await page.route('**/api/sondehub/**', route => {
        remoteCalls.push(route.request().url());
        return route.fulfill({ json: { ...reference, metadata: { complete_datetime: new Date().toISOString() }, request: { dataset: '2026-09-10T00:00:00Z' } } });
    });
    for (const source of ['sondehub', 'local', 'custom']) {
        await app.setBaseSettings('single');
        await page.locator('#api_source').selectOption(source);
        if (source === 'custom') await page.locator('#api_custom_url').fill(new URL('/api/v1/', page.url()).href);
        await expect(page.locator('#browser_fixture_info')).toBeHidden();
        await predict(page);
        await expect(page.locator('#dlcsv')).toHaveAttribute('href',
            source === 'sondehub' ? /\/api\/sondehub\// : /\/api\/v1\//);
        const csvUrl = await page.locator('#dlcsv').getAttribute('href');
        expect(csvUrl).toContain(source === 'sondehub' ? '/api/sondehub/' : '/api/v1/');
        expect(csvUrl).toContain('format=csv');
        expect(await page.locator('#dlcsv').getAttribute('download')).toBeNull();
        const handlers = await page.evaluate(() => (jQuery._data(document.getElementById('dlcsv'), 'events') || {}).click || []);
        expect(handlers.some(handler => handler.namespace === 'predictionExport')).toBe(false);
    }
    expect(remoteCalls).toHaveLength(1);
    await expect.poll(() => app.apiCalls.filter(url => url.includes('/api/v1/')).length).toBe(2);
});
test('パッケージを保存・読込して実Workerで予測し、破損時は使用中データを保持する', async ({ app }) => {
    const { page } = app;
    await selectSample(page);
    const buffer=await builtinPackageBuffer();
    await page.locator('#browser_package_file').setInputFiles({
        name:'ehime.wasawx',mimeType:'application/octet-stream',buffer
    });
    await expect(page.locator('#browser_fixture_status')).toContainText('データを切り替えました');
    await expect(page.locator('#browser_data_summary')).toContainText('読込データ');
    await predict(page);
    const record=await historyRecord(page);
    expect(record.provenance.fixedFixture).toBe(false);
    expect(record.provenance.packageSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(record.output.trajectories[0].points.at(-1).latitude).toBeCloseTo(reference.prediction[1].trajectory.at(-1).latitude,9);
    await page.locator('.sidebar-tab[data-panel="panel-settings"]').click();
    const corrupted=Buffer.from(buffer); corrupted[corrupted.length-1]^=1;
    await page.locator('#browser_package_file').setInputFiles({name:'bad.wasawx',mimeType:'application/octet-stream',buffer:corrupted});
    await expect(page.locator('#error_window')).toContainText('SHA-256');
    expect(await page.evaluate(()=>BrowserPredictor.getClient().describe().packageSha256)).toBe(record.provenance.packageSha256);
    await page.context().setOffline(true);
    await predict(page);
    expect(app.apiCalls).toEqual([]);
    await page.context().setOffline(false);
    await page.locator('.browser-data-card__details').evaluate(element => { element.open = true; });
    await page.locator('#browser_package_reset').click();
    await expect(page.locator('#browser_data_summary')).toContainText('同梱の検証用データ');
    expect(await page.evaluate(()=>BrowserPredictor.getClient().describe().imported)).toBe(false);
});

test('パッケージ由来の日時を使い、同梱fixtureの日時に固定されない', async ({ app }) => {
    const { page } = app;
    const Package=require('../js/pred/weather-package.js');
    const manifest=JSON.parse(await readFile('poc/browser-predictor/fixtures/manifest.json','utf8'));
    const terrainMeta=JSON.parse(await readFile('poc/browser-predictor/fixtures/terrain.json','utf8'));
    const sampleCase=JSON.parse(await readFile('poc/browser-predictor/fixtures/case.json','utf8'));
    const toArrayBuffer=b=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);
    // Synthetic time shift exercises metadata plumbing, not new real weather.
    manifest.run='2026-09-11T00:00:00Z';
    sampleCase.launchDatetime='2026-09-11T04:30:00Z';
    const buffer=await Package.encode({manifest,terrainMeta,sampleCase,
        weatherBuffer:toArrayBuffer(await readFile('poc/browser-predictor/fixtures/weather.bin')),
        terrainBuffer:toArrayBuffer(await readFile('poc/browser-predictor/fixtures/terrain.bin'))});
    const requests=[];
    page.on('request',r=>{if(/fixtures\/(weather.bin|terrain.bin)$/.test(r.url())) requests.push(r.url());});
    await page.locator('#site').selectOption('Other');
    await page.locator('#api_source').selectOption('browser-fixture');
    await page.locator('#browser_package_file').setInputFiles({name:'synthetic-time-test.wasawx',mimeType:'application/octet-stream',buffer:Buffer.from(buffer)});
    await expect(page.locator('#browser_data_summary')).toContainText('2026-09-11');
    await applyProviderSample(page);
    await expect(page.locator('#day')).toHaveValue('11');
    await predict(page);
    const record=await historyRecord(page);
    expect(record.provenance.gfsRun).toBe(manifest.run);
    expect(record.output.trajectories[0].points.at(-1).latitude).toBeCloseTo(reference.prediction[1].trajectory.at(-1).latitude,9);
    expect(Date.parse(record.output.trajectories[0].points.at(-1).timeUtc)-Date.parse(reference.prediction[1].trajectory.at(-1).datetime)).toBe(86400000);
    expect(requests).toEqual([]);
    expect(app.apiCalls).toEqual([]);
});
test('放球高度がDEM地表より低くても入力を変えずに自動補正して予測できる', async ({ app }) => {
    const {page}=app;
    await selectSample(page);
    await page.locator('#lat').fill('33.50185');
    await page.locator('#lon').fill('132.93369');
    await page.locator('#initial_alt').fill('1');
    await predict(page);
    await expect(page.locator('#initial_alt')).toHaveValue('1');
    expect(app.apiCalls).toEqual([]);
});
test('保存済みパッケージは再読込後にIndexedDBから読み込み、削除できる', async ({ app }) => {
    const { page } = app;
    await selectSample(page);
    await page.locator('.browser-data-card__saved').evaluate(element => { element.open = true; });
    await page.locator('#browser_package_save_local').click();
    await expect(page.locator('#browser_fixture_status')).toContainText('このブラウザに保存しました');
    await expect(page.locator('#browser_saved_packages option')).toHaveCount(2);

    await page.reload();
    await page.waitForFunction(() => Boolean(window.AppShell && window.BrowserPredictor));
    await page.locator('#api_source').selectOption('browser-fixture');
    await page.locator('.browser-data-card__saved').evaluate(element => { element.open = true; });
    await expect(page.locator('#browser_saved_packages option')).toHaveCount(2);
    const savedId = await page.locator('#browser_saved_packages option').nth(1).getAttribute('value');
    expect(savedId).toMatch(/^[a-f0-9]{64}$/);
    const fixtureLoads = [];
    page.on('request', request => {
        if (/fixtures\/(manifest.json|terrain.json|weather.bin|terrain.bin)$/.test(request.url())) fixtureLoads.push(request.url());
    });
    await page.locator('#browser_saved_packages').selectOption(savedId);
    await page.locator('#browser_package_load_local').click();
    await expect(page.locator('#browser_data_summary')).toContainText('読込データ');
    await applyProviderSample(page);
    await predict(page);
    await page.context().setOffline(true);
    await predict(page);
    expect(fixtureLoads).toEqual([]);
    expect(app.apiCalls).toEqual([]);

    await page.context().setOffline(false);
    await page.locator('#browser_package_delete_local').click();
    await expect(page.locator('#browser_saved_packages option')).toHaveCount(1);
    await page.reload();
    await page.waitForFunction(() => Boolean(window.AppShell && window.BrowserPredictor));
    await expect(page.locator('#browser_saved_packages option')).toHaveCount(1);
});
test('登録済み地点の標高値を変更せずブラウザ予測できる', async ({ app }) => {
    const { page } = app;
    await page.locator('#site').selectOption('南レク松軒山公園');
    await page.locator('#api_source').selectOption('browser-fixture');
    await expect(page.locator('#lat')).toHaveValue('32.97239');
    const registeredAltitude = await page.locator('#initial_alt').inputValue();
    await page.evaluate(() => {
        const c={year:2026,month:9,day:10,hour:13,min:30,ascent:5,drag:5,burst:30000};
        Object.entries(c).forEach(([id,value])=>{const input=document.getElementById(id);input.value=String(value);input.dispatchEvent(new Event('change',{bubbles:true}));});
        time_was_now=false;
    });
    await predict(page);
    await expect(page.locator('#initial_alt')).toHaveValue(registeredAltitude);
    expect(app.apiCalls).toEqual([]);
});
