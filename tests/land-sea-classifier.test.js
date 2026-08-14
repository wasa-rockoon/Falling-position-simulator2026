const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const LandSeaClassifier = require('../js/geo/land-sea-classifier.js');

const root = path.resolve(__dirname, '..');
const readJson = (relative) => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));

function realClassifier() {
    return LandSeaClassifier.create({
        landGeoJson: readJson('data/land_japan_raw.geojson'),
        inlandWaterGeoJson: readJson('data/inland_water_japan_w09_05.geojson'),
        metadata: readJson('data/land-sea-datasets.json')
    });
}

test('fixed regional points classify deterministically with one data version', () => {
    const classifier = realClassifier();
    const points = [
        ['Shikoku / Matsuyama', 33.8392, 132.7656, 'land'],
        ['Kyushu / Fukuoka', 33.5902, 130.4017, 'land'],
        ['Chugoku / Hiroshima', 34.3853, 132.4553, 'land'],
        ['Yakushima island', 30.3350, 130.5200, 'land'],
        ['Oki island', 36.2450, 133.3100, 'land'],
        ['Pacific Ocean', 32.0000, 133.0000, 'sea'],
        ['Lake Biwa', 35.2500, 136.0800, 'inland_water'],
        ['Outside coverage', 0, 0, 'unknown']
    ];
    const versions = new Set();
    for (const [label, lat, lon, expected] of points) {
        const first = classifier.classify(lat, lon);
        const second = classifier.classify(lat, lon);
        assert.equal(first.classification, expected, label);
        assert.deepEqual(second, first, `${label} changed between calls`);
        if (expected !== 'unknown') versions.add(first.dataVersion);
    }
    assert.deepEqual([...versions], ['jp-ne10m-d606b972-w09-05-07cdd494-v1']);
});

test('polygon holes, multipolygons and exact boundaries have explicit outcomes', () => {
    const land = {
        type: 'FeatureCollection',
        features: [{
            type: 'Feature', properties: {}, geometry: {
                type: 'MultiPolygon', coordinates: [
                    [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]], [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]]],
                    [[[12, 0], [14, 0], [14, 2], [12, 2], [12, 0]]]
                ]
            }
        }]
    };
    const water = {
        type: 'FeatureCollection',
        features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[20, 20], [21, 20], [21, 21], [20, 21], [20, 20]]] } }]
    };
    const classifier = LandSeaClassifier.create({ landGeoJson: land, inlandWaterGeoJson: water, metadata: { version: 'synthetic-v1', coverage: [-1, -1, 22, 22] } });
    assert.equal(classifier.classify(1, 1).classification, 'land');
    assert.equal(classifier.classify(5, 5).classification, 'inland_water');
    assert.equal(classifier.classify(1, 13).classification, 'land');
    assert.equal(classifier.classify(15, 15).classification, 'sea');
    assert.equal(classifier.classify(0, 5).classification, 'unknown');
});

test('legacy water conversion never counts inland water as sea', () => {
    const classifier = realClassifier();
    assert.equal(classifier.legacyIsWater(32, 133), true);
    assert.equal(classifier.legacyIsWater(33.8392, 132.7656), false);
    assert.equal(classifier.legacyIsWater(35.25, 136.08), null);
});

test('dataset hashes and attribution match the manifest', () => {
    const manifest = readJson('data/land-sea-datasets.json');
    for (const dataset of [manifest.land, manifest.inlandWater]) {
        const bytes = fs.readFileSync(path.join(root, dataset.file));
        assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), dataset.sha256, dataset.file);
        assert.ok(dataset.sourceUrl);
        assert.ok(dataset.license);
        assert.ok(dataset.licenseUrl);
    }
    assert.equal(manifest.inlandWater.featureCount, 556);
    assert.equal(manifest.inlandWater.holeCount, 667);
});

test('bulk local classification performs no external lookup', () => {
    const classifier = realClassifier();
    const points = Array.from({ length: 500 }, (_, index) => ({ lat: 32 + (index % 50) * 0.1, lng: 129 + (index % 80) * 0.1 }));
    const results = classifier.classifyMany(points);
    assert.equal(results.length, points.length);
    assert.ok(results.every((item) => LandSeaClassifier.classifications.includes(item.classification)));
});
test('every planning workflow uses the local classifier and no runtime external lookup remains', () => {
    const files = [
        'js/pred/pred-new.js',
        'js/pred/auto-search.js',
        'js/pred/uncertainty-analysis.js',
        'js/pred/launch-window.js',
        'js/pred/ehime-enhancements.js'
    ];
    for (const file of files) {
        const source = fs.readFileSync(path.join(root, file), 'utf8');
        assert.match(source, /LandSea\.classify|classifyLandSeaAt/, file);
        assert.doesNotMatch(source, /bigdatacloud|overpass-api|monteCarloLandSea|queryInlandWaterAt/i, file);
    }
});
