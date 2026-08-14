(function (root, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.AppErrors = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    function AppError(code, userMessage, details) {
        details = details || {};
        Error.call(this, details.technicalMessage || userMessage || code);
        this.name = 'AppError';
        this.code = code || 'UNEXPECTED_ERROR';
        this.userMessage = userMessage || '処理に失敗しました。';
        this.technicalMessage = details.technicalMessage || this.message;
        this.retryable = details.retryable === true;
        this.phase = details.phase || 'unknown';
        this.runId = details.runId || '';
        this.timestamp = details.timestamp || new Date().toISOString();
        this.httpStatus = Number.isFinite(Number(details.httpStatus)) ? Number(details.httpStatus) : null;
        this.cause = details.cause || null;
        if (Error.captureStackTrace) Error.captureStackTrace(this, AppError);
    }
    AppError.prototype = Object.create(Error.prototype);
    AppError.prototype.constructor = AppError;

    function create(code, userMessage, details) {
        return new AppError(code, userMessage, details);
    }

    function normalize(error, defaults) {
        defaults = defaults || {};
        if (error instanceof AppError) {
            if (!error.runId && defaults.runId) error.runId = defaults.runId;
            if (error.phase === 'unknown' && defaults.phase) error.phase = defaults.phase;
            return error;
        }
        var message = error && error.message ? error.message : String(error || defaults.userMessage || '処理に失敗しました。');
        return new AppError(
            error && error.code || defaults.code || 'UNEXPECTED_ERROR',
            error && error.userMessage || defaults.userMessage || message,
            {
                technicalMessage: error && error.technicalMessage || message,
                retryable: error && error.retryable === true || defaults.retryable === true,
                phase: error && error.phase || defaults.phase,
                runId: error && error.runId || defaults.runId,
                httpStatus: error && (error.httpStatus || error.status),
                cause: error || null
            }
        );
    }

    function serialize(error) {
        var normalized = normalize(error);
        return {
            code: normalized.code,
            userMessage: normalized.userMessage,
            technicalMessage: normalized.technicalMessage,
            retryable: normalized.retryable,
            phase: normalized.phase,
            runId: normalized.runId,
            timestamp: normalized.timestamp,
            httpStatus: normalized.httpStatus
        };
    }

    return {
        AppError: AppError,
        create: create,
        normalize: normalize,
        serialize: serialize
    };
}));
