(function (root, factory) {
    var api = factory(root);
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.SettingsRepository = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
    'use strict';

    var KEYS = {
        presets: 'predictor_presets',
        lastSettings: 'predictor_last_settings'
    };
    var memory = {};

    function clone(value) {
        if (value === undefined) return undefined;
        return JSON.parse(JSON.stringify(value));
    }

    function readJson(key, fallback) {
        try {
            if (root.localStorage) {
                var raw = root.localStorage.getItem(key);
                if (raw !== null) return JSON.parse(raw);
            }
        } catch (error) {
            if (typeof root.reportNonFatalError === 'function') root.reportNonFatalError(error, 'settings.read.' + key);
        }
        return memory[key] === undefined ? clone(fallback) : clone(memory[key]);
    }

    function writeJson(key, value) {
        var copy = clone(value);
        memory[key] = copy;
        try {
            if (root.localStorage) root.localStorage.setItem(key, JSON.stringify(copy));
        } catch (error) {
            if (typeof root.reportNonFatalError === 'function') root.reportNonFatalError(error, 'settings.write.' + key);
        }
        return clone(copy);
    }

    function getPresets() {
        var presets = readJson(KEYS.presets, []);
        return Array.isArray(presets) ? presets : [];
    }

    function savePresets(presets) {
        return writeJson(KEYS.presets, Array.isArray(presets) ? presets : []);
    }

    function getLastSettings() {
        var settings = readJson(KEYS.lastSettings, null);
        return settings && typeof settings === 'object' ? settings : null;
    }

    function saveLastSettings(settings) {
        return writeJson(KEYS.lastSettings, settings || {});
    }

    function readLegacyCookieLocations(cookieName) {
        var jq = root.jQuery || root.$;
        if (!jq || !jq.Jookie) return [];
        try {
            jq.Jookie.Initialise(cookieName || 'cusf_predictor', 99999999);
            var count = Number(jq.Jookie.Get(cookieName || 'cusf_predictor', 'idx')) || 0;
            var locations = [];
            for (var index = 1; locations.length < count && index <= 50; index += 1) {
                var name = jq.Jookie.Get(cookieName || 'cusf_predictor', index + '_name');
                if (!name) continue;
                locations.push({
                    legacyIndex: index,
                    name: name,
                    latitude: Number(jq.Jookie.Get(cookieName || 'cusf_predictor', index + '_lat')),
                    longitude: Number(jq.Jookie.Get(cookieName || 'cusf_predictor', index + '_lon')),
                    altitudeM: Number(jq.Jookie.Get(cookieName || 'cusf_predictor', index + '_alt'))
                });
            }
            return locations;
        } catch (error) {
            if (typeof root.reportNonFatalError === 'function') root.reportNonFatalError(error, 'settings.legacy-cookie');
            return [];
        }
    }

    return {
        keys: Object.assign({}, KEYS),
        getPresets: getPresets,
        savePresets: savePresets,
        getLastSettings: getLastSettings,
        saveLastSettings: saveLastSettings,
        readLegacyCookieLocations: readLegacyCookieLocations
    };
}));
