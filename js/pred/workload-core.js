(function (root, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.PredictionWorkload = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    var PUBLIC_API_RECOMMENDED_ATTEMPTS = 300;

    function nonNegativeInteger(value, fallback) {
        var number = Math.floor(Number(value));
        return Number.isFinite(number) && number >= 0 ? number : (fallback || 0);
    }

    function normalizeDiagnostics(value) {
        value = value || {};
        return {
            httpAttempts: nonNegativeInteger(value.httpAttempts),
            cacheHits: nonNegativeInteger(value.cacheHits),
            retryCount: nonNegativeInteger(value.retryCount),
            failures: nonNegativeInteger(value.failures),
            lastLabel: String(value.lastLabel || ''),
            lastError: value.lastError || null
        };
    }

    function estimateAttempts(logicalCalls, maxRetries, expectedCacheHits) {
        var logical = nonNegativeInteger(logicalCalls);
        var retries = nonNegativeInteger(maxRetries);
        var cacheHits = Math.min(logical, nonNegativeInteger(expectedCacheHits));
        var networkRequests = logical - cacheHits;
        return {
            logicalCalls: logical,
            expectedCacheHits: cacheHits,
            networkRequests: networkRequests,
            expectedHttpAttempts: networkRequests,
            worstCaseHttpAttempts: networkRequests * (retries + 1)
        };
    }

    function apiAdvice(source, requestedAttempts) {
        var requested = nonNegativeInteger(requestedAttempts);
        var isPublic = source === 'sondehub';
        return {
            source: source || 'sondehub',
            requestedAttempts: requested,
            recommendedAttempts: PUBLIC_API_RECOMMENDED_ATTEMPTS,
            isPublic: isPublic,
            aboveRecommended: isPublic && requested > PUBLIC_API_RECOMMENDED_ATTEMPTS
        };
    }

    function defaultRunnable(run) {
        if (!run) return false;
        if (run.status === 'completed' || run.status === 'error') return false;
        return nonNegativeInteger(run.cursor) < nonNegativeInteger(run.cap);
    }

    function nextRunnableIndex(runs, startIndex, predicate) {
        if (!Array.isArray(runs) || !runs.length) return -1;
        var runnable = typeof predicate === 'function' ? predicate : defaultRunnable;
        var start = nonNegativeInteger(startIndex) % runs.length;
        for (var offset = 0; offset < runs.length; offset += 1) {
            var index = (start + offset) % runs.length;
            if (runnable(runs[index], index)) return index;
        }
        return -1;
    }

    function isAttemptBudgetExhausted(diagnostics, limit) {
        return normalizeDiagnostics(diagnostics).httpAttempts >= Math.max(0, nonNegativeInteger(limit));
    }

    return {
        PUBLIC_API_RECOMMENDED_ATTEMPTS: PUBLIC_API_RECOMMENDED_ATTEMPTS,
        normalizeDiagnostics: normalizeDiagnostics,
        estimateAttempts: estimateAttempts,
        apiAdvice: apiAdvice,
        nextRunnableIndex: nextRunnableIndex,
        isAttemptBudgetExhausted: isAttemptBudgetExhausted
    };
}));
