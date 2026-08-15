(function (root, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.AppErrors = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    var MAX_DIAGNOSTIC_LENGTH = 1000;
    var SECRET_QUERY_PATTERN = /([?&](?:api[_-]?key|access[_-]?token|auth(?:orization)?|key|secret|token)=)[^&#\s]*/gi;
    var BEARER_PATTERN = /\b(Bearer\s+)[A-Za-z0-9._~+\/-]+=*/gi;

    function sanitizeMessage(value) {
        var message = String(value === undefined || value === null ? '' : value)
            .replace(SECRET_QUERY_PATTERN, '$1[REDACTED]')
            .replace(BEARER_PATTERN, '$1[REDACTED]');
        if (message.length > MAX_DIAGNOSTIC_LENGTH) {
            return message.slice(0, MAX_DIAGNOSTIC_LENGTH) + '…[truncated]';
        }
        return message;
    }
    function AppError(code, userMessage, details) {
        details = details || {};
        var safeUserMessage = sanitizeMessage(userMessage || '処理に失敗しました。');
        var safeTechnicalMessage = sanitizeMessage(details.technicalMessage || safeUserMessage || code);
        Error.call(this, safeTechnicalMessage);
        this.name = 'AppError';
        this.message = safeTechnicalMessage;
        this.code = code || 'UNEXPECTED_ERROR';
        this.userMessage = safeUserMessage;
        this.technicalMessage = safeTechnicalMessage;
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
        serialize: serialize,
        sanitizeMessage: sanitizeMessage,
        MAX_DIAGNOSTIC_LENGTH: MAX_DIAGNOSTIC_LENGTH
    };
}));
