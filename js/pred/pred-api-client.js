(function (root, factory) {
    var storage = root.AppStorage;
    if (typeof module === 'object' && module.exports) {
        storage = storage || require('../core/app-storage.js');
        module.exports = factory(root, storage);
    } else {
        root.PredictionApi = factory(root, storage);
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function (root, AppStorage) {
    'use strict';

    var SONDEHUB_URL = 'https://api.v2.sondehub.org/tawhiri';
    var DEFAULT_POLICIES = {
        sondehub: { concurrency: 1, minIntervalMs: 900, timeoutMs: 45000, maxRetries: 2 },
        local: { concurrency: 2, minIntervalMs: 100, timeoutMs: 60000, maxRetries: 2 },
        custom: { concurrency: 1, minIntervalMs: 500, timeoutMs: 45000, maxRetries: 2 }
    };
    var sharedClients = new Map();
    var cacheStore = AppStorage ? AppStorage.createStore('predictionCache') : null;

    function resolveApiUrl(source, customUrl) {
        if (source === 'local') return '/api/v1/';
        if (source === 'custom') {
            var normalized = String(customUrl || '').trim();
            if (!normalized) throw new Error('カスタムAPI URLを入力してください。');
            return normalized;
        }
        return SONDEHUB_URL;
    }

    function normalizeSource(source) {
        return DEFAULT_POLICIES[source] ? source : 'sondehub';
    }

    function stableEntries(params) {
        return Object.keys(params || {}).sort().map(function (key) {
            var value = params[key];
            if (value === undefined || value === null) value = '';
            return [key, String(value)];
        });
    }

    function buildRequestUrl(baseUrl, params, baseLocation) {
        var fallbackLocation = baseLocation || (root.location && root.location.href) || 'http://localhost/';
        var url = new URL(baseUrl, fallbackLocation);
        stableEntries(params).forEach(function (entry) {
            url.searchParams.set(entry[0], entry[1]);
        });
        return url.toString();
    }

    function cacheKey(baseUrl, params, baseLocation) {
        return buildRequestUrl(baseUrl, params, baseLocation);
    }

    function abortError(message) {
        var error = new Error(message || '処理を中断しました');
        error.name = 'AbortError';
        return error;
    }

    function wait(milliseconds, signal) {
        return new Promise(function (resolve, reject) {
            if (signal && signal.aborted) {
                reject(abortError());
                return;
            }
            var timer = root.setTimeout(resolve, Math.max(0, milliseconds));
            if (signal) {
                signal.addEventListener('abort', function onAbort() {
                    root.clearTimeout(timer);
                    reject(abortError());
                }, { once: true });
            }
        });
    }

    function RequestQueue(options) {
        options = options || {};
        this.concurrency = Math.max(1, Number(options.concurrency) || 1);
        this.minIntervalMs = Math.max(0, Number(options.minIntervalMs) || 0);
        this.pending = [];
        this.active = 0;
        this.paused = false;
        this.pauseAfterActive = false;
        this.lastStartedAt = 0;
        this.timer = null;
        this.onStateChange = typeof options.onStateChange === 'function' ? options.onStateChange : function () { };
    }

    RequestQueue.prototype.snapshot = function () {
        return {
            active: this.active,
            pending: this.pending.length,
            paused: this.paused,
            pauseAfterActive: this.pauseAfterActive,
            concurrency: this.concurrency
        };
    };

    RequestQueue.prototype._notify = function () {
        this.onStateChange(this.snapshot());
    };

    RequestQueue.prototype.add = function (task, options) {
        var queue = this;
        options = options || {};
        return new Promise(function (resolve, reject) {
            if (options.signal && options.signal.aborted) {
                reject(abortError());
                return;
            }
            queue.pending.push({ task: task, resolve: resolve, reject: reject, signal: options.signal, label: options.label || '' });
            queue._notify();
            queue._drain();
        });
    };

    RequestQueue.prototype._drain = function () {
        var queue = this;
        if (queue.paused || queue.pauseAfterActive || queue.active >= queue.concurrency || queue.pending.length === 0) {
            if (queue.pauseAfterActive && queue.active === 0) {
                queue.pauseAfterActive = false;
                queue.paused = true;
                queue._notify();
            }
            return;
        }

        var delay = Math.max(0, queue.minIntervalMs - (Date.now() - queue.lastStartedAt));
        if (delay > 0) {
            if (!queue.timer) {
                queue.timer = root.setTimeout(function () {
                    queue.timer = null;
                    queue._drain();
                }, delay);
            }
            return;
        }

        var entry = queue.pending.shift();
        if (entry.signal && entry.signal.aborted) {
            entry.reject(abortError());
            queue._notify();
            queue._drain();
            return;
        }
        queue.active += 1;
        queue.lastStartedAt = Date.now();
        queue._notify();

        Promise.resolve().then(entry.task).then(entry.resolve, entry.reject).finally(function () {
            queue.active -= 1;
            queue._notify();
            queue._drain();
        });
        queue._drain();
    };

    RequestQueue.prototype.pause = function () {
        this.paused = true;
        this.pauseAfterActive = false;
        this._notify();
    };

    RequestQueue.prototype.stopAfterCurrent = function () {
        if (this.active === 0) {
            this.pause();
            return;
        }
        this.pauseAfterActive = true;
        this._notify();
    };

    RequestQueue.prototype.resume = function () {
        this.paused = false;
        this.pauseAfterActive = false;
        this._notify();
        this._drain();
    };

    RequestQueue.prototype.cancelPending = function (message) {
        var error = abortError(message || '待機中のAPI呼び出しを取り消しました');
        this.pending.splice(0).forEach(function (entry) { entry.reject(error); });
        this._notify();
    };

    function PredictionRequestError(message, details) {
        Error.call(this, message);
        this.name = 'PredictionRequestError';
        this.message = message;
        Object.assign(this, details || {});
        if (Error.captureStackTrace) Error.captureStackTrace(this, PredictionRequestError);
    }
    PredictionRequestError.prototype = Object.create(Error.prototype);
    PredictionRequestError.prototype.constructor = PredictionRequestError;

    function parseRetryAfter(response) {
        var value = response && response.headers && response.headers.get ? response.headers.get('Retry-After') : null;
        if (!value) return 0;
        var seconds = Number(value);
        if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
        var timestamp = Date.parse(value);
        return Number.isFinite(timestamp) ? Math.max(0, timestamp - Date.now()) : 0;
    }

    function PredictionClient(options) {
        options = options || {};
        this.source = normalizeSource(options.source);
        this.baseUrl = options.baseUrl || resolveApiUrl(this.source, options.customUrl);
        this.baseLocation = options.baseLocation;
        this.fetchImpl = options.fetchImpl || (typeof root.fetch === 'function' ? root.fetch.bind(root) : null);
        if (typeof this.fetchImpl !== 'function') throw new Error('Fetch APIを利用できません');
        var policy = Object.assign({}, DEFAULT_POLICIES[this.source], options.policy || {});
        this.timeoutMs = policy.timeoutMs;
        this.maxRetries = policy.maxRetries;
        this.cacheTtlMs = Number(options.cacheTtlMs) || (3 * 60 * 60 * 1000);
        this.memoryCache = new Map();
        this.inFlight = new Map();
        this.queue = new RequestQueue({
            concurrency: policy.concurrency,
            minIntervalMs: policy.minIntervalMs,
            onStateChange: options.onQueueStateChange
        });
    }

    PredictionClient.prototype._getCached = async function (key) {
        var cached = this.memoryCache.get(key);
        if (!cached && cacheStore) cached = await cacheStore.get(key);
        if (!cached) return null;
        if (cached.expiresAt <= Date.now()) {
            this.memoryCache.delete(key);
            if (cacheStore) await cacheStore.delete(key);
            return null;
        }
        this.memoryCache.set(key, cached);
        return cached.data;
    };

    PredictionClient.prototype._setCached = async function (key, data) {
        var cached = { data: data, expiresAt: Date.now() + this.cacheTtlMs };
        this.memoryCache.set(key, cached);
        if (cacheStore) await cacheStore.set(key, cached);
    };

    PredictionClient.prototype._fetchOnce = async function (url, externalSignal) {
        var controller = typeof root.AbortController === 'function' ? new root.AbortController() : null;
        var timer = null;
        var onExternalAbort = null;
        if (controller) {
            timer = root.setTimeout(function () { controller.abort(); }, this.timeoutMs);
            if (externalSignal) {
                onExternalAbort = function () { controller.abort(); };
                externalSignal.addEventListener('abort', onExternalAbort, { once: true });
            }
        }
        try {
            var response = await this.fetchImpl(url, {
                method: 'GET',
                headers: { Accept: 'application/json' },
                signal: controller ? controller.signal : externalSignal
            });
            if (!response.ok) {
                throw new PredictionRequestError('予測APIがHTTP ' + response.status + 'を返しました', {
                    status: response.status,
                    retryAfterMs: parseRetryAfter(response),
                    retryable: response.status === 429 || response.status >= 500
                });
            }
            var data = await response.json();
            if (data && data.error) {
                var description = data.error.description || data.error.message || '予測APIエラー';
                throw new PredictionRequestError(description, { status: 200, retryable: false, response: data });
            }
            return data;
        } catch (error) {
            if (externalSignal && externalSignal.aborted) throw abortError();
            if (error && error.name === 'AbortError') {
                throw new PredictionRequestError('予測APIがタイムアウトしました', { retryable: true, timeout: true });
            }
            throw error;
        } finally {
            if (timer) root.clearTimeout(timer);
            if (externalSignal && onExternalAbort) externalSignal.removeEventListener('abort', onExternalAbort);
        }
    };

    PredictionClient.prototype._requestWithRetry = async function (url, signal, options) {
        options = options || {};
        var retryLimit = options.maxRetries == null ? this.maxRetries : Math.max(0, Math.floor(Number(options.maxRetries) || 0));
        var lastError;
        for (var attempt = 0; attempt <= retryLimit; attempt += 1) {
            try {
                if (typeof options.canAttempt === 'function' && !options.canAttempt()) {
                    throw new PredictionRequestError('API呼び出し上限に達しました', { retryable: false, callLimit: true });
                }
                if (typeof options.onAttempt === 'function') options.onAttempt(attempt + 1);
                return await this._fetchOnce(url, signal);
            } catch (error) {
                lastError = error;
                if (signal && signal.aborted) throw abortError();
                if (!error.retryable || attempt >= retryLimit) throw error;
                var backoff = Math.max(error.retryAfterMs || 0, (750 * Math.pow(2, attempt)) + Math.floor(Math.random() * 250));
                await wait(backoff, signal);
            }
        }
        throw lastError;
    };

    PredictionClient.prototype.request = async function (params, options) {
        options = options || {};
        var client = this;
        var url = buildRequestUrl(client.baseUrl, params, client.baseLocation);
        var key = cacheKey(client.baseUrl, params, client.baseLocation);
        if (options.cache !== false && !options.forceRefresh) {
            var cached = await client._getCached(key);
            if (cached) return { data: cached, cacheHit: true, url: url };
        }
        if (client.inFlight.has(key)) return client.inFlight.get(key);
        var pendingRequest = client.queue.add(async function () {
            var data = await client._requestWithRetry(url, options.signal, options);
            if (options.cache !== false) await client._setCached(key, data);
            return { data: data, cacheHit: false, url: url };
        }, { signal: options.signal, label: options.label });
        client.inFlight.set(key, pendingRequest);
        try {
            return await pendingRequest;
        } finally {
            if (client.inFlight.get(key) === pendingRequest) client.inFlight.delete(key);
        }
    };

    PredictionClient.prototype.pauseAfterCurrent = function () { this.queue.stopAfterCurrent(); };
    PredictionClient.prototype.resume = function () { this.queue.resume(); };
    PredictionClient.prototype.cancelPending = function (message) { this.queue.cancelPending(message); };
    PredictionClient.prototype.queueSnapshot = function () { return this.queue.snapshot(); };

    function getClient(options) {
        options = options || {};
        var source = normalizeSource(options.source);
        var baseUrl = options.baseUrl || resolveApiUrl(source, options.customUrl);
        var key = source + '|' + baseUrl;
        if (!sharedClients.has(key)) {
            sharedClients.set(key, new PredictionClient(Object.assign({}, options, { source: source, baseUrl: baseUrl })));
        }
        return sharedClients.get(key);
    }

    async function clearCache() {
        sharedClients.forEach(function (client) { client.memoryCache.clear(); });
        if (cacheStore) await cacheStore.clear();
    }

    return {
        SONDEHUB_URL: SONDEHUB_URL,
        policies: DEFAULT_POLICIES,
        resolveApiUrl: resolveApiUrl,
        buildRequestUrl: buildRequestUrl,
        cacheKey: cacheKey,
        RequestQueue: RequestQueue,
        PredictionClient: PredictionClient,
        PredictionRequestError: PredictionRequestError,
        getClient: getClient,
        clearCache: clearCache
    };
}));
