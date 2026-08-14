(function (root, factory) {
    var api = factory(root);
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.LandSeaClassifier = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
    'use strict';

    var EARTH_RADIUS_KM = 6371.0088;
    var DEFAULT_MANIFEST_URL = 'data/land-sea-datasets.json';
    var CLASSIFICATIONS = ['land', 'sea', 'inland_water', 'unknown'];

    function finiteNumber(value) {
        var number = Number(value);
        return Number.isFinite(number) ? number : null;
    }

    function clone(value) {
        if (value == null) return value;
        return JSON.parse(JSON.stringify(value));
    }

    function emptyResult(reason, dataVersion) {
        return {
            classification: 'unknown',
            confidence: 'unknown',
            source: 'unavailable',
            coastDistanceKm: null,
            dataVersion: dataVersion || '',
            reason: reason || 'classifier-unavailable'
        };
    }

    function result(classification, confidence, distanceKm, dataVersion, reason) {
        return {
            classification: classification,
            confidence: confidence,
            source: 'local_dataset',
            coastDistanceKm: Number.isFinite(distanceKm) ? distanceKm : null,
            dataVersion: dataVersion || '',
            reason: reason || ''
        };
    }

    function bboxForRing(ring) {
        var bbox = [Infinity, Infinity, -Infinity, -Infinity];
        (ring || []).forEach(function (coordinate) {
            var lon = Number(coordinate[0]);
            var lat = Number(coordinate[1]);
            if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
            bbox[0] = Math.min(bbox[0], lon);
            bbox[1] = Math.min(bbox[1], lat);
            bbox[2] = Math.max(bbox[2], lon);
            bbox[3] = Math.max(bbox[3], lat);
        });
        return bbox;
    }

    function containsBbox(bbox, lon, lat) {
        return bbox && lon >= bbox[0] && lon <= bbox[2] && lat >= bbox[1] && lat <= bbox[3];
    }

    function pointOnSegment(lon, lat, first, second) {
        var dx = second[0] - first[0];
        var dy = second[1] - first[1];
        if (dx === 0 && dy === 0) {
            return Math.abs(lon - first[0]) <= 1e-11 && Math.abs(lat - first[1]) <= 1e-11;
        }
        var cross = (lon - first[0]) * dy - (lat - first[1]) * dx;
        var scale = Math.max(1, Math.abs(dx), Math.abs(dy));
        if (Math.abs(cross) > 1e-11 * scale) return false;
        var dot = (lon - first[0]) * dx + (lat - first[1]) * dy;
        if (dot < -1e-12) return false;
        return dot <= dx * dx + dy * dy + 1e-12;
    }

    function pointInRing(lon, lat, ring) {
        if (!ring || ring.length < 4 || !containsBbox(bboxForRing(ring), lon, lat)) return 'outside';
        var inside = false;
        for (var index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
            var first = ring[previous];
            var second = ring[index];
            if (pointOnSegment(lon, lat, first, second)) return 'boundary';
            var crosses = (second[1] > lat) !== (first[1] > lat);
            if (crosses && lon < (first[0] - second[0]) * (lat - second[1]) / (first[1] - second[1]) + second[0]) {
                inside = !inside;
            }
        }
        return inside ? 'inside' : 'outside';
    }

    function polygonsFromGeometry(geometry) {
        if (!geometry) return [];
        var source = geometry.type === 'Polygon'
            ? [geometry.coordinates]
            : (geometry.type === 'MultiPolygon' ? geometry.coordinates : []);
        return source.map(function (rings) {
            return {
                outer: rings[0] || [],
                holes: rings.slice(1),
                bbox: bboxForRing(rings[0] || [])
            };
        }).filter(function (polygon) { return polygon.outer.length >= 4; });
    }

    function buildIndex(geoJson) {
        var polygons = [];
        var boundaryRings = [];
        (geoJson && Array.isArray(geoJson.features) ? geoJson.features : []).forEach(function (feature) {
            polygonsFromGeometry(feature.geometry).forEach(function (polygon) {
                polygon.properties = clone(feature.properties || {});
                polygons.push(polygon);
                boundaryRings.push(polygon.outer);
                polygon.holes.forEach(function (hole) { boundaryRings.push(hole); });
            });
        });
        return { polygons: polygons, boundaryRings: boundaryRings };
    }

    function locate(index, lon, lat) {
        var insideHole = false;
        for (var polygonIndex = 0; polygonIndex < index.polygons.length; polygonIndex += 1) {
            var polygon = index.polygons[polygonIndex];
            if (!containsBbox(polygon.bbox, lon, lat)) continue;
            var outer = pointInRing(lon, lat, polygon.outer);
            if (outer === 'boundary') return { location: 'boundary', polygon: polygon };
            if (outer !== 'inside') continue;
            var holeMatch = false;
            for (var holeIndex = 0; holeIndex < polygon.holes.length; holeIndex += 1) {
                var hole = pointInRing(lon, lat, polygon.holes[holeIndex]);
                if (hole === 'boundary') return { location: 'boundary', polygon: polygon };
                if (hole === 'inside') { holeMatch = true; insideHole = true; break; }
            }
            if (!holeMatch) return { location: 'inside', polygon: polygon };
        }
        return { location: insideHole ? 'hole' : 'outside', polygon: null };
    }

    function toRadians(degrees) {
        return degrees * Math.PI / 180;
    }

    function normalizeLongitudeDelta(deltaDegrees) {
        var delta = deltaDegrees;
        while (delta > 180) delta -= 360;
        while (delta < -180) delta += 360;
        return delta;
    }

    function pointSegmentDistanceKm(lat, lon, first, second) {
        var meanLat = toRadians((lat + Number(first[1]) + Number(second[1])) / 3);
        function local(coordinate) {
            return {
                x: toRadians(normalizeLongitudeDelta(Number(coordinate[0]) - lon)) * Math.cos(meanLat) * EARTH_RADIUS_KM,
                y: toRadians(Number(coordinate[1]) - lat) * EARTH_RADIUS_KM
            };
        }
        var a = local(first);
        var b = local(second);
        var dx = b.x - a.x;
        var dy = b.y - a.y;
        var denominator = dx * dx + dy * dy;
        var fraction = denominator ? -(a.x * dx + a.y * dy) / denominator : 0;
        fraction = Math.max(0, Math.min(1, fraction));
        var x = a.x + fraction * dx;
        var y = a.y + fraction * dy;
        return Math.sqrt(x * x + y * y);
    }

    function distanceToRingsKm(lat, lon, rings) {
        var minimum = Infinity;
        for (var ringIndex = 0; ringIndex < rings.length; ringIndex += 1) {
            var ring = rings[ringIndex];
            for (var index = 1; index < ring.length; index += 1) {
                minimum = Math.min(minimum, pointSegmentDistanceKm(lat, lon, ring[index - 1], ring[index]));
            }
        }
        return Number.isFinite(minimum) ? minimum : null;
    }

    function haversineDistKm(lat1, lon1, lat2, lon2) {
        var firstLat = toRadians(Number(lat1));
        var secondLat = toRadians(Number(lat2));
        var deltaLat = secondLat - firstLat;
        var deltaLon = toRadians(normalizeLongitudeDelta(Number(lon2) - Number(lon1)));
        var value = Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
            Math.cos(firstLat) * Math.cos(secondLat) * Math.sin(deltaLon / 2) * Math.sin(deltaLon / 2);
        return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(Math.max(0, 1 - value)));
    }

    function confidenceForDistance(distanceKm) {
        if (!Number.isFinite(distanceKm)) return 'unknown';
        if (distanceKm >= 2) return 'high';
        if (distanceKm >= 0.25) return 'medium';
        return 'low';
    }

    function create(options) {
        options = options || {};
        var landIndex = buildIndex(null);
        var waterIndex = buildIndex(null);
        var metadata = clone(options.metadata || {});
        var state = 'idle';
        var loadError = null;
        var loadingPromise = null;
        var callbacks = [];
        var cache = new Map();

        function dataVersion() {
            return metadata.version || '';
        }

        function setDatasets(datasets) {
            datasets = datasets || {};
            landIndex = buildIndex(datasets.landGeoJson);
            waterIndex = buildIndex(datasets.inlandWaterGeoJson);
            metadata = clone(datasets.metadata || metadata || {});
            if (!metadata.coverage && datasets.landGeoJson && datasets.landGeoJson.bbox) metadata.coverage = datasets.landGeoJson.bbox;
            state = landIndex.polygons.length && waterIndex.polygons.length ? 'ready' : 'error';
            loadError = state === 'ready' ? null : new Error('Land and inland-water datasets are required');
            cache.clear();
            var pending = callbacks.slice();
            callbacks = [];
            pending.forEach(function (callback) { callback(loadError); });
            return state === 'ready';
        }

        function fetchJson(url, fetchImpl) {
            var request = fetchImpl || root.fetch;
            if (request === root.fetch && typeof root.fetch === 'function') request = root.fetch.bind(root);
            if (typeof request !== 'function') return Promise.reject(new Error('fetch is unavailable'));
            return request(url, { cache: 'no-cache' }).then(function (response) {
                if (!response || !response.ok) throw new Error('Failed to load ' + url + ' (' + (response && response.status) + ')');
                return response.json();
            });
        }

        function load(loadOptions) {
            if (state === 'ready') return Promise.resolve(api());
            if (loadingPromise) return loadingPromise;
            var normalized = typeof loadOptions === 'string' ? { manifestUrl: loadOptions } : (loadOptions || {});
            var manifestUrl = normalized.manifestUrl || DEFAULT_MANIFEST_URL;
            state = 'loading';
            loadingPromise = fetchJson(manifestUrl, normalized.fetchImpl).then(function (manifest) {
                var landUrl = normalized.landUrl || manifest.land.file;
                var waterUrl = normalized.inlandWaterUrl || manifest.inlandWater.file;
                return Promise.all([
                    fetchJson(landUrl, normalized.fetchImpl),
                    fetchJson(waterUrl, normalized.fetchImpl)
                ]).then(function (datasets) {
                    setDatasets({ landGeoJson: datasets[0], inlandWaterGeoJson: datasets[1], metadata: manifest });
                    return api();
                });
            }).catch(function (error) {
                state = 'error';
                loadError = error;
                var pending = callbacks.slice();
                callbacks = [];
                pending.forEach(function (callback) { callback(error); });
                throw error;
            });
            return loadingPromise;
        }

        function coverageContains(lat, lon) {
            var coverage = metadata.coverage;
            return !Array.isArray(coverage) || coverage.length !== 4 || containsBbox(coverage, lon, lat);
        }

        function classify(latValue, lonValue) {
            var lat = finiteNumber(latValue);
            var lon = finiteNumber(lonValue);
            if (lat === null || lon === null || lat < -90 || lat > 90 || lon < -180 || lon > 360) {
                return emptyResult('invalid-coordinate', dataVersion());
            }
            if (lon > 180) lon -= 360;
            var cacheKey = lat.toFixed(6) + '|' + lon.toFixed(6) + '|' + dataVersion();
            if (cache.has(cacheKey)) return clone(cache.get(cacheKey));
            if (state !== 'ready') return emptyResult(state === 'error' ? 'dataset-load-failed' : 'dataset-not-ready', dataVersion());
            if (!coverageContains(lat, lon)) return emptyResult('outside-dataset-coverage', dataVersion());

            var water = locate(waterIndex, lon, lat);
            var land = locate(landIndex, lon, lat);
            var coastDistance = distanceToRingsKm(lat, lon, landIndex.boundaryRings);
            var classified;
            if (water.location === 'boundary' || land.location === 'boundary') {
                classified = result('unknown', 'low', coastDistance, dataVersion(), 'dataset-boundary');
            } else if (water.location === 'inside' || land.location === 'hole') {
                classified = result('inland_water', 'high', coastDistance, dataVersion(), water.location === 'inside' ? 'inland-water-polygon' : 'land-polygon-hole');
            } else if (land.location === 'inside') {
                classified = result('land', confidenceForDistance(coastDistance), coastDistance, dataVersion(), 'land-polygon');
            } else {
                classified = result('sea', confidenceForDistance(coastDistance), coastDistance, dataVersion(), 'outside-land-polygons');
            }
            cache.set(cacheKey, classified);
            if (cache.size > 2000) cache.delete(cache.keys().next().value);
            return clone(classified);
        }

        function classifyMany(points) {
            return (points || []).map(function (point) {
                return classify(point.latitude != null ? point.latitude : point.lat, point.longitude != null ? point.longitude : (point.lng != null ? point.lng : point.lon));
            });
        }

        function classifyAsync(lat, lon) {
            var ready = state === 'ready' ? Promise.resolve() : load(options.loadOptions);
            return ready.then(function () { return classify(lat, lon); });
        }

        function isLand(lat, lon) {
            var classification = classify(lat, lon).classification;
            if (classification === 'land') return true;
            if (classification === 'sea' || classification === 'inland_water') return false;
            return null;
        }

        function legacyIsWater(lat, lon) {
            var classification = classify(lat, lon).classification;
            if (classification === 'sea') return true;
            if (classification === 'land') return false;
            return null;
        }

        function distanceToCoastKm(lat, lon) {
            if (state !== 'ready') return null;
            return distanceToRingsKm(Number(lat), Number(lon), landIndex.boundaryRings);
        }

        function isNearCoast(lat, lon, thresholdKm) {
            var distance = distanceToCoastKm(lat, lon);
            return Number.isFinite(distance) ? distance <= Number(thresholdKm == null ? 3 : thresholdKm) : null;
        }

        function onReady(callback) {
            if (state === 'ready') { callback(null); return; }
            if (state === 'error') { callback(loadError); return; }
            callbacks.push(callback);
        }

        function api() {
            return {
                load: load,
                setDatasets: setDatasets,
                classify: classify,
                classifyMany: classifyMany,
                classifyAsync: classifyAsync,
                isLand: isLand,
                legacyIsWater: legacyIsWater,
                distanceToCoastKm: distanceToCoastKm,
                isNearCoast: isNearCoast,
                haversineDistKm: haversineDistKm,
                onReady: onReady,
                getStatus: function () { return { state: state, error: loadError, dataVersion: dataVersion() }; }
            };
        }

        if (options.landGeoJson || options.inlandWaterGeoJson) setDatasets(options);
        return api();
    }

    return {
        classifications: CLASSIFICATIONS.slice(),
        defaultManifestUrl: DEFAULT_MANIFEST_URL,
        create: create,
        haversineDistKm: haversineDistKm,
        pointInRing: pointInRing,
        distanceToRingsKm: distanceToRingsKm
    };
}));
