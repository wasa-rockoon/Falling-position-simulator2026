const test = require('node:test');
const assert = require('node:assert/strict');
const PredictionApi = require('../js/pred/pred-api-client.js');

function delay(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

test('API URL resolution does not mutate global state', () => {
    assert.equal(PredictionApi.resolveApiUrl('sondehub'), PredictionApi.SONDEHUB_URL);
    assert.equal(PredictionApi.resolveApiUrl('local'), '/api/v1/');
    assert.equal(PredictionApi.resolveApiUrl('custom', 'http://example.test/api'), 'http://example.test/api');
    assert.throws(() => PredictionApi.resolveApiUrl('custom', ''), /URL/);
});

test('request URL keys are stable regardless of parameter order', () => {
    const first = PredictionApi.cacheKey('/api/v1/', { b: 2, a: 1 }, 'http://localhost:3100/');
    const second = PredictionApi.cacheKey('/api/v1/', { a: 1, b: 2 }, 'http://localhost:3100/');
    assert.equal(first, second);
});

test('default browser fetch keeps the global Window binding', async () => {
    const originalFetch = globalThis.fetch;
    let observedThis = null;
    globalThis.fetch = async function () {
        observedThis = this;
        return {
            ok: true,
            status: 200,
            headers: { get: () => null },
            json: async () => ({ prediction: [] })
        };
    };
    try {
        const client = new PredictionApi.PredictionClient({
            source: 'custom',
            baseUrl: 'https://binding.example.test/tawhiri',
            policy: { concurrency: 1, minIntervalMs: 0, timeoutMs: 1000, maxRetries: 0 }
        });
        await client.request({ launch_latitude: 33 }, { cache: false });
        assert.equal(observedThis, globalThis);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('queue enforces concurrency', async () => {
    const queue = new PredictionApi.RequestQueue({ concurrency: 2, minIntervalMs: 0 });
    let active = 0;
    let maximum = 0;
    const tasks = Array.from({ length: 6 }, () => queue.add(async () => {
        active += 1;
        maximum = Math.max(maximum, active);
        await delay(10);
        active -= 1;
    }));
    await Promise.all(tasks);
    assert.equal(maximum, 2);
});

test('stopAfterCurrent pauses before the next request', async () => {
    const queue = new PredictionApi.RequestQueue({ concurrency: 1, minIntervalMs: 0 });
    let releaseFirst;
    let secondStarted = false;
    const first = queue.add(() => new Promise((resolve) => { releaseFirst = resolve; }));
    const second = queue.add(async () => { secondStarted = true; });
    await delay(0);
    queue.stopAfterCurrent();
    releaseFirst();
    await first;
    await delay(10);
    assert.equal(secondStarted, false);
    assert.equal(queue.snapshot().paused, true);
    queue.resume();
    await second;
    assert.equal(secondStarted, true);
});

test('an external AbortSignal stops an active HTTP request immediately', async () => {
    const controller = new AbortController();
    const client = new PredictionApi.PredictionClient({
        source: 'custom',
        baseUrl: 'https://example.test/tawhiri',
        policy: { concurrency: 1, minIntervalMs: 0, timeoutMs: 10000, maxRetries: 0 },
        fetchImpl: async (_url, options) => new Promise((_resolve, reject) => {
            options.signal.addEventListener('abort', () => {
                const error = new Error('aborted');
                error.name = 'AbortError';
                reject(error);
            }, { once: true });
        })
    });
    const pending = client.request({ launch_latitude: 33 }, { cache: false, signal: controller.signal });
    await delay(0);
    controller.abort();
    await assert.rejects(pending, /aborted|中断/);
    assert.equal(client.queue.snapshot().active, 0);
});
test('client caches identical successful requests', async () => {
    let calls = 0;
    const client = new PredictionApi.PredictionClient({
        source: 'custom',
        baseUrl: 'https://example.test/tawhiri',
        cacheTtlMs: 60000,
        policy: { concurrency: 1, minIntervalMs: 0, timeoutMs: 1000, maxRetries: 0 },
        fetchImpl: async () => {
            calls += 1;
            return {
                ok: true,
                status: 200,
                headers: { get: () => null },
                json: async () => ({ prediction: [{ stage: 'ascent', trajectory: [] }] })
            };
        }
    });
    const params = { launch_latitude: 33, launch_longitude: 132 };
    const first = await client.request(params);
    const second = await client.request(params);
    assert.equal(first.cacheHit, false);
    assert.equal(second.cacheHit, true);
    assert.equal(calls, 1);
});


test('client deduplicates simultaneous identical requests', async () => {
    let calls = 0;
    const client = new PredictionApi.PredictionClient({
        source: 'custom',
        baseUrl: 'https://dedupe.example.test/tawhiri',
        policy: { concurrency: 2, minIntervalMs: 0, timeoutMs: 1000, maxRetries: 0 },
        fetchImpl: async () => {
            calls += 1;
            await delay(15);
            return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ prediction: [] }) };
        }
    });
    const [first, second] = await Promise.all([
        client.request({ launch_latitude: 33 }),
        client.request({ launch_latitude: 33 })
    ]);
    assert.equal(calls, 1);
    assert.deepEqual(first.data, second.data);
});


test('client reports every HTTP attempt including retries', async () => {
    let fetchCalls = 0;
    let attempts = 0;
    const client = new PredictionApi.PredictionClient({
        source: 'custom',
        baseUrl: 'https://attempts.example.test/tawhiri',
        policy: { concurrency: 1, minIntervalMs: 0, timeoutMs: 1000, maxRetries: 2 },
        fetchImpl: async () => {
            fetchCalls += 1;
            if (fetchCalls < 3) {
                return { ok: false, status: 503, headers: { get: () => null } };
            }
            return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ prediction: [] }) };
        }
    });
    await client.request({ launch_latitude: 34 }, { onAttempt: () => { attempts += 1; } });
    assert.equal(fetchCalls, 3);
    assert.equal(attempts, 3);
});

test('client does not start an HTTP attempt after a caller budget is exhausted', async () => {
    let fetchCalls = 0;
    const client = new PredictionApi.PredictionClient({
        source: 'custom',
        baseUrl: 'https://limit.example.test/tawhiri',
        policy: { concurrency: 1, minIntervalMs: 0, timeoutMs: 1000, maxRetries: 2 },
        fetchImpl: async () => {
            fetchCalls += 1;
            return { ok: false, status: 503, headers: { get: () => null } };
        }
    });
    let remaining = 1;
    await assert.rejects(
        client.request({ launch_latitude: 35 }, {
            canAttempt: () => remaining > 0,
            onAttempt: () => { remaining -= 1; }
        }),
        (error) => error.callLimit === true
    );
    assert.equal(fetchCalls, 1);
});
test('client keeps a bounded in-memory cache under a 1000-request workload', async () => {
    let calls = 0;
    const client = new PredictionApi.PredictionClient({
        source: 'custom',
        baseUrl: 'https://bounded-cache.example.test/tawhiri',
        maxMemoryEntries: 50,
        maxPersistentEntries: 2000,
        persistentPruneInterval: 2000,
        policy: { concurrency: 4, minIntervalMs: 0, timeoutMs: 1000, maxRetries: 0 },
        fetchImpl: async () => {
            calls += 1;
            return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ prediction: [] }) };
        }
    });
    for (let index = 0; index < 1000; index += 1) {
        await client.request({ launch_latitude: 33, sample: index });
    }
    const snapshot = client.cacheSnapshot();
    assert.equal(calls, 1000);
    assert.equal(snapshot.memoryEntries, 50);
    assert.equal(snapshot.maximumMemoryEntries, 50);
    assert.equal(snapshot.inFlight, 0);
});
test('client retries transient offline fetch failures without exceeding the attempt count', async () => {
    let calls = 0;
    const client = new PredictionApi.PredictionClient({
        source: 'custom',
        baseUrl: 'https://offline-retry.example.test/tawhiri',
        policy: { concurrency: 1, minIntervalMs: 0, timeoutMs: 1000, maxRetries: 2, maxBackoffMs: 1 },
        fetchImpl: async () => {
            calls += 1;
            if (calls < 3) throw new TypeError('offline');
            return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ prediction: [] }) };
        }
    });
    const attempts = [];
    const result = await client.request({ launch_latitude: 36 }, { onAttempt: (attempt) => attempts.push(attempt) });
    assert.equal(result.cacheHit, false);
    assert.equal(calls, 3);
    assert.deepEqual(attempts, [1, 2, 3]);
});
