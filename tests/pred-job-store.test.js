const test = require('node:test');
const assert = require('node:assert/strict');
const PredictionJobStore = require('../js/pred/pred-job-store.js');

test('job snapshots round-trip with schema metadata', async () => {
    const store = new PredictionJobStore.JobStore('test-search');
    await store.clear();
    await store.save({ phase: 2, completed: 4 });
    const loaded = await store.load();
    assert.equal(loaded.phase, 2);
    assert.equal(loaded.completed, 4);
    assert.equal(loaded.schemaVersion, 1);
    assert.equal(loaded.jobType, 'test-search');
    await store.clear();
});

test('pause controller stops only at a job boundary', () => {
    const controller = new PredictionJobStore.PauseController();
    controller.start();
    controller.requestPause();
    assert.equal(controller.status, 'pausing');
    assert.equal(controller.reachBoundary(), true);
    assert.equal(controller.status, 'paused');
    controller.resume();
    assert.equal(controller.status, 'running');
});
