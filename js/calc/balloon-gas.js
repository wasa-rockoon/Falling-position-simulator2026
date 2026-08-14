(function (root, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.BalloonGas = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    var BALLOON_MODELS = {
        1000: { massG: 1000, ascentCoefficient: 132 / 23.6, ellipsoidLengthM: 1.8, ellipsoidDiameterM: 1.15, sphereDiameterM: 1.8, burstDiameterM: 8.2 },
        1200: { massG: 1200, ascentCoefficient: null, ellipsoidLengthM: 2.0, ellipsoidDiameterM: 1.27, sphereDiameterM: 2.0, burstDiameterM: 8.9 },
        1500: { massG: 1500, ascentCoefficient: 138 / 23.6, ellipsoidLengthM: 2.2, ellipsoidDiameterM: 1.4, sphereDiameterM: 2.2, burstDiameterM: 10.0 },
        2000: { massG: 2000, ascentCoefficient: 148 / 23.6, ellipsoidLengthM: 2.5, ellipsoidDiameterM: 1.6, sphereDiameterM: 2.5, burstDiameterM: 11.3 },
        3000: { massG: 3000, ascentCoefficient: 158 / 23.6, ellipsoidLengthM: 2.95, ellipsoidDiameterM: 1.9, sphereDiameterM: 2.95, burstDiameterM: 13.5 }
    };

    var DEFAULTS = {
        balloonMassG: 2000,
        payloadMassG: 3571,
        recoveryMassG: 835,
        otherMassG: 320,
        targetAscentRate: 5,
        temperatureC: 26,
        cylinderTemperatureC: 25,
        pressureHpa: 1010,
        operationalLiftKgPerM3: 1.115,
        membraneBurstThicknessUm: 5,
        membraneBaseThicknessUm: 130,
        cylinderCount: 4,
        cylinderVolumeL: 47,
        cylinderPressureMpa: 14,
        targetCylinderPressureMpa: 0.2,
        firstCylinderOffsetMpa: 0,
        heliumGamma: 1.67,
        cylinderProcess: 'quasi-static'
    };

    function finite(value, label, minimum) {
        var number = Number(value);
        if (!Number.isFinite(number) || (minimum != null && number < minimum)) {
            throw new RangeError(label + 'が不正です');
        }
        return number;
    }

    function round(value, digits) {
        var scale = Math.pow(10, digits == null ? 2 : digits);
        return Math.round((value + Number.EPSILON) * scale) / scale;
    }

    function getBalloonModel(balloonMassG) {
        var key = String(Math.round(finite(balloonMassG, '気球質量', 1)));
        var model = BALLOON_MODELS[key];
        if (!model) throw new RangeError('対応していない気球質量です: ' + key + ' g');
        return model;
    }

    function solvePureLiftKg(totalMassKg, targetAscentRate, ascentCoefficient) {
        var weight = finite(totalMassKg, '全質量', 0.001);
        var rate = finite(targetAscentRate, '目標上昇速度', 0.01);
        var coefficient = finite(ascentCoefficient, '\u4e0a\u6607\u4fc2\u6570\uff08\u5143\u30b7\u30fc\u30c8\u30671200 g\u306f\u672a\u5b9a\u7fa9\uff09', 0.01);
        function f(lift) {
            return Math.pow(rate, 6) * Math.pow(weight + lift, 2) - Math.pow(coefficient, 6) * Math.pow(lift, 3);
        }
        var low = 0;
        var high = Math.max(1, weight);
        while (f(high) > 0 && high < 10000) high *= 2;
        if (high >= 10000 && f(high) > 0) throw new RangeError('必要浮力を収束できません');
        for (var i = 0; i < 100; i += 1) {
            var middle = (low + high) / 2;
            if (f(middle) > 0) low = middle;
            else high = middle;
        }
        return (low + high) / 2;
    }

    function calculateGasVolumeL(totalLiftKg, temperatureC, pressureHpa, liftKgPerM3) {
        var lift = finite(totalLiftKg, '総浮力', 0);
        var temperature = finite(temperatureC, '外気温') + 273.15;
        var pressure = finite(pressureHpa, '大気圧', 0.01);
        var densityDifference = finite(liftKgPerM3, '運用浮力密度差', 0.001);
        return ((lift / densityDifference) * temperature * 1013.25 / (273.15 * pressure)) * 1000;
    }

    function normalizeCylinders(options) {
        if (Array.isArray(options.cylinders) && options.cylinders.length) {
            return options.cylinders.map(function (cylinder, index) {
                return {
                    id: cylinder.id || String(index + 1),
                    pressureMpa: finite(cylinder.pressureMpa, (index + 1) + '本目の圧力', 0),
                    volumeL: finite(cylinder.volumeL, (index + 1) + '本目の容積', 0.001)
                };
            });
        }
        var count = Math.floor(finite(options.cylinderCount, 'ボンベ本数', 1));
        var pressure = finite(options.cylinderPressureMpa, 'ボンベ初期圧', 0);
        var volume = finite(options.cylinderVolumeL, 'ボンベ容積', 0.001);
        return Array.from({ length: count }, function (_, index) {
            return { id: String(index + 1), pressureMpa: pressure, volumeL: volume };
        });
    }

    function cylinderCapacityL(cylinder, options, index) {
        var ambientMpa = finite(options.pressureHpa, '大気圧', 0.01) * 0.0001;
        var targetMpa = finite(options.targetCylinderPressureMpa, '注入終了圧力', 0);
        var offset = index === 0 ? finite(options.firstCylinderOffsetMpa || 0, '1本目オフセット', 0) : 0;
        var initialMpa = Math.max(0, cylinder.pressureMpa - offset);
        if (initialMpa <= targetMpa) return { capacityL: 0, effectiveInitialMpa: initialMpa };
        var beforeL = cylinder.volumeL * initialMpa / ambientMpa;
        var capacityL;
        if (options.cylinderProcess === 'adiabatic') {
            var gamma = finite(options.heliumGamma, 'ヘリウム比熱比', 1.001);
            var exponent = (gamma - 1) / gamma;
            var temperatureRatio = Math.pow(targetMpa / initialMpa, exponent);
            var afterL = cylinder.volumeL * targetMpa / ambientMpa / temperatureRatio;
            capacityL = beforeL - afterL;
        } else {
            capacityL = cylinder.volumeL * (initialMpa - targetMpa) / ambientMpa;
        }
        return { capacityL: Math.max(0, capacityL), effectiveInitialMpa: initialMpa, beforeL: beforeL };
    }

    function partialResidualPressureMpa(remainingEquivalentL, cylinder, capacityInfo, options) {
        var ambientMpa = finite(options.pressureHpa, '大気圧', 0.01) * 0.0001;
        if (options.cylinderProcess !== 'adiabatic') {
            return ambientMpa * remainingEquivalentL / cylinder.volumeL;
        }
        var gamma = finite(options.heliumGamma, 'ヘリウム比熱比', 1.001);
        var initialMpa = capacityInfo.effectiveInitialMpa;
        var constant = (remainingEquivalentL / cylinder.volumeL) * ambientMpa * Math.pow(initialMpa, (1 - gamma) / gamma);
        return Math.pow(Math.max(0, constant), gamma);
    }

    function calculateCylinderPlan(requiredGasL, rawOptions) {
        var options = Object.assign({}, DEFAULTS, rawOptions || {});
        var required = finite(requiredGasL, '必要ガス量', 0);
        var cylinders = normalizeCylinders(options);
        var remaining = required;
        var fullCount = 0;
        var fractionalCount = 0;
        var rows = [];
        cylinders.forEach(function (cylinder, index) {
            var info = cylinderCapacityL(cylinder, options, index);
            var usedL = Math.min(remaining, info.capacityL);
            var status = usedL <= 1e-9 ? 'unused' : (remaining > info.capacityL + 1e-9 ? 'full' : 'partial');
            var residualMpa = info.effectiveInitialMpa;
            if (status === 'full') {
                fullCount += 1;
                residualMpa = options.targetCylinderPressureMpa;
            } else if (status === 'partial') {
                fractionalCount = info.capacityL > 0 ? usedL / info.capacityL : 0;
                residualMpa = partialResidualPressureMpa(info.beforeL - usedL, cylinder, info, options);
            }
            remaining = Math.max(0, remaining - usedL);
            rows.push({
                id: cylinder.id,
                status: status,
                initialPressureMpa: info.effectiveInitialMpa,
                capacityL: info.capacityL,
                usedL: usedL,
                residualPressureMpa: residualMpa
            });
        });
        return {
            process: options.cylinderProcess,
            requiredGasL: required,
            availableGasL: rows.reduce(function (sum, row) { return sum + row.capacityL; }, 0),
            remainingGasL: remaining,
            insufficient: remaining > 1e-6,
            physicalCylindersUsed: rows.filter(function (row) { return row.status !== 'unused'; }).length,
            workbookEquivalentCount: fullCount + fractionalCount,
            cylinders: rows
        };
    }

    function ellipsoidVolumeL(lengthM, diameterM) {
        return Math.PI * lengthM * diameterM * diameterM / 6 * 1000;
    }

    function sphereVolumeL(diameterM) {
        return Math.PI * Math.pow(diameterM, 3) / 6 * 1000;
    }

    function atmosphereAtKm(altitudeKm) {
        var altitude = finite(altitudeKm, '高度', 0);
        var h = altitude * 1000;
        if (altitude >= 32) {
            var pressure20 = 226.321 * Math.exp((-9.80665 * 0.0289644 * (20000 - 11000)) / (8.31432 * 216.65));
            var pressure32 = pressure20 * Math.pow((216.65 + 0.001 * (32000 - 20000)) / 216.65, -34.1632);
            return {
                pressureHpa: pressure32 * Math.pow((227.65 + 0.0028 * (h - 32000)) / 227.65, -12.23),
                temperatureK: 228.66 + 0.0028 * (h - 32000)
            };
        }
        if (altitude >= 20) {
            var pressureAt20 = 226.321 * Math.exp((-9.80665 * 0.0289644 * (20000 - 11000)) / (8.31432 * 216.65));
            return {
                pressureHpa: pressureAt20 * Math.pow((216.65 + 0.001 * (h - 20000)) / 216.65, -34.1632),
                temperatureK: 216.66 + 0.001 * (h - 20000)
            };
        }
        if (altitude >= 11) {
            return {
                pressureHpa: 226.321 * Math.exp((-9.80665 * 0.0289644 * (h - 11000)) / (8.31432 * 216.65)),
                temperatureK: 216.66
            };
        }
        var temperatureK = 288.16 - 0.0065 * h;
        return {
            pressureHpa: 1013.249825 * Math.pow(temperatureK / 288.16, 5.255877),
            temperatureK: temperatureK
        };
    }

    function previousSafeAltitude(predicate, stepKm) {
        var step = stepKm || 0.05;
        var previous = 0;
        for (var i = 0; i <= Math.round(40 / step); i += 1) {
            var altitude = round(i * step, 8);
            if (predicate(altitude)) return previous;
            previous = altitude;
        }
        return null;
    }

    function calculateBurstAltitudes(gasVolumeL, model, rawOptions) {
        var options = Object.assign({}, DEFAULTS, rawOptions || {});
        var gasL = finite(gasVolumeL, '充填体積', 0.001);
        var surfaceTemperatureK = finite(options.cylinderTemperatureC, '\u6b8b\u5727\u6e2c\u5b9a\u6642\u6e29\u5ea6') + 273.16;
        var surfacePressureHpa = 1013.249825;
        var ellipsoidStandardL = ellipsoidVolumeL(model.ellipsoidLengthM, model.ellipsoidDiameterM);
        var sphereStandardL = sphereVolumeL(model.sphereDiameterM);
        var ellipsoidFillExpansion = gasL / ellipsoidStandardL;
        var sphereFillExpansion = gasL / sphereStandardL;
        var ellipsoidFillSurfaceExpansion = Math.pow(ellipsoidFillExpansion, 2 / 3);
        var sphereFillSurfaceExpansion = Math.pow(sphereFillExpansion, 2 / 3);
        var ellipsoidFillLengthM = model.ellipsoidLengthM * Math.pow(ellipsoidFillExpansion, 1 / 3);
        var ellipsoidFillDiameterM = model.ellipsoidDiameterM * Math.pow(ellipsoidFillExpansion, 1 / 3);
        var filledEquivalentDiameterM = 2 * Math.pow((3 * gasL) / (4 * Math.PI), 1 / 3) / 10;
        var membraneLimit = finite(options.membraneBurstThicknessUm, '破裂膜厚', 0.001);
        var baseThickness = finite(options.membraneBaseThicknessUm, '標準膜厚', 0.001);
        var burstDiameter = model.burstDiameterM;

        function geometry(altitudeKm) {
            var atmosphere = atmosphereAtKm(altitudeKm);
            var expansion = atmosphere.temperatureK / surfaceTemperatureK * surfacePressureHpa / atmosphere.pressureHpa;
            var surfaceExpansion = Math.pow(expansion, 2 / 3);
            var dimensionExpansion = Math.pow(expansion, 1 / 3);
            var standardThickness = baseThickness / surfaceExpansion;
            return {
                ellipsoidThicknessUm: standardThickness / ellipsoidFillSurfaceExpansion,
                sphereThicknessUm: standardThickness / sphereFillSurfaceExpansion,
                equivalentDiameterM: filledEquivalentDiameterM * dimensionExpansion,
                ellipsoidLengthM: ellipsoidFillLengthM * dimensionExpansion,
                ellipsoidDiameterM: ellipsoidFillDiameterM * dimensionExpansion
            };
        }

        var methods = {
            ellipsoidMembrane: previousSafeAltitude(function (h) { return geometry(h).ellipsoidThicknessUm < membraneLimit; }),
            ellipsoidEquivalentDiameter: previousSafeAltitude(function (h) { return geometry(h).equivalentDiameterM >= burstDiameter; }),
            ellipsoidLength: previousSafeAltitude(function (h) { return geometry(h).ellipsoidLengthM >= burstDiameter; }),
            ellipsoidDiameter: previousSafeAltitude(function (h) { return geometry(h).ellipsoidDiameterM >= burstDiameter; }),
            sphereMembrane: previousSafeAltitude(function (h) { return geometry(h).sphereThicknessUm < membraneLimit; }),
            sphereDiameter: previousSafeAltitude(function (h) { return geometry(h).equivalentDiameterM >= burstDiameter; })
        };
        return {
            recommendedKm: methods.sphereDiameter,
            recommendedMethod: 'sphereDiameter',
            methods: methods,
            fillGeometry: {
                ellipsoidLengthM: ellipsoidFillLengthM,
                ellipsoidDiameterM: ellipsoidFillDiameterM,
                equivalentDiameterM: filledEquivalentDiameterM
            }
        };
    }

    function calculate(rawOptions) {
        var options = Object.assign({}, DEFAULTS, rawOptions || {});
        var model = getBalloonModel(options.balloonMassG);
        var totalMassKg = (
            finite(options.balloonMassG, '気球質量', 0) +
            finite(options.payloadMassG, '搭載物質量', 0) +
            finite(options.recoveryMassG, '回収系質量', 0) +
            finite(options.otherMassG, 'その他質量', 0)
        ) / 1000;
        var pureLiftKg = solvePureLiftKg(totalMassKg, options.targetAscentRate, model.ascentCoefficient);
        var totalLiftKg = totalMassKg + pureLiftKg;
        var gasVolumeL = calculateGasVolumeL(totalLiftKg, options.temperatureC, options.pressureHpa, options.operationalLiftKgPerM3);
        return {
            inputs: options,
            model: model,
            totalMassKg: totalMassKg,
            pureLiftKg: pureLiftKg,
            totalLiftKg: totalLiftKg,
            gasVolumeL: gasVolumeL,
            gasVolumeM3: gasVolumeL / 1000,
            cylinders: calculateCylinderPlan(gasVolumeL, options),
            burst: calculateBurstAltitudes(gasVolumeL, model, options)
        };
    }

    return {
        BALLOON_MODELS: BALLOON_MODELS,
        DEFAULTS: DEFAULTS,
        solvePureLiftKg: solvePureLiftKg,
        calculateGasVolumeL: calculateGasVolumeL,
        calculateCylinderPlan: calculateCylinderPlan,
        calculateBurstAltitudes: calculateBurstAltitudes,
        atmosphereAtKm: atmosphereAtKm,
        calculate: calculate,
        round: round
    };
}));
