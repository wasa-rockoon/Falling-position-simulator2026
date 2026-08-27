const test = require('node:test');
const assert = require('node:assert/strict');
const gas = require('../js/calc/balloon-gas.js');
function close(actual, expected, tolerance, label) { assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} != ${expected}`); }
test('2026 Python defaults reproduce lift and helium volume with density 1.1138', () => {
    const result = gas.calculate({});
    assert.equal(gas.DENSITY_DIFFERENCE_KG_M3, 1.1138);
    close(result.totalMassKg, 3.335, 1e-12, 'total mass');
    close(result.pureLiftKg, 2.321026744363245, 1e-12, 'pure lift');
    close(result.totalLiftKg, 5.6560267443632455, 1e-12, 'total lift');
    close(result.gasVolumeL, 5579.397220573637, 1e-9, 'gas volume');
});
test('2026 model returns three gas processes', () => {
    const result = gas.calculate({ polytropicN: 1.3 });
    close(result.gasModels.quasiStatic.workbookEquivalentCount, 0.8688238040054539, 1e-12, 'quasi-static');
    close(result.gasModels.polytropic.workbookEquivalentCount, 0.8903149861487479, 1e-12, 'polytropic');
    close(result.gasModels.adiabatic.workbookEquivalentCount, 0.9294186585460487, 1e-12, 'adiabatic');
    assert.equal(result.gasModels.quasiStatic.cylinders[0].residualPressureMpa, 2.01);
    assert.equal(result.gasModels.polytropic.cylinders[0].residualPressureMpa, 1.12);
    assert.equal(result.gasModels.adiabatic.cylinders[0].residualPressureMpa, 0.55);
});
test('polytropic endpoints equal quasi-static and adiabatic capacities', () => {
    const iso = gas.calculate({ polytropicN: 1 });
    close(iso.gasModels.polytropic.cylinders[0].capacityL, iso.gasModels.quasiStatic.cylinders[0].capacityL, 1e-9, 'n=1');
    const adi = gas.calculate({ polytropicN: gas.HELIUM_GAMMA });
    close(adi.gasModels.polytropic.cylinders[0].capacityL, adi.gasModels.adiabatic.cylinders[0].capacityL, 1e-9, 'n=gamma');
});
test('2026 model exposes only four retained burst criteria', () => {
    assert.deepEqual(gas.calculate({}).burst.methods, { ellipsoidThickness: 28.65, ellipsoidLength: 26.45, ellipsoidDiameter: 35.1, sphereDiameter: 32.25 });
});
test('1200 g remains unavailable until its ascent coefficient is known', () => { assert.throws(() => gas.calculate({ balloonMassG: 1200 }), /未確定/); });
test('four cylinders accept independent pressure and volume values', () => {
    const result = gas.calculate({ cylinders: [{id:'1',volumeL:47,pressureMpa:14},{id:'2',volumeL:47,pressureMpa:12},{id:'3',volumeL:40,pressureMpa:10},{id:'4',volumeL:47,pressureMpa:8}] });
    assert.notEqual(result.gasModels.polytropic.cylinders[0].capacityL, result.gasModels.polytropic.cylinders[1].capacityL);
    assert.equal(result.gasModels.polytropic.cylinders[2].volumeL, 40);
});
test('cylinder shortage is explicit', () => {
    const result = gas.calculateCylinderPlan(30000, { cylinderProcess:'polytropic', cylinders:[1,2,3,4].map(id => ({id:String(id),volumeL:47,pressureMpa:14})) });
    assert.equal(result.insufficient, true);
    assert.ok(result.remainingGasL > 0);
});
