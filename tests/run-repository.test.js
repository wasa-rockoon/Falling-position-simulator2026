const test = require('node:test');
const assert = require('node:assert/strict');
const AppStorage = require('../js/core/app-storage.js');
const RunRecord = require('../js/domain/run-record.js');
const defaultRepository = require('../js/core/run-repository.js');

test('RunRepository distinguishes active runs and protects them from deletion', async () => {
    const repository = new defaultRepository.Repository({ historyLimit: 50 });
    await repository.clearAll();
    const paused = RunRecord.create({ id: 'run_active', type: 'auto_search', status: 'paused' });
    await repository.save(paused);
    assert.equal((await repository.getActive('auto_search')).length, 1);
    await assert.rejects(repository.remove('run_active'), /削除できません/);

    await repository.update('run_active', { status: 'running' });
    await repository.update('run_active', { status: 'completed', output: { metrics: { seaRate: 80 } } });
    assert.equal((await repository.getActive('auto_search')).length, 0);
    assert.equal(await repository.remove('run_active'), true);
});

test('RunRepository keeps pinned records and prunes only old unpinned terminal records', async () => {
    const repository = new defaultRepository.Repository({ historyLimit: 2 });
    await repository.clearAll();

    await repository.save(RunRecord.create({ id: 'run_pinned', type: 'single', status: 'completed', updatedAt: '2026-01-01T00:00:00.000Z' }));
    await repository.setPinned('run_pinned', true);
    await repository.save(RunRecord.create({ id: 'run_old', type: 'single', status: 'completed', updatedAt: '2026-01-02T00:00:00.000Z' }));
    await repository.save(RunRecord.create({ id: 'run_mid', type: 'single', status: 'completed', updatedAt: '2026-01-03T00:00:00.000Z' }));
    await repository.save(RunRecord.create({ id: 'run_new', type: 'single', status: 'completed', updatedAt: '2026-01-04T00:00:00.000Z' }));

    const history = await repository.listHistory();
    assert.deepEqual(history.map((item) => item.runId), ['run_pinned', 'run_new', 'run_mid']);
    assert.equal(await repository.get('run_old'), undefined);
});

test('legacy Ehime history migration is idempotent and does not delete its source', async () => {
    const repository = new defaultRepository.Repository({ historyLimit: 50 });
    await repository.clearAll();
    const source = [{
        savedAt: '2026-08-01T00:00:00.000Z',
        siteName: 'test site',
        waterCount: 1,
        landCount: 0,
        meanLat: 33,
        meanLng: 132,
        rows: [{ label: 'BASE', lat: 33, lng: 132, isWater: true, flightPath: [[33, 132, 10]] }],
        baseSettings: {
            launch_latitude: 33,
            launch_longitude: 132,
            initial_alt: 10,
            launch_datetime: '2026-08-01T00:00:00.000Z',
            ascent_rate: 5,
            descent_rate: 4,
            burst_altitude: 30000
        }
    }];
    const first = await repository.migrateLegacyEhime(source);
    const second = await repository.migrateLegacyEhime(source);
    assert.equal(first.imported, 1);
    assert.equal(second.imported, 1);
    assert.equal(source.length, 1);
    const runs = await repository.listRuns({ type: 'ehime_ensemble' });
    assert.equal(runs.length, 1);
    assert.equal(runs[0].output.landings[0].landSea.classification, 'sea');
});

test('AppStorage exposes versioned RunRecord stores and lists cloned values', async () => {
    assert.equal(AppStorage.databaseVersion, 2);
    assert.ok(AppStorage.storeNames.includes('runs'));
    const store = AppStorage.createStore('runs');
    await store.clear();
    const value = { nested: { count: 1 } };
    await store.set('a', value);
    value.nested.count = 9;
    const listed = await store.list();
    assert.deepEqual(listed, [{ key: 'a', value: { nested: { count: 1 } } }]);
});
