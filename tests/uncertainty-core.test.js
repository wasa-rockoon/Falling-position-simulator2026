const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../js/pred/uncertainty-core.js');

test('Monte Carlo, LHS and Sobol samples are deterministic and bounded', () => {
    for (const method of ['monte-carlo', 'lhs', 'sobol']) {
        const first = core.unitPoints(method, 32, 3, 'seed-1');
        const second = core.unitPoints(method, 32, 3, 'seed-1');
        assert.deepEqual(first, second, method);
        assert.equal(first.length, 32);
        assert.ok(first.every((row) => row.length === 3 && row.every((value) => value >= 0 && value < 1)));
    }
});

test('Latin hypercube covers every stratum once in each dimension', () => {
    const count = 16;
    const points = core.unitPoints('lhs', count, 3, 'lhs');
    for (let dimension = 0; dimension < 3; dimension += 1) {
        const strata = points.map((point) => Math.floor(point[dimension] * count)).sort((a, b) => a - b);
        assert.deepEqual(strata, Array.from({ length: count }, (_, index) => index));
    }
});

test('normal and Weibull transforms preserve a requested mean approximately', () => {
    const units = core.unitPoints('sobol', 4096, 1, 'distribution').map((point) => point[0]);
    for (const distribution of ['normal', 'weibull']) {
        const values = units.map((unit) => core.transformUnit(unit, 100, 0.1, distribution, 0));
        const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
        assert.ok(Math.abs(mean - 100) < 0.6, `${distribution} mean=${mean}`);
        assert.ok(values.every((value) => value >= 0));
    }
});

test('parameter samples vary ascent, descent and burst while respecting floors', () => {
    const samples = core.createParameterSamples({
        ascent_rate: 5,
        descent_rate: 8,
        burst_altitude: 30000,
        launch_altitude: 100
    }, {
        method: 'sobol',
        distribution: 'normal',
        count: 24,
        ascentCvPct: 10,
        descentCvPct: 20,
        burstCvPct: 15,
        seed: 'params'
    });
    assert.equal(samples.length, 24);
    assert.ok(new Set(samples.map((sample) => sample.ascent_rate.toFixed(4))).size > 10);
    assert.ok(samples.every((sample) => sample.ascent_rate >= 0.1 && sample.descent_rate >= 0.1 && sample.burst_altitude >= 200));
});

test('Wilson interval narrows as observations increase', () => {
    const small = core.wilsonInterval(5, 10);
    const large = core.wilsonInterval(50, 100);
    assert.ok(large.halfWidth < small.halfWidth);
    assert.ok(large.low < 0.5 && large.high > 0.5);
});

test('sequential stop requires repeated stable batches', () => {
    const observations = Array.from({ length: 40 }, (_, index) => ({
        lat: 33 + (index % 3) * 0.00001,
        lng: 132 + (index % 3) * 0.00001,
        isWater: true
    }));
    const options = { minSamples: 12, probabilityTolerance: 0.1, centroidToleranceKm: 0.2, requiredStableBatches: 2 };
    const first = core.evaluateSequentialStop(observations.slice(0, 24), options, {
        stableBatches: 0,
        summary: core.summarizeObservations(observations.slice(0, 16))
    });
    assert.equal(first.stop, false);
    const second = core.evaluateSequentialStop(observations.slice(0, 40), options, first);
    assert.equal(second.stop, true);
    assert.equal(second.reason, 'converged');
});

test('budget planner fairly caps calls per site', () => {
    const plan = core.planBudget(10, { minSamples: 12, maxSamples: 48, callLimit: 200 });
    assert.equal(plan.perSiteCap, 20);
    assert.equal(plan.maximumCalls, 200);
    assert.equal(plan.canReachMinimum, true);
    assert.equal(plan.reducedByLimit, true);
    const tooSmall = core.planBudget(20, { minSamples: 12, maxSamples: 48, callLimit: 100 });
    assert.equal(tooSmall.canReachMinimum, false);
});

test('JST analysis datetime converts to UTC and restores without drift', () => {
    const iso = core.jstDateTimeToUtcIso('2026-08-09', '20:40');
    assert.equal(iso, '2026-08-09T11:40:00.000Z');
    assert.deepEqual(core.utcIsoToJstParts(iso), { date: '2026-08-09', time: '20:40' });
    assert.throws(() => core.jstDateTimeToUtcIso('2026-02-30', '10:00'), /不正/);
});
test('elongated landings produce an oriented ellipse and KDE contours', () => {
    const observations = Array.from({ length: 40 }, (_, index) => ({
        lat: 33 + Math.sin(index * 1.7) * 0.002,
        lng: 132 + (index - 19.5) * 0.01,
        isWater: index % 3 !== 0
    }));
    const summary = core.summarizeObservations(observations);
    assert.ok(summary.ellipse95);
    assert.ok(summary.ellipse95.majorKm > summary.ellipse95.minorKm * 8);
    const horizontalBearingError = Math.min(
        Math.abs(summary.ellipse95.bearingDeg - 90),
        Math.abs(summary.ellipse95.bearingDeg - 270)
    );
    assert.ok(horizontalBearingError < 5, `bearing=${summary.ellipse95.bearingDeg}`);
    assert.ok(summary.densityContours);
    assert.deepEqual(summary.densityContours.levels.map((level) => level.mass), [0.5, 0.8, 0.95]);
    assert.ok(summary.densityContours.levels.every((level) => level.segments.length > 0));
});

test('density contours wait for enough samples', () => {
    const observations = Array.from({ length: 7 }, (_, index) => ({ lat: 33, lng: 132 + index * 0.001, isWater: true }));
    assert.equal(core.summarizeObservations(observations).densityContours, null);
});