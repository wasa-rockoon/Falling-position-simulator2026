const test = require('node:test');
const assert = require('node:assert/strict');

const PredictionRunner = require('../js/pred/prediction-runner.js');
const VariantProfileRegistry = require('../js/pred/variant-profile-registry.js');
const ExportService = require('../js/core/export-service.js');
const MapLayerRegistry = require('../js/core/map-layer-registry.js');

function sampleResponse() {
    return {
        prediction: [
            { stage: 'ascent', trajectory: [
                { latitude: 33, longitude: 359.5, altitude: 10, datetime: '2026-08-15T00:00:00Z' },
                { latitude: 33.1, longitude: 359.7, altitude: 30000, datetime: '2026-08-15T01:00:00Z' }
            ] },
            { stage: 'descent', trajectory: [
                { latitude: 33.1, longitude: 359.7, altitude: 30000, datetime: '2026-08-15T01:00:00Z' },
                { latitude: 32.9, longitude: 360.5, altitude: 0, datetime: '2026-08-15T02:00:00Z' }
            ] }
        ]
    };
}

test('PredictionRunner normalizes Tawhiri response into a provider-neutral result', () => {
    const result = PredictionRunner.normalizePrediction(sampleResponse());
    assert.equal(result.profile, 'standard_profile');
    assert.equal(result.flightTimeSec, 7200);
    assert.equal(result.launch.longitude, -0.5);
    assert.equal(result.landing.longitude, 0.5);
    assert.equal(result.flightPath.length, 4);
});

test('PredictionRunner uses the supplied RequestContext and returns response diagnostics', async () => {
    let calls = 0;
    const context = {
        request: async (params, options) => {
            calls += 1;
            assert.equal(params.launch_latitude, 33);
            assert.equal(options.label, 'test-run');
            return { data: sampleResponse(), cacheHit: true };
        }
    };
    const result = await PredictionRunner.run({ launch_latitude: 33 }, context, { label: 'test-run' });
    assert.equal(calls, 1);
    assert.equal(result.landing.latitude, 32.9);
    assert.equal(result.response.cacheHit, true);
});

test('VariantProfileRegistry is the single 13-condition definition', () => {
    const variants = VariantProfileRegistry.buildEhime({ ascent_rate: 5, descent_rate: 5, burst_altitude: 30000 });
    assert.equal(variants.length, 13);
    assert.deepEqual(variants.map((variant) => variant.label), ['BASE', 'ASC-', 'ASC+', 'DES-', 'DES+', 'BURST-', 'BURST+', 'A-D-', 'A+D+', 'A-B-', 'A+B+', 'D-B-', 'D+B+']);
    assert.equal(variants[1].settings.ascent_rate, 4);
    assert.equal(variants[3].settings.descent_rate, 2);
    assert.equal(variants[5].settings.burst_altitude, 24000);
    assert.equal(variants[6].settings.burst_altitude, 33000);
});

test('ExportService consistently escapes CSV and creates KML trajectories', () => {
    assert.equal(ExportService.escapeCsv('A,"B"'), '"A,""B"""');
    const trajectory = { id: 'base', label: 'BASE', points: [
        { latitude: 33, longitude: 132, altitudeM: 10, timeUtc: '2026-08-15T00:00:00Z' },
        { latitude: 32.9, longitude: 132.2, altitudeM: 0, timeUtc: '2026-08-15T02:00:00Z' }
    ] };
    assert.match(ExportService.trajectoryCsv(trajectory), /BASE,33,132,10/);
    assert.match(ExportService.trajectoryKml(trajectory, 'test'), /132\.2,32\.9,0/);
});

test('MapLayerRegistry owns visibility and group cleanup', () => {
    const map = {};
    const calls = [];
    const layer = { addTo(target) { calls.push(['add', target]); return this; }, remove() { calls.push(['remove']); } };
    const registry = new MapLayerRegistry.Registry(map);
    registry.register('one', layer, { group: 'history' });
    assert.equal(registry.get('one'), layer);
    assert.equal(registry.isVisible('one'), true);
    registry.setVisible('one', false);
    assert.equal(registry.isVisible('one'), false);
    registry.clearGroup('history');
    assert.deepEqual(calls.map((entry) => entry[0]), ['add', 'remove', 'remove']);
    assert.equal(registry.get('one'), null);
});
