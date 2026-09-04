const test = require('node:test');
const assert = require('node:assert/strict');

const workload = require('../js/pred/workload-core.js');

test('retry-inclusive workload estimate distinguishes logical calls and HTTP attempts', () => {
    assert.deepEqual(workload.estimateAttempts(100, 2, 20), {
        logicalCalls: 100,
        expectedCacheHits: 20,
        networkRequests: 80,
        expectedHttpAttempts: 80,
        worstCaseHttpAttempts: 240
    });
});

test('public API advice warns only above the recommended attempt budget', () => {
    assert.equal(workload.apiAdvice('sondehub', 300).aboveRecommended, false);
    assert.equal(workload.apiAdvice('sondehub', 301).aboveRecommended, true);
    assert.equal(workload.apiAdvice('local', 10000).aboveRecommended, false);
});

test('round-robin selection skips completed and errored site runs', () => {
    const runs = [
        { cursor: 2, cap: 2, status: 'completed' },
        { cursor: 1, cap: 3, status: 'pending' },
        { cursor: 0, cap: 3, status: 'error' },
        { cursor: 1, cap: 3, status: 'pending' }
    ];
    assert.equal(workload.nextRunnableIndex(runs, 0), 1);
    assert.equal(workload.nextRunnableIndex(runs, 2), 3);
    assert.equal(workload.nextRunnableIndex(runs, 0, () => false), -1);
});

test('1000 round-robin selections do not starve any runnable site', () => {
    const runs = Array.from({ length: 10 }, () => ({ cursor: 0, cap: 100, status: 'pending' }));
    let next = 0;
    for (let count = 0; count < 1000; count += 1) {
        const index = workload.nextRunnableIndex(runs, next);
        assert.notEqual(index, -1);
        runs[index].cursor += 1;
        next = (index + 1) % runs.length;
    }
    assert.deepEqual(runs.map((run) => run.cursor), Array(10).fill(100));
    assert.equal(workload.nextRunnableIndex(runs, next), -1);
});

test('diagnostics normalize legacy snapshots and enforce attempt budget', () => {
    const diagnostics = workload.normalizeDiagnostics({ httpAttempts: '7', cacheHits: 2 });
    assert.equal(diagnostics.httpAttempts, 7);
    assert.equal(diagnostics.retryCount, 0);
    assert.equal(workload.isAttemptBudgetExhausted(diagnostics, 7), true);
    assert.equal(workload.isAttemptBudgetExhausted(diagnostics, 8), false);
});
