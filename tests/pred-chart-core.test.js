const test = require('node:test');
const assert = require('node:assert/strict');
const ChartCore = require('../js/pred/pred-chart-core.js');

function prediction(offset) {
    const start = Date.parse('2026-08-15T00:00:00Z');
    return [{
        trajectory: [0, 1, 2].map((index) => ({
            datetime: new Date(start + index * 60000).toISOString(),
            latitude: 33 + index * 0.001,
            longitude: 132 + (offset || 0),
            altitude: index === 0 ? 100 : (index === 1 ? 1000 : 50)
        }))
    }];
}

test('chart core builds elapsed altitude and finite horizontal wind profiles', () => {
    const points = ChartCore.flattenPrediction(prediction());
    assert.equal(points.length, 3);
    assert.deepEqual(ChartCore.buildAltitudeData(points), [
        { x: 0, y: 100 }, { x: 1, y: 1000 }, { x: 2, y: 50 }
    ]);
    const wind = ChartCore.buildWindData(points);
    assert.equal(wind.length, 2);
    assert.ok(wind.every((point) => point.x > 1.8 && point.x < 1.9));
    assert.deepEqual(wind.map((point) => point.y), [550, 525]);
});

test('series registry stores all candidates but displays at most five', () => {
    const registry = new ChartCore.SeriesRegistry({ maxStored: 13, maxVisible: 5 });
    for (let index = 0; index < 7; index += 1) {
        registry.upsert(prediction(index * 0.01), { id: `v${index}`, label: `V${index}`, groupId: 'ehime-run' });
    }
    assert.equal(registry.snapshot().length, 7);
    assert.equal(registry.visibleItems().length, 5);
    assert.equal(registry.setVisible('v5', true).reason, 'visible_limit');
    assert.equal(registry.setVisible('v0', false).ok, true);
    assert.equal(registry.setVisible('v5', true).ok, true);
    assert.equal(registry.visibleItems().length, 5);
});

test('a new run group clears stale graph series', () => {
    const registry = new ChartCore.SeriesRegistry();
    registry.upsert(prediction(), { id: 'base', groupId: 'run-a' });
    registry.upsert(prediction(), { id: 'single', groupId: 'run-b' });
    assert.deepEqual(registry.snapshot().map((item) => item.id), ['single']);
});
