const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const BrowserPredictor = require('../js/pred/browser-predictor-provider.js');
const PredictionApi = require('../js/pred/pred-api-client.js');
const RequestContext = require('../js/pred/request-context.js');
const params = {
    pred_type: 'single', profile: 'standard_profile',
    launch_datetime: '2026-09-10T04:30:00Z', launch_latitude: 33.13492,
    launch_longitude: 132.50477, launch_altitude: 100,
    ascent_rate: 5, descent_rate: 5, burst_altitude: 30000
};
function harness({ corrupt = false, stall = false } = {}) {
    const fetched = [], workers = [];
    const client = BrowserPredictor.create({
        baseUrl: 'https://example.test/project/poc/browser-predictor/',
        fetchImpl: async url => {
            fetched.push(url);
            const name = new URL(url).pathname.split('/').at(-1);
            const bytes = await fs.readFile(path.join(__dirname, '../poc/browser-predictor/fixtures', name));
            if (corrupt && name === 'weather.bin') bytes[0] ^= 1;
            return {
                ok: true,
                json: async () => JSON.parse(bytes.toString()),
                arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
            };
        },
        workerFactory: url => {
            const worker = {
                url, terminated: false,
                terminate() { this.terminated = true; },
                postMessage(message) {
                    if (stall && message.type === 'predict') return;
                    queueMicrotask(() => this.onmessage({ data: {
                        id: message.id,
                        type: message.type === 'load' ? 'ready' : 'result',
                        data: { prediction: [], metadata: {} }
                    } }));
                }
            };
            workers.push(worker);
            return worker;
        }
    });
    return { client, fetched, workers };
}
test('browser source cannot accidentally create an HTTP prediction client', () => {
    assert.equal(PredictionApi.resolveApiUrl('browser-fixture'), '');
    assert.throws(() => PredictionApi.getClient({ source: 'browser-fixture' }), /HTTP/);
    assert.throws(() => new PredictionApi.PredictionClient({ source: 'browser-fixture' }), /HTTP/);
});
test('unsupported workflows and out-of-range inputs fail before fixture fetch', async () => {
    const h = harness();
    for (const changed of [
        { pred_type: 'fall' }, { profile: 'float_profile' },
        { launch_datetime: '2026-09-11T04:30:00Z' },
        { launch_latitude: 31 }, { ascent_rate: 0 }, { burst_altitude: 50 }
    ]) await assert.rejects(h.client.request({ ...params, ...changed }));
    assert.deepEqual(h.fetched, []);
    assert.deepEqual(h.workers, []);
});
test('Ehime-style simultaneous requests expand the adaptive Worker pool', async () => {
    const h = harness();
    const results = await Promise.all(Array.from({ length: 13 }, (_, index) =>
        h.client.request({ ...params, pred_type: 'ehime', ascent_rate: 4 + index / 10 }, { label: 'variant-' + index })
    ));
    assert.equal(results.length, 13);
    assert.equal(h.workers.length, 2);
    assert.equal(h.fetched.length, 4);
    assert.ok(results.every(result => result.computationCount === 1));
});
test('fixture bytes and one Worker are reused; history diagnostics never count API attempts', async () => {
    const h = harness();
    const context = RequestContext.create({ source: 'browser-fixture', client: h.client });
    for (let i = 0; i < 2; i++) {
        const result = await context.request(params, { label: 'single' });
        assert.equal(result.cacheHit, false);
        assert.equal(result.data.metadata.provenance.fixedFixture, true);
        assert.equal(result.data.request.dataset, '2026-09-10T00:00:00Z');
    }
    assert.equal(h.workers.length, 1);
    assert.equal(h.fetched.length, 4);
    assert.ok(h.fetched.every(url => url.startsWith('https://example.test/project/poc/browser-predictor/fixtures/')));
    assert.equal(context.snapshot().diagnostics.httpAttempts, 0);
    assert.equal(context.snapshot().diagnostics.computations, 2);
    assert.equal(context.snapshot().resolvedBaseUrl, '');
});
test('corrupted weather bytes are rejected before Worker execution', async () => {
    const h = harness({ corrupt: true });
    await assert.rejects(h.client.request(params), /固定データの検証に失敗/);
    assert.equal(h.workers.length, 0);
});
test('an aborted calculation terminates its Worker and can start again', async () => {
    const h = harness({ stall: true });
    const controller = new AbortController();
    const first = h.client.request(params, { signal: controller.signal });
    const rejected = assert.rejects(first, error => error.code === 'ABORTED');
    while (!h.workers.length) await new Promise(resolve => setImmediate(resolve));
    controller.abort();
    await rejected;
    assert.equal(h.workers[0].terminated, true);
    h.client.timeoutMs = 30;
    await assert.rejects(h.client.request(params), /時間内に完了/);
    assert.equal(h.workers.length, 2);
    assert.equal(h.workers[1].terminated, true);
});
test('browser weather packages can be saved, restored, and deleted without a prediction API', async () => {
    const AppStorage = require('../js/core/app-storage.js');
    const store = AppStorage.createStore('weatherPackages');
    await store.clear();
    try {
        const h = harness();
        const saved = await h.client.saveActivePackage('愛媛の保存テスト');
        assert.equal(saved.length, 1);
        assert.equal(saved[0].title, '愛媛の保存テスト');
        assert.match(saved[0].id, /^[a-f0-9]{64}$/);
        assert.ok(h.fetched.every(url => url.startsWith('https://example.test/project/poc/browser-predictor/fixtures/')));

        h.client.useBuiltin();
        const loaded = await h.client.loadSavedPackage(saved[0].id);
        assert.equal(loaded.imported, true);
        assert.equal(loaded.packageSha256, saved[0].id);
        assert.equal((await h.client.listSavedPackages()).length, 1);

        await h.client.deleteSavedPackage(saved[0].id);
        assert.deepEqual(await h.client.listSavedPackages(), []);
    } finally {
        await store.clear();
    }
});
