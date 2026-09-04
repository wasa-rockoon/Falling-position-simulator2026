// Compatibility facade for the deterministic local land/sea classifier.
// New code should prefer LandSea.classify(), which returns a LandSeaResult.

var LandSea = (function (root) {
    'use strict';

    var classifier = root.LandSeaClassifier.create();
    var loadPromise = null;

    function load() {
        if (loadPromise) return loadPromise;
        loadPromise = classifier.load({ manifestUrl: 'data/land-sea-datasets.json' }).catch(function (error) {
            if (typeof reportNonFatalError === 'function') reportNonFatalError(error, 'land-sea.dataset-load');
            else if (root.console && typeof root.console.warn === 'function') root.console.warn('Land/sea datasets could not be loaded', error);
            return null;
        });
        return loadPromise;
    }

    function classify(lat, lon) {
        return classifier.classify(lat, lon);
    }

    function classifyAsync(lat, lon) {
        return load().then(function () { return classifier.classify(lat, lon); });
    }

    return {
        load: load,
        onReady: classifier.onReady,
        classify: classify,
        classifyAsync: classifyAsync,
        classifyMany: classifier.classifyMany,
        isLand: classifier.isLand,
        legacyIsWater: classifier.legacyIsWater,
        isNearCoast: classifier.isNearCoast,
        distanceToCoastKm: classifier.distanceToCoastKm,
        haversineDistKm: classifier.haversineDistKm,
        getStatus: classifier.getStatus
    };
}(window));

window.AppShell.registerInitializer('landsea', function () {
    return LandSea.load();
}, 20);
