(function (root, factory) {
    var predictionApi = root.PredictionApi;
    var appErrors = root.AppErrors;
    if (typeof module === 'object' && module.exports) {
        predictionApi = predictionApi || require('./pred-api-client.js');
        appErrors = appErrors || require('../core/app-errors.js');
        module.exports = factory(predictionApi, appErrors);
    } else {
        root.PredictionRequestContext = factory(predictionApi, appErrors);
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function (PredictionApi, AppErrors) {
    'use strict';

    if (!PredictionApi) throw new Error('PredictionRequestContext requires PredictionApi');

    function finitePositive(value, fallback) {
        var number = Number(value);
        return Number.isFinite(number) && number > 0 ? number : fallback;
    }

    function createPauseController(existing) {
        if (existing) return existing;
        return {
            status: 'idle',
            pauseRequested: false,
            start: function () { this.status = 'running'; this.pauseRequested = false; },
            requestPause: function () {
                if (this.status === 'running') {
                    this.status = 'pause_requested';
                    this.pauseRequested = true;
                }
            },
            reachBoundary: function () {
                if (!this.pauseRequested) return false;
                this.status = 'paused';
                return true;
            },
            resume: function () { this.status = 'running'; this.pauseRequested = false; },
            complete: function () { this.status = 'completed'; this.pauseRequested = false; }
        };
    }

    function create(options) {
        options = options || {};
        var source = options.source || options.endpointId || 'sondehub';
        var customUrl = options.customUrl || '';
        var baseUrl = options.resolvedBaseUrl || options.baseUrl || PredictionApi.resolveApiUrl(source, customUrl);
        var client = options.client || PredictionApi.getClient({
            source: source,
            customUrl: customUrl,
            baseUrl: baseUrl,
            policy: options.policy,
            cacheTtlMs: options.cacheTtlMs,
            fetchImpl: options.fetchImpl,
            onQueueStateChange: options.onQueueStateChange
        });
        var maxHttpAttempts = finitePositive(options.maxHttpAttempts, Number.POSITIVE_INFINITY);
        var diagnostics = options.diagnostics || {
            httpAttempts: 0,
            cacheHits: 0,
            retryCount: 0,
            failures: 0,
            lastLabel: '',
            lastError: null
        };
        var pauseController = createPauseController(options.pauseController);

        var context = {
            runId: options.runId || '',
            endpointId: source,
            source: source,
            resolvedBaseUrl: baseUrl,
            baseUrl: baseUrl,
            timeoutMs: finitePositive(options.timeoutMs, client.timeoutMs),
            maxHttpAttempts: maxHttpAttempts,
            concurrency: client.queue ? client.queue.concurrency : finitePositive(options.concurrency, 1),
            minIntervalMs: client.queue ? client.queue.minIntervalMs : Math.max(0, Number(options.minIntervalMs) || 0),
            cachePolicy: Object.freeze({
                ttlMs: finitePositive(options.cacheTtlMs, client.cacheTtlMs)
            }),
            client: client,
            diagnostics: diagnostics,
            pauseController: pauseController
        };

        context.canAttempt = function () {
            return diagnostics.httpAttempts < maxHttpAttempts;
        };

        context.request = async function (params, requestOptions) {
            requestOptions = requestOptions || {};
            var callerCanAttempt = requestOptions.canAttempt;
            var callerOnAttempt = requestOptions.onAttempt;
            var label = requestOptions.label || '';
            diagnostics.lastLabel = label;
            var merged = Object.assign({}, requestOptions, {
                canAttempt: function () {
                    return context.canAttempt() && (typeof callerCanAttempt !== 'function' || callerCanAttempt());
                },
                onAttempt: function (attempt) {
                    diagnostics.httpAttempts += 1;
                    if (attempt > 1) diagnostics.retryCount += 1;
                    if (typeof callerOnAttempt === 'function') callerOnAttempt(attempt);
                }
            });
            try {
                var response = await client.request(params, merged);
                if (response.cacheHit) diagnostics.cacheHits += 1;
                return response;
            } catch (error) {
                diagnostics.failures += 1;
                var normalized = AppErrors ? AppErrors.normalize(error, {
                    code: 'PREDICTION_REQUEST_FAILED',
                    userMessage: '予測APIへの接続に失敗しました。',
                    phase: 'prediction',
                    runId: context.runId,
                    retryable: error && error.retryable === true
                }) : error;
                diagnostics.lastError = AppErrors ? AppErrors.serialize(normalized) : { message: normalized.message };
                throw normalized;
            }
        };

        context.snapshot = function () {
            return {
                runId: context.runId,
                endpointId: context.endpointId,
                resolvedBaseUrl: context.resolvedBaseUrl,
                timeoutMs: context.timeoutMs,
                maxHttpAttempts: Number.isFinite(context.maxHttpAttempts) ? context.maxHttpAttempts : null,
                concurrency: context.concurrency,
                minIntervalMs: context.minIntervalMs,
                cachePolicy: { ttlMs: context.cachePolicy.ttlMs },
                diagnostics: Object.assign({}, context.diagnostics),
                pause: {
                    status: context.pauseController.status,
                    pauseRequested: context.pauseController.pauseRequested
                }
            };
        };

        return context;
    }

    function restore(snapshot, options) {
        snapshot = snapshot || {};
        options = Object.assign({}, options || {}, {
            runId: snapshot.runId,
            source: snapshot.endpointId,
            resolvedBaseUrl: snapshot.resolvedBaseUrl,
            timeoutMs: snapshot.timeoutMs,
            maxHttpAttempts: snapshot.maxHttpAttempts,
            concurrency: snapshot.concurrency,
            minIntervalMs: snapshot.minIntervalMs,
            cacheTtlMs: snapshot.cachePolicy && snapshot.cachePolicy.ttlMs,
            diagnostics: Object.assign({
                httpAttempts: 0,
                cacheHits: 0,
                retryCount: 0,
                failures: 0,
                lastLabel: '',
                lastError: null
            }, snapshot.diagnostics || {})
        });
        return create(options);
    }

    return {
        create: create,
        restore: restore
    };
}));
