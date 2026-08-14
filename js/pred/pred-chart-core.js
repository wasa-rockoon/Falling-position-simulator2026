(function (root, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.PredictionChartCore = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    var DEFAULT_PALETTE = ['#007aff', '#ff3b30', '#34c759', '#af52de', '#ff9500', '#5ac8fa', '#ff2d55', '#5856d6'];

    function finite(value) {
        var number = Number(value);
        return Number.isFinite(number) ? number : null;
    }

    function normalizeLongitude(value) {
        var longitude = finite(value);
        if (longitude === null) return null;
        while (longitude > 180) longitude -= 360;
        while (longitude < -180) longitude += 360;
        return longitude;
    }

    function timestamp(value) {
        var parsed = Date.parse(value);
        return Number.isFinite(parsed) ? parsed : null;
    }

    function flattenPrediction(prediction) {
        var points = [];
        (Array.isArray(prediction) ? prediction : []).forEach(function (stage) {
            (stage && Array.isArray(stage.trajectory) ? stage.trajectory : []).forEach(function (point) {
                var latitude = finite(point && point.latitude);
                var longitude = normalizeLongitude(point && point.longitude);
                var altitude = finite(point && point.altitude);
                if (latitude === null || longitude === null || altitude === null) return;
                points.push({
                    latitude: latitude,
                    longitude: longitude,
                    altitudeM: altitude,
                    timestampMs: timestamp(point.datetime)
                });
            });
        });
        return points;
    }

    function haversineMeters(left, right) {
        var radius = 6371008.8;
        var toRadians = Math.PI / 180;
        var lat1 = left.latitude * toRadians;
        var lat2 = right.latitude * toRadians;
        var deltaLat = (right.latitude - left.latitude) * toRadians;
        var deltaLon = (right.longitude - left.longitude) * toRadians;
        var sinLat = Math.sin(deltaLat / 2);
        var sinLon = Math.sin(deltaLon / 2);
        var a = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;
        return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
    }

    function buildAltitudeData(points) {
        if (!points.length) return [];
        var firstTimestamp = points.find(function (point) { return point.timestampMs !== null; });
        var origin = firstTimestamp ? firstTimestamp.timestampMs : null;
        return points.map(function (point, index) {
            var elapsed = origin !== null && point.timestampMs !== null ? (point.timestampMs - origin) / 60000 : index;
            return { x: Math.max(0, elapsed), y: point.altitudeM };
        });
    }

    function buildWindData(points) {
        var data = [];
        for (var index = 1; index < points.length; index += 1) {
            var previous = points[index - 1];
            var current = points[index];
            if (previous.timestampMs === null || current.timestampMs === null) continue;
            var seconds = (current.timestampMs - previous.timestampMs) / 1000;
            if (!(seconds > 0)) continue;
            data.push({
                x: haversineMeters(previous, current) / seconds,
                y: (previous.altitudeM + current.altitudeM) / 2
            });
        }
        return data;
    }

    function buildSeries(prediction, options, colorIndex) {
        options = options || {};
        var points = flattenPrediction(prediction);
        return {
            id: String(options.id || 'prediction'),
            label: String(options.label || '予測'),
            color: options.color || DEFAULT_PALETTE[colorIndex % DEFAULT_PALETTE.length],
            altitude: buildAltitudeData(points),
            wind: buildWindData(points),
            visible: options.visible !== false
        };
    }

    function SeriesRegistry(options) {
        options = options || {};
        this.maxStored = Math.max(5, Number(options.maxStored) || 20);
        this.maxVisible = Math.max(1, Number(options.maxVisible) || 5);
        this.groupId = '';
        this.items = [];
    }

    SeriesRegistry.prototype.upsert = function (prediction, options) {
        options = options || {};
        var nextGroup = String(options.groupId || 'default');
        if (this.groupId && this.groupId !== nextGroup) this.items = [];
        this.groupId = nextGroup;
        var id = String(options.id || 'prediction');
        var existingIndex = this.items.findIndex(function (item) { return item.id === id; });
        var visibleCount = this.items.filter(function (item) { return item.visible; }).length;
        var series = buildSeries(prediction, Object.assign({}, options, {
            id: id,
            visible: existingIndex >= 0 ? this.items[existingIndex].visible : visibleCount < this.maxVisible
        }), existingIndex >= 0 ? existingIndex : this.items.length);
        if (existingIndex >= 0) this.items.splice(existingIndex, 1, series);
        else this.items.push(series);
        while (this.items.length > this.maxStored) this.items.shift();
        return this.snapshot();
    };

    SeriesRegistry.prototype.setVisible = function (id, visible) {
        var item = this.items.find(function (candidate) { return candidate.id === String(id); });
        if (!item) return { ok: false, reason: 'not_found' };
        if (visible && !item.visible && this.items.filter(function (candidate) { return candidate.visible; }).length >= this.maxVisible) {
            return { ok: false, reason: 'visible_limit' };
        }
        item.visible = visible === true;
        return { ok: true, reason: '' };
    };

    SeriesRegistry.prototype.visibleItems = function () {
        return this.items.filter(function (item) { return item.visible; });
    };

    SeriesRegistry.prototype.snapshot = function () {
        return this.items.map(function (item) {
            return {
                id: item.id,
                label: item.label,
                color: item.color,
                visible: item.visible,
                altitude: item.altitude.map(function (point) { return { x: point.x, y: point.y }; }),
                wind: item.wind.map(function (point) { return { x: point.x, y: point.y }; })
            };
        });
    };

    SeriesRegistry.prototype.clear = function () {
        this.groupId = '';
        this.items = [];
    };

    return {
        palette: DEFAULT_PALETTE.slice(),
        flattenPrediction: flattenPrediction,
        haversineMeters: haversineMeters,
        buildAltitudeData: buildAltitudeData,
        buildWindData: buildWindData,
        buildSeries: buildSeries,
        SeriesRegistry: SeriesRegistry
    };
}));
