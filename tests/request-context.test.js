const test = require('node:test');
const assert = require('node:assert/strict');
const PredictionApi = require('../js/pred/pred-api-client.js');
const RequestContext = require('../js/pred/request-context.js');

function response(data) {
    return {
        ok: true,
        status: 200,
        headers: { get() { return null; } },
        async json() { return data; }
    };
}

test('RequestContext fixes endpoint and tracks attempts, cache hits and budget', async () => {
    await PredictionApi.clearCache();
    let fetchCalls = 0;
    const context = RequestContext.create({
        runId: 'run_budget',
        source: 'custom',
        resolvedBaseUrl: 'https://phase1.example.test/predict',
        maxHttpAttempts: 1,
        fetchImpl: async () => {
            fetchCalls += 1;
            return response({ prediction: [] });
        }
    });

    const first = await context.request({ launch: 'a' });
    assert.equal(first.cacheHit, false);
    const cached = await context.request({ launch: 'a' });
    assert.equal(cached.cacheHit, true);
    assert.equal(fetchCalls, 1);
    assert.equal(context.diagnostics.httpAttempts, 1);
    assert.equal(context.diagnostics.cacheHits, 1);

    await assert.rejects(context.request({ launch: 'b' }), (error) => {
        assert.equal(error.code, 'PREDICTION_REQUEST_FAILED');
        assert.equal(error.runId, 'run_budget');
        return true;
    });
    assert.equal(fetchCalls, 1);
    assert.equal(context.resolvedBaseUrl, 'https://phase1.example.test/predict');
});

test('RequestContext snapshot restores immutable request settings and diagnostics', async () => {
    const context = RequestContext.create({
        runId: 'run_restore',
        source: 'custom',
        resolvedBaseUrl: 'https://restore.example.test/predict',
        maxHttpAttempts: 5,
        cacheTtlMs: 5000,
        fetchImpl: async () => response({ prediction: [] })
    });
    context.diagnostics.httpAttempts = 2;
    const snapshot = context.snapshot();
    const restored = RequestContext.restore(snapshot, {
        fetchImpl: async () => response({ prediction: [] })
    });
    assert.equal(restored.runId, 'run_restore');
    assert.equal(restored.resolvedBaseUrl, 'https://restore.example.test/predict');
    assert.equal(restored.maxHttpAttempts, 5);
    assert.equal(restored.cachePolicy.ttlMs, 5000);
    assert.equal(restored.diagnostics.httpAttempts, 2);
});
