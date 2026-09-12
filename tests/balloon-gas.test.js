const test = require('node:test');
const assert = require('node:assert/strict');
const gas = require('../js/calc/balloon-gas.js');
function close(actual, expected, tolerance, label) { assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} != ${expected}`); }
test('2026 Python defaults reproduce lift and helium volume with density 1.1138', () => {
    const result = gas.calculate({});
    assert.equal(gas.DENSITY_DIFFERENCE_KG_M3, 1.1138);
    assert.equal(result.inputs.cylinderProcess, 'adiabatic');
    assert.equal(result.cylinders.key, 'adiabatic');
    close(result.totalMassKg, 3.734, 1e-12, 'total mass');
    close(result.pureLiftKg, 2.4681175279058074, 1e-12, 'pure lift');
    close(result.totalLiftKg, 6.202117527905807, 1e-12, 'total lift');
    close(result.gasVolumeL, 6118.089404608079, 1e-9, 'gas volume');
});
test('2026 model returns three gas processes', () => {
    const result = gas.calculate({ polytropicN: 1.3 });
    close(result.gasModels.quasiStatic.workbookEquivalentCount, 0.9527089575476658, 1e-12, 'quasi-static');
    close(result.gasModels.polytropic.workbookEquivalentCount, 0.9762751186516911, 1e-12, 'polytropic');
    close(result.gasModels.adiabatic.workbookEquivalentCount, 1.0191542603075336, 1e-12, 'adiabatic');
    assert.equal(result.gasModels.quasiStatic.cylinders[0].residualPressureMpa, 0.85);
    assert.equal(result.gasModels.polytropic.cylinders[0].residualPressureMpa, 0.37);
    assert.equal(result.gasModels.adiabatic.cylinders[0].residualPressureMpa, 0.2);
});
test('polytropic endpoints equal quasi-static and adiabatic capacities', () => {
    const iso = gas.calculate({ polytropicN: 1 });
    close(iso.gasModels.polytropic.cylinders[0].capacityL, iso.gasModels.quasiStatic.cylinders[0].capacityL, 1e-9, 'n=1');
    const adi = gas.calculate({ polytropicN: gas.HELIUM_GAMMA });
    close(adi.gasModels.polytropic.cylinders[0].capacityL, adi.gasModels.adiabatic.cylinders[0].capacityL, 1e-9, 'n=gamma');
});
test('2026 model exposes only four retained burst criteria', () => {
    assert.deepEqual(gas.calculate({}).burst.methods, { ellipsoidThickness: 28.1, ellipsoidLength: 25.9, ellipsoidDiameter: 34.5, sphereDiameter: 31.7 });
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
test('other organizations can enter independent parachute and recovery equipment masses', () => {
    const result = gas.calculate({ parachuteMassG: 500, recoveryEquipmentMassG: 100, terminalVelocityMps: 6.5 });
    assert.equal(result.recoveryMassG, 600);
    close(result.totalMassKg, 3.1, 1e-12, 'custom recovery total mass');
});
test('WASA parachute presets include the latest parachute and recovery masses', () => {
    assert.equal(gas.calculate({ terminalVelocityMps: 4.38 }).recoveryMassG, 1234);
    assert.equal(gas.calculate({ terminalVelocityMps: 7 }).recoveryMassG, 696);
    assert.equal(gas.calculate({ terminalVelocityMps: 9.89 }).recoveryMassG, 630);
});
