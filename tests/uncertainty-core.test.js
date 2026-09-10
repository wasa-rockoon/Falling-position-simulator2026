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

function stablePattern(count, classify = () => true) {
    const offsets = [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7]];
    return Array.from({ length: count }, (_, index) => ({
        lat: 33 + offsets[index % offsets.length][0] * 0.001,
        lng: 132 + offsets[index % offsets.length][1] * 0.001,
        landSea: { classification: classify(index) }
    }));
}

const stopOptions = {
    minSamples: 32, probabilityTolerance: 0.1, centroidToleranceKm: 1,
    ellipseRelativeTolerance: 0.1, requiredStableBatches: 2
};

test('sequential stop requires two stable batches after the minimum', () => {
    const observations = stablePattern(48, () => 'sea');
    const before = { stableBatches: 0, summary: core.summarizeObservations(observations.slice(0, 32)) };
    const first = core.evaluateSequentialStop(observations.slice(0, 40), stopOptions, before);
    assert.equal(first.stop, false);
    assert.equal(first.stableBatches, 1);
    const second = core.evaluateSequentialStop(observations, stopOptions, first);
    assert.equal(second.stop, true);
    assert.equal(second.reason, 'converged');
});

test('stable centroid does not converge while the 95% ellipse expands', () => {
    const initial = stablePattern(32, () => 'sea');
    const wider = stablePattern(8, () => 'sea').map((item) => ({
        ...item, lat: 33 + (item.lat - 33) * 12, lng: 132 + (item.lng - 132) * 12
    }));
    const result = core.evaluateSequentialStop(initial.concat(wider), stopOptions, {
        stableBatches: 1, summary: core.summarizeObservations(initial)
    });
    assert.ok(result.centroidShiftKm < stopOptions.centroidToleranceKm);
    assert.ok(result.ellipseAreaChange > stopOptions.ellipseRelativeTolerance);
    assert.equal(result.ellipseStable, false);
    assert.equal(result.stop, false);
});

test('minimum sample count, classified ratio and interval width are mandatory', () => {
    const belowMinimum = stablePattern(31, () => 'sea');
    assert.equal(core.evaluateSequentialStop(belowMinimum, stopOptions, { summary: core.summarizeObservations(belowMinimum), stableBatches: 1 }).stop, false);

    const twentyPercentUnknown = stablePattern(40, (index) => index % 5 === 0 ? 'unknown' : 'sea');
    const unknownResult = core.evaluateSequentialStop(twentyPercentUnknown, stopOptions, {
        summary: core.summarizeObservations(twentyPercentUnknown.slice(0, 32)), stableBatches: 1
    });
    assert.equal(unknownResult.determinedRatio, 0.8);
    assert.equal(unknownResult.stop, false);

    const mixed = stablePattern(40, (index) => index % 2 ? 'sea' : 'land');
    const strictInterval = { ...stopOptions, probabilityTolerance: 0.01 };
    const intervalResult = core.evaluateSequentialStop(mixed, strictInterval, {
        summary: core.summarizeObservations(mixed.slice(0, 32)), stableBatches: 1
    });
    assert.ok(intervalResult.summary.seaInterval.halfWidth > strictInterval.probabilityTolerance);
    assert.equal(intervalResult.stop, false);
});

test('zero-area ellipses produce finite relative changes', () => {
    const identical = Array.from({ length: 40 }, () => ({ lat: 33, lng: 132, landSea: { classification: 'sea' } }));
    const result = core.evaluateSequentialStop(identical, stopOptions, {
        stableBatches: 0, summary: core.summarizeObservations(identical.slice(0, 32))
    });
    assert.equal(result.ellipseAreaChange, 0);
    assert.equal(result.ellipseMajorChange, 0);
    assert.equal(result.ellipseMinorChange, 0);
    assert.ok([result.ellipseAreaChange, result.ellipseMajorChange, result.ellipseMinorChange].every(Number.isFinite));
});

test('Ehime GO samples cover the full 27-point grid except the separately-run baseline', () => {
    const base = { ascent_rate: 5, descent_rate: 5, burst_altitude: 30000 };
    const samples = core.createEhimeGoSamples(base);
    assert.equal(samples.length, 26);
    assert.deepEqual([...new Set(samples.concat(base).map((sample) => sample.ascent_rate))].sort((a, b) => a - b), [4, 5, 6]);
    assert.deepEqual([...new Set(samples.concat(base).map((sample) => sample.descent_rate))].sort((a, b) => a - b), [2, 5, 8]);
    assert.deepEqual([...new Set(samples.concat(base).map((sample) => sample.burst_altitude))].sort((a, b) => a - b), [24000, 30000, 33000]);
    assert.throws(() => core.createEhimeGoSamples({ ascent_rate: 1, descent_rate: 5, burst_altitude: 30000 }), /上昇速度/);
    assert.throws(() => core.createEhimeGoSamples({ ascent_rate: 5, descent_rate: 3, burst_altitude: 30000 }), /下降速度/);
});

test('Ehime GO requires all 27 landings to be sea within 12 nautical miles', () => {
    const passing = Array.from({ length: 27 }, () => ({ landSea: { classification: 'sea', coastDistanceKm: 22.224 } }));
    assert.equal(core.evaluateEhimeGo(passing).status, 'go');
    const tooFar = passing.map((row) => ({ landSea: { ...row.landSea } }));
    tooFar[3].landSea.coastDistanceKm = 22.225;
    assert.equal(core.evaluateEhimeGo(tooFar).status, 'no-go');
    const land = passing.map((row) => ({ landSea: { ...row.landSea } }));
    land[2].landSea.classification = 'land';
    assert.equal(core.evaluateEhimeGo(land).status, 'no-go');
    const unknown = passing.map((row) => ({ landSea: { ...row.landSea } }));
    unknown[1].landSea.classification = 'unknown';
    assert.equal(core.evaluateEhimeGo(unknown).status, 'indeterminate');
    assert.equal(core.evaluateEhimeGo(passing.slice(0, 26)).status, 'pending');
    assert.equal(core.EHIME_GO_COAST_LIMIT_KM, 22.224);
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
test('inland water is determined but never counted as sea, while unknown stays separate', () => {
    const observations = [
        { lat: 33, lng: 132, landSea: { classification: 'sea' } },
        { lat: 33.1, lng: 132.1, landSea: { classification: 'land' } },
        { lat: 33.2, lng: 132.2, landSea: { classification: 'inland_water' } },
        { lat: 33.3, lng: 132.3, landSea: { classification: 'unknown' } }
    ];
    const summary = core.summarizeObservations(observations);
    assert.equal(summary.classified, 3);
    assert.equal(summary.sea, 1);
    assert.equal(summary.land, 1);
    assert.equal(summary.inlandWater, 1);
    assert.equal(summary.unknown, 1);
    assert.equal(summary.seaProbability, 1 / 3);
});
