(function (root, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.AutoSearchCore = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    function weatherKey(candidate) {
        return Number(candidate.lat).toFixed(5) + '|' + Number(candidate.lon).toFixed(5) + '|' + String(candidate.launchUtc).slice(0, 10);
    }

    function countUniqueWeatherCalls(candidates) {
        return new Set((candidates || []).map(weatherKey)).size;
    }

    function coarseScore(candidate) {
        var coarse = candidate.coarse || {};
        if (coarse.ok) return Number(coarse.distanceKm) || 0;
        if (coarse.reason === 'too_far_offshore') return 1000 + (Number(coarse.distanceKm) || 0);
        if (coarse.reason === 'land') return 2000;
        return 3000;
    }

    function selectFineCandidates(candidates, mode) {
        var copied = (candidates || []).slice();
        if (mode === 'fast') return copied.filter(function (candidate) { return candidate.coarse && candidate.coarse.ok; });
        if (mode === 'ranked') return copied.sort(function (left, right) { return coarseScore(left) - coarseScore(right); });
        return copied;
    }

    function passesWeather(weather, limits) {
        if (!weather || weather.status === 'unknown') return true;
        return Number(weather.precipitationMm) <= Number(limits.rainThreshold) &&
            Number(weather.windSpeedMs) <= Number(limits.windThreshold);
    }

    function passesSeaThreshold(seaPercent, threshold) {
        return Number(seaPercent) >= Number(threshold);
    }

    function estimateMaximumCalls(candidates, fineVariantCount) {
        var count = (candidates || []).length;
        var variants = Number(fineVariantCount) || 13;
        var weather = countUniqueWeatherCalls(candidates);
        var coarse = count;
        var fine = count * variants;
        return { weather: weather, coarse: coarse, fine: fine, total: weather + coarse + fine };
    }

    return {
        weatherKey: weatherKey,
        countUniqueWeatherCalls: countUniqueWeatherCalls,
        selectFineCandidates: selectFineCandidates,
        passesWeather: passesWeather,
        passesSeaThreshold: passesSeaThreshold,
        estimateMaximumCalls: estimateMaximumCalls
    };
}));
