// Land/Sea classification helper
// Loads clipped Japan land GeoJSON and offers point-in-polygon test.
// Hybrid approach: instant local PIP first, API fallback for ambiguous/coastal points.

var LandSea = (function () {
    var landFeatures = [];
    var loaded = false;
    var pendingCbs = [];

    function load(url) {
        if (loaded || landFeatures.length > 0) { return; }
        try {
            $.getJSON(url, function (geo) {
                try {
                    if (geo && geo.features) {
                        landFeatures = geo.features.filter(function (f) {
                            return f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon');
                        }).map(function (f) {
                            // Precompute bboxes for quick reject
                            var bbox = computeBBox(f.geometry);
                            f.__bbox = bbox;
                            return f;
                        });
                    }
                    loaded = true;
                    console.log('LandSea: loaded ' + landFeatures.length + ' features');
                    pendingCbs.forEach(function (cb) { cb(); });
                    pendingCbs = [];
                } catch (e) { console.error('LandSea parse error', e); loaded = true; }
            }).fail(function () { loaded = true; pendingCbs = []; console.warn('LandSea GeoJSON load failed'); });
        } catch (e) { console.warn('LandSea load exception', e); }
    }

    function onReady(cb) {
        if (loaded) { cb(); } else { pendingCbs.push(cb); }
    }

    function computeBBox(geom) {
        var minX = 999, minY = 999, maxX = -999, maxY = -999;
        function addCoord(c) {
            var x = c[0], y = c[1];
            if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
        if (geom.type === 'Polygon') {
            geom.coordinates.forEach(function (ring) { ring.forEach(addCoord); });
        } else if (geom.type === 'MultiPolygon') {
            geom.coordinates.forEach(function (poly) { poly.forEach(function (ring) { ring.forEach(addCoord); }); });
        }
        return [minX, minY, maxX, maxY];
    }

    function pointInPolygon(lon, lat, ring) {
        // ray casting algorithm
        var inside = false;
        for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            var xi = ring[i][0], yi = ring[i][1];
            var xj = ring[j][0], yj = ring[j][1];
            var intersect = ((yi > lat) != (yj > lat)) && (lon < (xj - xi) * (lat - yi) / (yj - yi + 1e-12) + xi);
            if (intersect) inside = !inside;
        }
        return inside;
    }

    function distancePointToSegment(px, py, x1, y1, x2, y2) {
        var dx = x2 - x1;
        var dy = y2 - y1;
        if (dx === 0 && dy === 0) {
            var ddx = px - x1;
            var ddy = py - y1;
            return Math.sqrt(ddx * ddx + ddy * ddy);
        }
        var t = ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy);
        if (t < 0) t = 0;
        if (t > 1) t = 1;
        var cx = x1 + t * dx;
        var cy = y1 + t * dy;
        var ex = px - cx;
        var ey = py - cy;
        return Math.sqrt(ex * ex + ey * ey);
    }

    function distanceToRing(lon, lat, ring) {
        if (!ring || ring.length < 2) return 999;
        var minDist = 999;
        for (var i = 1; i < ring.length; i++) {
            var a = ring[i - 1];
            var b = ring[i];
            var d = distancePointToSegment(lon, lat, a[0], a[1], b[0], b[1]);
            if (d < minDist) minDist = d;
        }
        return minDist;
    }

    /**
     * Synchronous check: is the point inside a known land polygon?
     * @param {number} lat - Latitude
     * @param {number} lon - Longitude
     * @returns {boolean|null} true=land, false=not in any polygon (probably sea), null=data not loaded
     */
    function isLand(lat, lon) {
        if (!loaded || landFeatures.length === 0) return null; // unknown yet
        var x = lon, y = lat;
        for (var fi = 0; fi < landFeatures.length; fi++) {
            var f = landFeatures[fi];
            var b = f.__bbox; if (x < b[0] || x > b[2] || y < b[1] || y > b[3]) continue;
            var geom = f.geometry;
            if (geom.type === 'Polygon') {
                if (pointInPolygon(x, y, geom.coordinates[0])) return true;
            } else if (geom.type === 'MultiPolygon') {
                for (var pi = 0; pi < geom.coordinates.length; pi++) {
                    if (pointInPolygon(x, y, geom.coordinates[pi][0])) return true;
                }
            }
        }
        return false; // not in any land polygon within Japan clip
    }

    /**
     * Check if a point is near the edge of a land polygon (within ~0.05 deg ≈ 5km).
     * Used to decide whether to fall back to API for more precise check.
     */
    function isNearCoast(lat, lon) {
        if (!loaded || landFeatures.length === 0) return true; // can't tell, assume near coast
        var x = lon, y = lat;
        var bboxMargin = 0.08; // 粗フィルタ
        var coastMargin = 0.025; // 約2-3km
        for (var fi = 0; fi < landFeatures.length; fi++) {
            var f = landFeatures[fi];
            var b = f.__bbox;
            if (x < b[0] - bboxMargin || x > b[2] + bboxMargin || y < b[1] - bboxMargin || y > b[3] + bboxMargin) continue;

            var geom = f.geometry;
            if (geom.type === 'Polygon') {
                if (distanceToRing(x, y, geom.coordinates[0]) <= coastMargin) return true;
            } else if (geom.type === 'MultiPolygon') {
                for (var pi = 0; pi < geom.coordinates.length; pi++) {
                    if (distanceToRing(x, y, geom.coordinates[pi][0]) <= coastMargin) return true;
                }
            }
        }
        return false;
    }

    return { load: load, onReady: onReady, isLand: isLand, isNearCoast: isNearCoast };
})();

// Auto-load on script include
$(function () {
    LandSea.load('data/land_japan_raw.geojson');
});
