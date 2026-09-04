const test = require('node:test');
const assert = require('node:assert/strict');
const RunRecord = require('../js/domain/run-record.js');

test('RunRecord normalizes inputs and enforces lifecycle transitions', () => {
    const draft = RunRecord.create({
        id: 'run_contract',
        type: 'single',
        input: {
            launch: { latitude: '33.1', longitude: '132.5', altitudeM: '20' },
            flight: { ascentRateMps: '5', descentRateMps: '4', burstAltitudeM: '30000' }
        }
    });
    assert.equal(draft.schemaVersion, 1);
    assert.equal(draft.input.launch.latitude, 33.1);
    assert.equal(draft.status, 'draft');

    const running = RunRecord.transition(draft, 'running');
    const requested = RunRecord.transition(running, 'pause_requested', { progress: { requestedAction: 'pause' } });
    const paused = RunRecord.transition(requested, 'paused');
    const resumed = RunRecord.transition(paused, 'running');
    const completed = RunRecord.transition(resumed, 'completed', {
        output: { metrics: { seaRate: 75 } }
    });
    assert.ok(completed.finishedAt);
    assert.equal(completed.output.metrics.seaRate, 75);
    assert.throws(() => RunRecord.transition(completed, 'running'), /Invalid RunRecord transition/);
});

test('RunRecord history summary preserves unknown and sea rates', () => {
    const record = RunRecord.create({
        id: 'run_summary',
        type: 'uncertainty',
        status: 'completed',
        output: {
            landings: [{ latitude: 1, longitude: 2 }],
            metrics: { seaRate: 80, unknownRate: 10, nearestSupportDistanceKm: 4.5 }
        }
    });
    const history = RunRecord.createHistoryEntry(record, true);
    assert.equal(history.pinned, true);
    assert.deepEqual(history.summary, {
        landingCount: 1,
        seaRate: 80,
        unknownRate: 10,
        nearestSupportDistanceKm: 4.5
    });
});

test('RunRecord error contract is serializable and tied to the run', () => {
    const record = RunRecord.create({
        id: 'run_error',
        type: 'single',
        status: 'failed',
        error: Object.assign(new Error('network down'), { code: 'NETWORK', retryable: true })
    });
    assert.equal(record.error.code, 'NETWORK');
    assert.equal(record.error.runId, 'run_error');
    assert.equal(record.error.retryable, true);
    assert.doesNotThrow(() => JSON.stringify(record));
});
