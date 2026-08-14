const test = require('node:test');
const assert = require('node:assert/strict');
const gas = require('../js/calc/balloon-gas.js');

function close(actual, expected, tolerance, label) {
    assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} != ${expected}`);
}

test('2025 workbook defaults reproduce lift and gas volume', () => {
    const result = gas.calculate({});
    close(result.totalMassKg, 6.726, 1e-12, 'total mass');
    close(result.pureLiftKg, 2.870705947, 1e-9, 'pure lift');
    close(result.totalLiftKg, 9.596705947, 1e-9, 'total lift');
    close(result.gasVolumeL, 9456.498573, 1e-6, 'gas volume');
});

test('2025 workbook defaults reproduce quasi-static cylinder plan', () => {
    const result = gas.calculate({ cylinderProcess: 'quasi-static' });
    close(result.cylinders.workbookEquivalentCount, 1.472566074, 1e-9, 'cylinder count');
    assert.equal(result.cylinders.cylinders[0].status, 'full');
    assert.equal(result.cylinders.cylinders[1].status, 'partial');
    close(result.cylinders.cylinders[1].residualPressureMpa, 7.478588173, 1e-9, 'residual pressure');
});

test('2025 workbook defaults reproduce adiabatic cylinder plan', () => {
    const result = gas.calculate({ cylinderProcess: 'adiabatic' });
    close(result.cylinders.workbookEquivalentCount, 1.575268057, 1e-9, 'cylinder count');
    close(result.cylinders.cylinders[0].capacityL, 6003.104381, 1e-6, 'first capacity');
    close(result.cylinders.cylinders[1].residualPressureMpa, 3.966501206, 1e-9, 'residual pressure');
});

test('2025 workbook defaults reproduce all six burst estimates', () => {
    const result = gas.calculate({});
    assert.deepEqual(result.burst.methods, {
        ellipsoidMembrane: 27.8,
        ellipsoidEquivalentDiameter: 31.25,
        ellipsoidLength: 25.5,
        ellipsoidDiameter: 34.05,
        sphereMembrane: 33.5,
        sphereDiameter: 31.25
    });
    assert.equal(result.burst.recommendedMethod, 'sphereDiameter');
    assert.equal(result.burst.recommendedKm, 31.25);
});

test('unsupported 1200 g lift coefficient is reported instead of invented', () => {
    assert.throws(() => gas.calculate({ balloonMassG: 1200 }), /1200 g/);
});

test('cylinder shortage is explicit', () => {
    const result = gas.calculateCylinderPlan(10000, {
        cylinderCount: 1,
        cylinderVolumeL: 47,
        cylinderPressureMpa: 14,
        targetCylinderPressureMpa: 0.2,
        pressureHpa: 1010,
        cylinderProcess: 'quasi-static'
    });
    assert.equal(result.insufficient, true);
    assert.ok(result.remainingGasL > 0);
});
