const test = require('node:test');
const assert = require('node:assert/strict');
const AutoSearchCore = require('../js/pred/auto-search-core.js');

const candidates = [
    { id: 'a', lat: 33, lon: 132, launchUtc: '2026-08-09T00:00:00Z', coarse: { ok: false, reason: 'land' } },
    { id: 'b', lat: 33, lon: 132, launchUtc: '2026-08-09T01:00:00Z', coarse: { ok: true, reason: 'pass', distanceKm: 4 } },
    { id: 'c', lat: 33, lon: 132, launchUtc: '2026-08-10T00:00:00Z', coarse: { ok: false, reason: 'too_far_offshore', distanceKm: 30 } }
];

test('weather calls are shared by location and UTC date', () => {
    assert.equal(AutoSearchCore.countUniqueWeatherCalls(candidates), 2);
    assert.deepEqual(AutoSearchCore.estimateMaximumCalls(candidates, 13), {
        weather: 2, coarse: 3, fine: 39, total: 44
    });
});

test('full mode never rejects a coarse-search failure', () => {
    assert.deepEqual(AutoSearchCore.selectFineCandidates(candidates, 'full').map((item) => item.id), ['a', 'b', 'c']);
});

test('fast mode rejects coarse-search failures', () => {
    assert.deepEqual(AutoSearchCore.selectFineCandidates(candidates, 'fast').map((item) => item.id), ['b']);
});

test('ranked mode keeps all candidates and puts likely passes first', () => {
    assert.deepEqual(AutoSearchCore.selectFineCandidates(candidates, 'ranked').map((item) => item.id), ['b', 'c', 'a']);
});

test('thresholds are inclusive lower and upper bounds', () => {
    assert.equal(AutoSearchCore.passesSeaThreshold(75, 75), true);
    assert.equal(AutoSearchCore.passesWeather({ status: 'ok', precipitationMm: 1, windSpeedMs: 10 }, { rainThreshold: 1, windThreshold: 10 }), true);
});
test('sea threshold includes inland water in the known denominator and never auto-passes unknown', () => {
    const clear = AutoSearchCore.evaluateSeaCondition({ sea: 9, land: 2, inlandWater: 1, unknown: 0 }, 75);
    assert.equal(clear.seaPercent, 75);
    assert.equal(clear.classified, 12);
    assert.equal(clear.pass, true);

    const review = AutoSearchCore.evaluateSeaCondition({ sea: 9, land: 2, inlandWater: 1, unknown: 1 }, 75);
    assert.equal(review.thresholdPassed, true);
    assert.equal(review.requiresReview, true);
    assert.equal(review.pass, false);
});

test('time slots, sites and flight conditions expand into a deduplicated candidate matrix', () => {
    const expanded = AutoSearchCore.expandCandidates(
        [
            { launchUtc: '2026-09-16T00:00:00Z', windowIndex: 0 },
            { launchUtc: '2026-09-17T00:00:00Z', windowIndex: 1 }
        ],
        [{ name: 'site-a', lat: 33, lon: 132, alt: 10 }],
        [
            { key: 'base', label: '基準', settings: { ascent_rate: 5, descent_rate: 5, burst_altitude: 30000 } },
            { key: 'fast', label: '高速', settings: { ascent_rate: 6, descent_rate: 5, burst_altitude: 32000 } }
        ]
    );
    assert.equal(expanded.length, 4);
    assert.deepEqual(expanded.map(item => item.conditionLabel), ['基準', '高速', '基準', '高速']);
    assert.equal(expanded[3].runSettings.burst_altitude, 32000);
    assert.equal(AutoSearchCore.countUniqueWeatherCalls(expanded), 2);
});
