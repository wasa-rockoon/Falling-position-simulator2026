(function (root, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.UncertaintyCore = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    var UINT32_SCALE = 4294967296;

    function clamp(value, minimum, maximum) {
        return Math.max(minimum, Math.min(maximum, value));
    }

    function pad2(value) {
        return String(value).padStart(2, '0');
    }

    function jstDateTimeToUtcIso(dateText, timeText) {
        var dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateText || ''));
        var timeMatch = /^(\d{2}):(\d{2})$/.exec(String(timeText || ''));
        if (!dateMatch || !timeMatch) throw new RangeError('解析日時をJSTで入力してください');
        var year = Number(dateMatch[1]);
        var month = Number(dateMatch[2]);
        var day = Number(dateMatch[3]);
        var hour = Number(timeMatch[1]);
        var minute = Number(timeMatch[2]);
        if (month < 1 || month > 12 || hour > 23 || minute > 59) throw new RangeError('解析日時が不正です');
        var utc = new Date(Date.UTC(year, month - 1, day, hour - 9, minute, 0));
        var normalizedJst = new Date(utc.getTime() + 9 * 60 * 60 * 1000);
        if (normalizedJst.getUTCFullYear() !== year || normalizedJst.getUTCMonth() !== month - 1 ||
            normalizedJst.getUTCDate() !== day || normalizedJst.getUTCHours() !== hour || normalizedJst.getUTCMinutes() !== minute) {
            throw new RangeError('解析日時が不正です');
        }
        return utc.toISOString();
    }

    function utcIsoToJstParts(value) {
        var utc = new Date(value);
        if (!Number.isFinite(utc.getTime())) throw new RangeError('保存された解析日時が不正です');
        var jst = new Date(utc.getTime() + 9 * 60 * 60 * 1000);
        return {
            date: jst.getUTCFullYear() + '-' + pad2(jst.getUTCMonth() + 1) + '-' + pad2(jst.getUTCDate()),
            time: pad2(jst.getUTCHours()) + ':' + pad2(jst.getUTCMinutes())
        };
    }
    function hashSeed(seed) {
        var text = String(seed == null ? 'wasa-2026' : seed);
        var hash = 2166136261;
        for (var i = 0; i < text.length; i += 1) {
            hash ^= text.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
        }
        return hash >>> 0;
    }

    function createRng(seed) {
        var state = hashSeed(seed);
        return function () {
            state = (state + 0x6D2B79F5) >>> 0;
            var value = state;
            value = Math.imul(value ^ (value >>> 15), value | 1);
            value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
            return ((value ^ (value >>> 14)) >>> 0) / UINT32_SCALE;
        };
    }

    function shuffle(values, rng) {
        for (var i = values.length - 1; i > 0; i -= 1) {
            var j = Math.floor(rng() * (i + 1));
            var temp = values[i];
            values[i] = values[j];
            values[j] = temp;
        }
        return values;
    }

    function monteCarloPoints(count, dimensions, seed) {
        var rng = createRng(seed);
        return Array.from({ length: count }, function () {
            return Array.from({ length: dimensions }, function () { return rng(); });
        });
    }

    function latinHypercubePoints(count, dimensions, seed) {
        var rng = createRng(seed);
        var columns = Array.from({ length: dimensions }, function () {
            return shuffle(Array.from({ length: count }, function (_, index) {
                return (index + rng()) / count;
            }), rng);
        });
        return Array.from({ length: count }, function (_, row) {
            return columns.map(function (column) { return column[row]; });
        });
    }

    function sobolDirections(dimensions) {
        if (dimensions > 3) throw new RangeError('Sobol sampling supports up to 3 dimensions');
        var directions = Array.from({ length: dimensions }, function () { return new Uint32Array(33); });
        for (var bit = 1; bit <= 32; bit += 1) directions[0][bit] = Math.pow(2, 32 - bit) >>> 0;
        var parameters = [
            null,
            { s: 1, a: 0, m: [1] },
            { s: 2, a: 1, m: [1, 3] }
        ];
        for (var dimension = 1; dimension < dimensions; dimension += 1) {
            var parameter = parameters[dimension];
            for (var initial = 1; initial <= parameter.s; initial += 1) {
                directions[dimension][initial] = (parameter.m[initial - 1] * Math.pow(2, 32 - initial)) >>> 0;
            }
            for (var i = parameter.s + 1; i <= 32; i += 1) {
                var value = (directions[dimension][i - parameter.s] ^ (directions[dimension][i - parameter.s] >>> parameter.s)) >>> 0;
                for (var k = 1; k < parameter.s; k += 1) {
                    if ((parameter.a >>> (parameter.s - 1 - k)) & 1) value = (value ^ directions[dimension][i - k]) >>> 0;
                }
                directions[dimension][i] = value;
            }
        }
        return directions;
    }

    function sobolPoints(count, dimensions, seed) {
        var directions = sobolDirections(dimensions);
        var state = new Uint32Array(dimensions);
        var rng = createRng(seed);
        var digitalShift = new Uint32Array(dimensions);
        for (var d = 0; d < dimensions; d += 1) digitalShift[d] = Math.floor(rng() * UINT32_SCALE) >>> 0;
        var points = [];
        for (var index = 1; index <= count; index += 1) {
            var value = index - 1;
            var bit = 1;
            while (value & 1) {
                value >>>= 1;
                bit += 1;
            }
            var point = [];
            for (var dimension = 0; dimension < dimensions; dimension += 1) {
                state[dimension] = (state[dimension] ^ directions[dimension][bit]) >>> 0;
                point.push(((state[dimension] ^ digitalShift[dimension]) >>> 0) / UINT32_SCALE);
            }
            points.push(point);
        }
        return points;
    }

    function unitPoints(method, count, dimensions, seed) {
        var n = Math.max(1, Math.floor(Number(count)));
        var d = Math.max(1, Math.floor(Number(dimensions)));
        if (method === 'lhs') return latinHypercubePoints(n, d, seed);
        if (method === 'sobol') return sobolPoints(n, d, seed);
        return monteCarloPoints(n, d, seed);
    }

    function inverseNormal(probability) {
        var p = clamp(Number(probability), 1e-12, 1 - 1e-12);
        var a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
        var b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
        var c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
        var d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
        var low = 0.02425;
        var high = 1 - low;
        var q;
        var r;
        if (p < low) {
            q = Math.sqrt(-2 * Math.log(p));
            return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
                ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
        }
        if (p > high) {
            q = Math.sqrt(-2 * Math.log(1 - p));
            return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
                ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
        }
        q = p - 0.5;
        r = q * q;
        return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
            (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
    }

    function logGamma(value) {
        var coefficients = [
            676.5203681218851, -1259.1392167224028, 771.3234287776531,
            -176.6150291621406, 12.5073432786869, -0.1385710952657201,
            9.984369578019572e-6, 1.505632735149312e-7
        ];
        if (value < 0.5) return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * value)) - logGamma(1 - value);
        var z = value - 1;
        var x = 0.9999999999998099;
        for (var i = 0; i < coefficients.length; i += 1) x += coefficients[i] / (z + i + 1);
        var t = z + coefficients.length - 0.5;
        return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
    }

    function gamma(value) {
        return Math.exp(logGamma(value));
    }

    function weibullCv(shape) {
        var first = gamma(1 + 1 / shape);
        var second = gamma(1 + 2 / shape);
        return Math.sqrt(Math.max(0, second / (first * first) - 1));
    }

    function weibullShapeForCv(cv) {
        var target = Math.max(0.001, Number(cv));
        var low = 0.15;
        var high = 1000;
        for (var i = 0; i < 80; i += 1) {
            var middle = (low + high) / 2;
            if (weibullCv(middle) > target) low = middle;
            else high = middle;
        }
        return (low + high) / 2;
    }

    function transformUnit(unit, mean, cv, distribution, minimum) {
        var center = Number(mean);
        var coefficient = Math.max(0, Number(cv));
        var floor = minimum == null ? -Infinity : Number(minimum);
        var result;
        if (coefficient === 0) result = center;
        else if (distribution === 'weibull') {
            var shape = weibullShapeForCv(coefficient);
            var scale = center / gamma(1 + 1 / shape);
            result = scale * Math.pow(-Math.log(1 - clamp(unit, 1e-12, 1 - 1e-12)), 1 / shape);
        } else {
            result = center + center * coefficient * inverseNormal(unit);
        }
        return Math.max(floor, result);
    }

    function createParameterSamples(base, options) {
        options = options || {};
        var count = Math.max(1, Math.floor(Number(options.count || 1)));
        var method = options.method || 'sobol';
        var distribution = options.distribution || 'normal';
        var points = unitPoints(method, count, 3, options.seed);
        var launchAltitude = Number(base.launch_altitude || 0);
        return points.map(function (point, index) {
            return {
                index: index,
                ascent_rate: transformUnit(point[0], base.ascent_rate, Number(options.ascentCvPct || 0) / 100, distribution, 0.1),
                descent_rate: transformUnit(point[1], base.descent_rate, Number(options.descentCvPct || 0) / 100, distribution, 0.1),
                burst_altitude: transformUnit(point[2], base.burst_altitude, Number(options.burstCvPct || 0) / 100, distribution, launchAltitude + 100),
                unit: point
            };
        });
    }

    function wilsonInterval(successes, trials, z) {
        var n = Math.max(0, Number(trials));
        if (!n) return { center: 0.5, low: 0, high: 1, halfWidth: 0.5 };
        var score = Number(z || 1.959963984540054);
        var p = clamp(Number(successes) / n, 0, 1);
        var denominator = 1 + score * score / n;
        var center = (p + score * score / (2 * n)) / denominator;
        var half = score * Math.sqrt((p * (1 - p) + score * score / (4 * n)) / n) / denominator;
        return { center: center, low: Math.max(0, center - half), high: Math.min(1, center + half), halfWidth: half };
    }

    function haversineKm(a, b) {
        if (!a || !b) return Infinity;
        var toRad = Math.PI / 180;
        var dLat = (b.lat - a.lat) * toRad;
        var dLon = (b.lng - a.lng) * toRad;
        var lat1 = a.lat * toRad;
        var lat2 = b.lat * toRad;
        var value = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
        return 6371 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
    }

    function projectToLocalKm(observations, mean) {
        var longitudeScale = 111.320 * Math.cos(mean.lat * Math.PI / 180);
        var latitudeScale = 110.574;
        return observations.map(function (item) {
            return {
                x: (item.lng - mean.lng) * longitudeScale,
                y: (item.lat - mean.lat) * latitudeScale
            };
        });
    }

    function localKmToLatLng(point, mean) {
        var longitudeScale = 111.320 * Math.cos(mean.lat * Math.PI / 180);
        return {
            lat: mean.lat + point.y / 110.574,
            lng: mean.lng + point.x / longitudeScale
        };
    }

    function covariance2d(points) {
        if (!points || points.length < 2) return null;
        var meanX = points.reduce(function (sum, point) { return sum + point.x; }, 0) / points.length;
        var meanY = points.reduce(function (sum, point) { return sum + point.y; }, 0) / points.length;
        var denominator = points.length - 1;
        var xx = 0;
        var xy = 0;
        var yy = 0;
        points.forEach(function (point) {
            var dx = point.x - meanX;
            var dy = point.y - meanY;
            xx += dx * dx;
            xy += dx * dy;
            yy += dy * dy;
        });
        return { xx: xx / denominator, xy: xy / denominator, yy: yy / denominator };
    }

    function confidenceEllipse95(observations, mean) {
        if (!mean || !observations || observations.length < 3) return null;
        var points = projectToLocalKm(observations, mean);
        var covariance = covariance2d(points);
        if (!covariance) return null;
        var trace = covariance.xx + covariance.yy;
        var difference = covariance.xx - covariance.yy;
        var discriminant = Math.sqrt(Math.max(0, difference * difference + 4 * covariance.xy * covariance.xy));
        var minimumVariance = 0.01 * 0.01;
        var majorVariance = Math.max(minimumVariance, (trace + discriminant) / 2);
        var minorVariance = Math.max(minimumVariance, (trace - discriminant) / 2);
        var chiSquare95 = 5.991464547107979;
        var semiMajorKm = Math.sqrt(chiSquare95 * majorVariance);
        var semiMinorKm = Math.sqrt(chiSquare95 * minorVariance);
        var angleRadians = 0.5 * Math.atan2(2 * covariance.xy, difference);
        var coordinates = [];
        for (var index = 0; index <= 72; index += 1) {
            var theta = index / 72 * 2 * Math.PI;
            var alongMajor = semiMajorKm * Math.cos(theta);
            var alongMinor = semiMinorKm * Math.sin(theta);
            var point = {
                x: alongMajor * Math.cos(angleRadians) - alongMinor * Math.sin(angleRadians),
                y: alongMajor * Math.sin(angleRadians) + alongMinor * Math.cos(angleRadians)
            };
            coordinates.push(localKmToLatLng(point, mean));
        }
        return {
            confidence: 0.95,
            semiMajorKm: semiMajorKm,
            semiMinorKm: semiMinorKm,
            majorKm: semiMajorKm * 2,
            minorKm: semiMinorKm * 2,
            bearingDeg: (90 - angleRadians * 180 / Math.PI + 360) % 360,
            coordinates: coordinates
        };
    }

    function interpolateContourPoint(first, second, firstValue, secondValue, threshold) {
        var denominator = secondValue - firstValue;
        var ratio = Math.abs(denominator) < 1e-15 ? 0.5 : (threshold - firstValue) / denominator;
        return {
            x: first.x + (second.x - first.x) * ratio,
            y: first.y + (second.y - first.y) * ratio
        };
    }

    function marchingSquareSegments(values, xValues, yValues, threshold) {
        var segments = [];
        for (var row = 0; row < values.length - 1; row += 1) {
            for (var column = 0; column < values[row].length - 1; column += 1) {
                var bottomLeft = { x: xValues[column], y: yValues[row] };
                var bottomRight = { x: xValues[column + 1], y: yValues[row] };
                var topRight = { x: xValues[column + 1], y: yValues[row + 1] };
                var topLeft = { x: xValues[column], y: yValues[row + 1] };
                var bottomLeftValue = values[row][column];
                var bottomRightValue = values[row][column + 1];
                var topRightValue = values[row + 1][column + 1];
                var topLeftValue = values[row + 1][column];
                var crossings = [];
                if ((bottomLeftValue >= threshold) !== (bottomRightValue >= threshold)) crossings.push(interpolateContourPoint(bottomLeft, bottomRight, bottomLeftValue, bottomRightValue, threshold));
                if ((bottomRightValue >= threshold) !== (topRightValue >= threshold)) crossings.push(interpolateContourPoint(bottomRight, topRight, bottomRightValue, topRightValue, threshold));
                if ((topRightValue >= threshold) !== (topLeftValue >= threshold)) crossings.push(interpolateContourPoint(topRight, topLeft, topRightValue, topLeftValue, threshold));
                if ((topLeftValue >= threshold) !== (bottomLeftValue >= threshold)) crossings.push(interpolateContourPoint(topLeft, bottomLeft, topLeftValue, bottomLeftValue, threshold));
                if (crossings.length === 2) {
                    segments.push([crossings[0], crossings[1]]);
                } else if (crossings.length === 4) {
                    var centerValue = (bottomLeftValue + bottomRightValue + topRightValue + topLeftValue) / 4;
                    if (centerValue >= threshold) {
                        segments.push([crossings[0], crossings[3]], [crossings[1], crossings[2]]);
                    } else {
                        segments.push([crossings[0], crossings[1]], [crossings[2], crossings[3]]);
                    }
                }
            }
        }
        return segments;
    }

    function kdeDensityContours(observations, mean, requestedMasses) {
        if (!mean || !observations || observations.length < 8) return null;
        var points = projectToLocalKm(observations, mean);
        var covariance = covariance2d(points);
        if (!covariance) return null;
        var factor = Math.pow(points.length, -1 / 6);
        var spread = Math.sqrt(Math.max(covariance.xx, covariance.yy, 0.01));
        var minimumBandwidth = Math.max(0.08, spread * 0.06);
        var regularization = minimumBandwidth * minimumBandwidth;
        var bandwidthXX = covariance.xx * factor * factor + regularization;
        var bandwidthXY = covariance.xy * factor * factor;
        var bandwidthYY = covariance.yy * factor * factor + regularization;
        var determinant = bandwidthXX * bandwidthYY - bandwidthXY * bandwidthXY;
        if (!(determinant > 0)) return null;
        var inverseXX = bandwidthYY / determinant;
        var inverseXY = -bandwidthXY / determinant;
        var inverseYY = bandwidthXX / determinant;
        var minX = Math.min.apply(null, points.map(function (point) { return point.x; }));
        var maxX = Math.max.apply(null, points.map(function (point) { return point.x; }));
        var minY = Math.min.apply(null, points.map(function (point) { return point.y; }));
        var maxY = Math.max.apply(null, points.map(function (point) { return point.y; }));
        var paddingX = Math.max(0.5, 3 * Math.sqrt(bandwidthXX));
        var paddingY = Math.max(0.5, 3 * Math.sqrt(bandwidthYY));
        minX -= paddingX;
        maxX += paddingX;
        minY -= paddingY;
        maxY += paddingY;
        if (maxX - minX < 1) { minX -= 0.5; maxX += 0.5; }
        if (maxY - minY < 1) { minY -= 0.5; maxY += 0.5; }
        var gridSize = 45;
        var xStep = (maxX - minX) / (gridSize - 1);
        var yStep = (maxY - minY) / (gridSize - 1);
        var xValues = Array.from({ length: gridSize }, function (_, index) { return minX + index * xStep; });
        var yValues = Array.from({ length: gridSize }, function (_, index) { return minY + index * yStep; });
        var normalizer = 1 / (2 * Math.PI * Math.sqrt(determinant) * points.length);
        var values = yValues.map(function (y) {
            return xValues.map(function (x) {
                var sum = 0;
                points.forEach(function (point) {
                    var dx = x - point.x;
                    var dy = y - point.y;
                    var quadratic = inverseXX * dx * dx + 2 * inverseXY * dx * dy + inverseYY * dy * dy;
                    sum += Math.exp(-0.5 * quadratic);
                });
                return sum * normalizer;
            });
        });
        var sortedDensities = values.flat().slice().sort(function (a, b) { return b - a; });
        var totalDensity = sortedDensities.reduce(function (sum, value) { return sum + value; }, 0);
        if (!(totalDensity > 0)) return null;
        var masses = requestedMasses || [0.5, 0.8, 0.95];
        var levels = masses.map(function (mass) {
            var target = clamp(Number(mass), 0.01, 0.999) * totalDensity;
            var cumulative = 0;
            var threshold = sortedDensities[sortedDensities.length - 1];
            for (var densityIndex = 0; densityIndex < sortedDensities.length; densityIndex += 1) {
                cumulative += sortedDensities[densityIndex];
                threshold = sortedDensities[densityIndex];
                if (cumulative >= target) break;
            }
            var localSegments = marchingSquareSegments(values, xValues, yValues, threshold);
            return {
                mass: Number(mass),
                threshold: threshold,
                segments: localSegments.map(function (segment) {
                    return segment.map(function (point) { return localKmToLatLng(point, mean); });
                })
            };
        });
        return {
            bandwidthKm: Math.sqrt(Math.max(bandwidthXX, bandwidthYY)),
            gridSize: gridSize,
            levels: levels
        };
    }
    function summarizeObservations(observations) {
        var valid = observations.filter(function (item) { return Number.isFinite(item.lat) && Number.isFinite(item.lng); });
        var classified = valid.filter(function (item) { return item.isWater === true || item.isWater === false; });
        var sea = classified.filter(function (item) { return item.isWater === true; }).length;
        var mean = valid.length ? {
            lat: valid.reduce(function (sum, item) { return sum + item.lat; }, 0) / valid.length,
            lng: valid.reduce(function (sum, item) { return sum + item.lng; }, 0) / valid.length
        } : null;
        var interval = wilsonInterval(sea, classified.length);
        var distances = mean ? valid.map(function (item) { return haversineKm(mean, item); }).sort(function (a, b) { return a - b; }) : [];
        var p95Index = distances.length ? Math.min(distances.length - 1, Math.ceil(distances.length * 0.95) - 1) : -1;
        return {
            samples: observations.length,
            valid: valid.length,
            classified: classified.length,
            sea: sea,
            land: classified.length - sea,
            seaProbability: classified.length ? sea / classified.length : null,
            seaInterval: interval,
            mean: mean,
            radius95Km: p95Index >= 0 ? distances[p95Index] : null,
            ellipse95: confidenceEllipse95(valid, mean),
            densityContours: kdeDensityContours(valid, mean, [0.5, 0.8, 0.95])
        };
    }

    function evaluateSequentialStop(observations, options, previous) {
        options = options || {};
        var summary = summarizeObservations(observations);
        var minimum = Math.max(1, Number(options.minSamples || 12));
        var probabilityTolerance = Math.max(0.001, Number(options.probabilityTolerance || 0.1));
        var centroidToleranceKm = Math.max(0, Number(options.centroidToleranceKm || 1));
        var requiredStableBatches = Math.max(1, Number(options.requiredStableBatches || 2));
        var determinedRatio = summary.valid ? summary.classified / summary.valid : 0;
        var centroidShiftKm = previous && previous.summary ? haversineKm(previous.summary.mean, summary.mean) : Infinity;
        var stableNow = summary.samples >= minimum && determinedRatio >= 0.8 &&
            summary.seaInterval.halfWidth <= probabilityTolerance && centroidShiftKm <= centroidToleranceKm;
        var stableBatches = stableNow ? ((previous && previous.stableBatches) || 0) + 1 : 0;
        return {
            stop: stableBatches >= requiredStableBatches,
            reason: stableBatches >= requiredStableBatches ? 'converged' : 'continue',
            stableBatches: stableBatches,
            centroidShiftKm: centroidShiftKm,
            determinedRatio: determinedRatio,
            summary: summary
        };
    }

    function planBudget(siteCount, options) {
        options = options || {};
        var sites = Math.max(0, Math.floor(Number(siteCount)));
        var maxSamples = Math.max(1, Math.floor(Number(options.maxSamples || 48)));
        var minSamples = Math.max(1, Math.floor(Number(options.minSamples || 12)));
        var callLimit = Math.max(0, Math.floor(Number(options.callLimit || sites * maxSamples)));
        var perSiteCap = sites ? Math.min(maxSamples, Math.floor(callLimit / sites)) : 0;
        return {
            sites: sites,
            callLimit: callLimit,
            requestedMaximum: sites * maxSamples,
            perSiteCap: perSiteCap,
            maximumCalls: sites * perSiteCap,
            minimumCalls: sites * Math.min(minSamples, perSiteCap),
            canReachMinimum: sites > 0 && perSiteCap >= minSamples,
            reducedByLimit: perSiteCap < maxSamples
        };
    }

    return {
        createRng: createRng,
        jstDateTimeToUtcIso: jstDateTimeToUtcIso,
        utcIsoToJstParts: utcIsoToJstParts,
        unitPoints: unitPoints,
        inverseNormal: inverseNormal,
        gamma: gamma,
        weibullShapeForCv: weibullShapeForCv,
        transformUnit: transformUnit,
        createParameterSamples: createParameterSamples,
        wilsonInterval: wilsonInterval,
        haversineKm: haversineKm,
        summarizeObservations: summarizeObservations,
        confidenceEllipse95: confidenceEllipse95,
        kdeDensityContours: kdeDensityContours,
        evaluateSequentialStop: evaluateSequentialStop,
        planBudget: planBudget
    };
}));
