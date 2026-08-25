(function (root, factory) {
    var api = factory(root);
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.HistoryController = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
    'use strict';

    var layerRegistry = null;

    function getRecord(runId) {
        if (!root.RunRepository || typeof root.RunRepository.get !== 'function') return Promise.reject(new Error('履歴ストレージを利用できません'));
        return root.RunRepository.get(runId).then(function (record) {
            if (!record) throw new Error('実行履歴が見つかりません');
            return record;
        });
    }

    function ensureLayerRegistry() {
        if (!root.map || !root.MapLayerRegistry) throw new Error('地図を利用できません');
        if (!layerRegistry) layerRegistry = new root.MapLayerRegistry.Registry(root.map);
        return layerRegistry;
    }

    function showRecord(record) {
        if (!root.L) throw new Error('地図描画ライブラリを利用できません');
        var trajectories = record && record.output && record.output.trajectories || [];
        var landings = record && record.output && record.output.landings || [];
        if (!trajectories.length && !landings.length) throw new Error('この履歴には地図表示できる座標がありません');
        var group = typeof root.L.featureGroup === 'function' ? root.L.featureGroup() : root.L.layerGroup();
        trajectories.forEach(function (trajectory) {
            var rows = root.ExportService.trajectoryRows(trajectory);
            var points = rows.map(function (point) { return [Number(point.latitude), Number(point.longitude), Number(point.altitude_m) || 0]; })
                .filter(function (point) { return Number.isFinite(point[0]) && Number.isFinite(point[1]); });
            if (points.length > 1) root.L.polyline(points, { weight: 3, opacity: 0.8 }).addTo(group);
        });
        landings.forEach(function (landing) {
            var lat = Number(landing.latitude);
            var lon = Number(landing.longitude);
            if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
            root.L.circleMarker([lat, lon], { radius: 6, weight: 2, fillOpacity: 0.85 }).bindPopup(landing.seriesId || '着地点').addTo(group);
        });
        var registry = ensureLayerRegistry();
        registry.register('history:' + record.id, group, { group: 'history', visible: true });
        var bounds = group.getBounds && group.getBounds();
        if (bounds && bounds.isValid()) root.map.fitBounds(bounds.pad(0.08));
        return group;
    }

    function show(runId) { return getRecord(runId).then(showRecord); }

    function hide(runId) {
        if (!layerRegistry) return false;
        return layerRegistry.setVisible('history:' + runId, false);
    }

    function isVisible(runId) {
        return Boolean(layerRegistry && layerRegistry.isVisible('history:' + runId));
    }

    function exportRecord(runId, format) {
        return getRecord(runId).then(function (record) { return root.ExportService.exportRun(record, format); });
    }

    function applyToSettings(record) {
        var launch = record.input && record.input.launch || {};
        var flight = record.input && record.input.flight || {};
        var values = { lat: launch.latitude, lon: launch.longitude, initial_alt: launch.altitudeM, ascent: flight.ascentRateMps, drag: flight.descentRateMps, burst: flight.burstAltitudeM, float_alt: flight.floatAltitudeM, flight_profile: flight.profileId };
        Object.keys(values).forEach(function (id) {
            var element = root.document && root.document.getElementById(id);
            if (element && values[id] !== null && values[id] !== undefined) element.value = values[id];
        });
        if (launch.datetimeUtc && root.moment) {
            var time = root.moment.utc(launch.datetimeUtc).utcOffset(9 * 60);
            [['year', time.year()], ['month', time.month() + 1], ['day', time.date()], ['hour', time.hour()], ['min', time.minute()]].forEach(function (entry) {
                var element = root.document.getElementById(entry[0]);
                if (element) element.value = entry[1];
            });
        }
        if (root.jQuery) root.jQuery('#flight_profile, #month').trigger('change');
        return record;
    }

    function loadSettings(runId) { return getRecord(runId).then(applyToSettings); }

    function resume(runId) {
        return getRecord(runId).then(async function (record) {
            if (record.type === 'auto_search' && typeof root.showAutoSearchModal === 'function') {
                await root.showAutoSearchModal();
                return record;
            }
            if (record.type === 'uncertainty' && root.UncertaintyAnalysis && typeof root.UncertaintyAnalysis.open === 'function') {
                await root.UncertaintyAnalysis.open();
                return record;
            }
            return applyToSettings(record);
        });
    }

    function prepareRerun(runId) {
        return getRecord(runId).then(function (record) {
            applyToSettings(record);
            return record;
        });
    }

    return { getRecord: getRecord, show: show, showRecord: showRecord, hide: hide, isVisible: isVisible, exportRecord: exportRecord, loadSettings: loadSettings, resume: resume, prepareRerun: prepareRerun, applyToSettings: applyToSettings };
}));
