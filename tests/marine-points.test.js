const test = require('node:test');
const assert = require('node:assert/strict');
const marinePoints = require('../ports.json');

test('KML-derived marine points keep support and recovery records separate', () => {
    assert.equal(marinePoints.schemaVersion, 1);
    assert.equal(marinePoints.supportPoints.length, 22);
    assert.equal(marinePoints.recoveryPoints.length, 8);
    assert.ok(marinePoints.supportPoints.every((point) => point.category === 'marine_support'));
    assert.ok(marinePoints.recoveryPoints.every((point) => point.category === 'recovery_record'));
    assert.ok(!marinePoints.supportPoints.some((point) => /\d{4}\//.test(point.name)));
});
