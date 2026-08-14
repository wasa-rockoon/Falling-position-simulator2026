(function (root, factory) {
    var requestContext = root.PredictionRequestContext;
    var predictionApi = root.PredictionApi;
    if (typeof module === 'object' && module.exports) {
        requestContext = requestContext || require('./request-context.js');
        predictionApi = predictionApi || require('./pred-api-client.js');
        module.exports = factory(requestContext, predictionApi);
    } else {
        root.PredictionRunner = factory(requestContext, predictionApi);
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function (PredictionRequestContext, PredictionApi) {
    'use strict';

    function finite(value, field) {
        var number = Number(value);
        if (!Number.isFinite(number)) throw new Error('予測API応答の' + field + 'が不正です');
        return number;
    }

    function longitude(value) {
        var number = finite(value, '経度');
        while (number > 180) number -= 360;
        while (number < -180) number += 360;
        return number;
    }

    function point(item, phase) {
        if (!item) throw new Error('予測API応答に軌跡点がありません');
        return {
            latitude: finite(item.latitude, '緯度'),
            longitude: longitude(item.longitude),
            altitudeM: finite(item.altitude, '高度'),
            timeUtc: item.datetime || null,
            phase: phase || null
        };
    }

    function timeDifferenceSeconds(start, end) {
        var startMs = Date.parse(start || '');
        var endMs = Date.parse(end || '');
        return Number.isFinite(startMs) && Number.isFinite(endMs) ? Math.max(0, Math.round((endMs - startMs) / 1000)) : null;
    }

    function normalizePrediction(input) {
        var prediction = Array.isArray(input) ? input : input && input.prediction;
        if (!Array.isArray(prediction) || prediction.length < 2) {
            throw new Error('予測API応答にtrajectoryがありません');
        }
        var stages = prediction.map(function (stage) {
            var phase = stage && stage.stage || null;
            var trajectory = stage && stage.trajectory;
            return {
                phase: phase,
                points: Array.isArray(trajectory) ? trajectory.map(function (item) { return point(item, phase); }) : []
            };
        }).filter(function (stage) { return stage.points.length > 0; });
        if (stages.length < 2) throw new Error('予測API応答の軌跡区間が不足しています');

        var firstStage = stages[0];
        var terminalStage = stages[stages.length - 1];
        var launch = firstStage.points[0];
        var burst = terminalStage.points[0];
        var landing = terminalStage.points[terminalStage.points.length - 1];
        var flightPath = [];
        stages.forEach(function (stage) { Array.prototype.push.apply(flightPath, stage.points); });
        return {
            stages: stages,
            flightPath: flightPath,
            launch: launch,
            burst: burst,
            landing: landing,
            profile: terminalStage.phase === 'descent' ? 'standard_profile' : 'float_profile',
            flightTimeSec: timeDifferenceSeconds(launch.timeUtc, landing.timeUtc)
        };
    }

    function createContext(options) {
        if (!PredictionRequestContext || typeof PredictionRequestContext.create !== 'function') {
            throw new Error('PredictionRequestContext is unavailable');
        }
        return PredictionRequestContext.create(options || {});
    }

    function resolveContext(contextOrOptions) {
        if (contextOrOptions && (typeof contextOrOptions.request === 'function' || contextOrOptions.client)) return contextOrOptions;
        return createContext(contextOrOptions || {});
    }

    async function request(params, contextOrOptions, requestOptions) {
        var context = resolveContext(contextOrOptions);
        var response;
        if (typeof context.request === 'function') response = await context.request(params, requestOptions || {});
        else if (context.client && typeof context.client.request === 'function') response = await context.client.request(params, requestOptions || {});
        else throw new Error('Prediction request client is unavailable');
        return response;
    }

    async function run(params, contextOrOptions, requestOptions) {
        var response = await request(params, contextOrOptions, requestOptions);
        var data = response && response.data;
        if (data && data.error) {
            throw new Error(data.error.description || data.error.message || 'Predictor returned error');
        }
        var prediction = normalizePrediction(data);
        return {
            data: data,
            response: response,
            prediction: prediction,
            landing: prediction.landing
        };
    }

    return {
        createContext: createContext,
        normalizePrediction: normalizePrediction,
        request: request,
        run: run,
        resolveApiUrl: PredictionApi && PredictionApi.resolveApiUrl
    };
}));
