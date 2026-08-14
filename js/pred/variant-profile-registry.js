(function (root, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.VariantProfileRegistry = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    var EHIME_DEFINITIONS = Object.freeze([
        ['BASE', 0, 0, 0, '基準設定'],
        ['ASC-', -1, 0, 0, '上昇 -1 m/s'],
        ['ASC+', 1, 0, 0, '上昇 +1 m/s'],
        ['DES-', 0, -3, 0, '下降 -3 m/s'],
        ['DES+', 0, 3, 0, '下降 +3 m/s'],
        ['BURST-', 0, 0, -0.20, '破裂高度 -20%'],
        ['BURST+', 0, 0, 0.10, '破裂高度 +10%'],
        ['A-D-', -1, -3, 0, '上昇 -1 m/s・下降 -3 m/s'],
        ['A+D+', 1, 3, 0, '上昇 +1 m/s・下降 +3 m/s'],
        ['A-B-', -1, 0, -0.20, '上昇 -1 m/s・破裂高度 -20%'],
        ['A+B+', 1, 0, 0.10, '上昇 +1 m/s・破裂高度 +10%'],
        ['D-B-', 0, -3, -0.20, '下降 -3 m/s・破裂高度 -20%'],
        ['D+B+', 0, 3, 0.10, '下降 +3 m/s・破裂高度 +10%']
    ]);

    function finite(value, field) {
        var number = Number(value);
        if (!Number.isFinite(number)) throw new TypeError(field + ' must be finite');
        return number;
    }

    function buildEhime(baseSettings) {
        baseSettings = baseSettings || {};
        var ascent = finite(baseSettings.ascent_rate, 'ascent_rate');
        var descent = finite(baseSettings.descent_rate, 'descent_rate');
        var burst = finite(baseSettings.burst_altitude, 'burst_altitude');
        return EHIME_DEFINITIONS.map(function (definition, index) {
            var settings = Object.assign({}, baseSettings, {
                ascent_rate: ascent + definition[1],
                descent_rate: Math.max(0.5, descent + definition[2]),
                burst_altitude: burst * (1 + definition[3])
            });
            return {
                id: 'ehime_' + index,
                index: index,
                label: definition[0],
                description: definition[4],
                desc: definition[4],
                settings: settings
            };
        });
    }

    return {
        EHIME_VARIANT_COUNT: EHIME_DEFINITIONS.length,
        buildEhime: buildEhime
    };
}));
