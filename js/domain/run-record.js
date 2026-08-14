(function (root, factory) {
    var api = factory(root);
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.RunRecord = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
    'use strict';

    var SCHEMA_VERSION = 1;
    var TYPES = ['single', 'ehime_ensemble', 'auto_search', 'uncertainty'];
    var STATUSES = ['draft', 'running', 'pause_requested', 'paused', 'completed', 'partial', 'failed', 'cancelled'];
    var TERMINAL_STATUSES = ['completed', 'partial', 'failed', 'cancelled'];
    var ACTIVE_STATUSES = ['running', 'pause_requested', 'paused'];
    var TRANSITIONS = {
        draft: ['running', 'cancelled'],
        running: ['pause_requested', 'paused', 'completed', 'partial', 'failed', 'cancelled'],
        pause_requested: ['paused', 'running', 'partial', 'failed', 'cancelled'],
        paused: ['running', 'partial', 'failed', 'cancelled'],
        completed: [],
        partial: [],
        failed: [],
        cancelled: []
    };

    function clone(value) {
        if (value === undefined) return undefined;
        if (typeof root.structuredClone === 'function') {
            try { return root.structuredClone(value); } catch (_error) { /* JSON fallback */ }
        }
        return JSON.parse(JSON.stringify(value));
    }

    function finite(value) {
        var number = Number(value);
        return Number.isFinite(number) ? number : null;
    }

    function nowIso() {
        return new Date().toISOString();
    }

    function makeId(prefix) {
        if (root.crypto && typeof root.crypto.randomUUID === 'function') {
            return (prefix || 'run') + '_' + root.crypto.randomUUID();
        }
        return (prefix || 'run') + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
    }

    function normalizeType(type) {
        if (TYPES.indexOf(type) === -1) throw new Error('Unsupported run type: ' + type);
        return type;
    }

    function normalizeStatus(status) {
        if (STATUSES.indexOf(status) === -1) throw new Error('Unsupported run status: ' + status);
        return status;
    }

    function normalizeLaunch(launch) {
        launch = launch || {};
        return {
            latitude: finite(launch.latitude),
            longitude: finite(launch.longitude),
            altitudeM: finite(launch.altitudeM),
            datetimeUtc: launch.datetimeUtc || null,
            label: launch.label || ''
        };
    }

    function normalizeFlight(flight) {
        flight = flight || {};
        return {
            ascentRateMps: finite(flight.ascentRateMps),
            descentRateMps: finite(flight.descentRateMps),
            burstAltitudeM: finite(flight.burstAltitudeM),
            floatAltitudeM: finite(flight.floatAltitudeM),
            profileId: flight.profileId || 'standard_profile'
        };
    }

    function normalizeApi(api) {
        api = api || {};
        return {
            endpointId: api.endpointId || 'sondehub',
            resolvedBaseUrl: api.resolvedBaseUrl || '',
            timeoutMs: finite(api.timeoutMs),
            maxHttpAttempts: finite(api.maxHttpAttempts),
            concurrency: finite(api.concurrency),
            minIntervalMs: finite(api.minIntervalMs)
        };
    }

    function normalizeError(error, defaults) {
        defaults = defaults || {};
        if (!error) return null;
        var source = error instanceof Error ? error : (typeof error === 'object' ? error : { message: String(error) });
        return {
            code: source.code || defaults.code || 'UNEXPECTED_ERROR',
            userMessage: source.userMessage || defaults.userMessage || source.message || '処理に失敗しました。',
            technicalMessage: source.technicalMessage || source.message || String(error),
            retryable: source.retryable === true || defaults.retryable === true,
            phase: source.phase || defaults.phase || 'unknown',
            runId: source.runId || defaults.runId || '',
            timestamp: source.timestamp || nowIso(),
            httpStatus: finite(source.httpStatus || source.status)
        };
    }

    function create(options) {
        options = options || {};
        var createdAt = options.createdAt || nowIso();
        var status = normalizeStatus(options.status || 'draft');
        var record = {
            schemaVersion: SCHEMA_VERSION,
            id: options.id || makeId('run'),
            sourceRunId: options.sourceRunId || null,
            type: normalizeType(options.type || 'single'),
            status: status,
            title: options.title || '',
            createdAt: createdAt,
            updatedAt: options.updatedAt || createdAt,
            startedAt: options.startedAt || (status === 'running' ? createdAt : null),
            finishedAt: options.finishedAt || (TERMINAL_STATUSES.indexOf(status) !== -1 ? createdAt : null),
            input: {
                launch: normalizeLaunch(options.input && options.input.launch),
                flight: normalizeFlight(options.input && options.input.flight),
                api: normalizeApi(options.input && options.input.api),
                feature: clone(options.input && options.input.feature || {})
            },
            progress: Object.assign({
                completedUnits: 0,
                totalUnits: 0,
                currentLabel: '',
                httpAttempts: 0,
                cacheHits: 0,
                retryCount: 0,
                requestedAction: 'none'
            }, clone(options.progress || {})),
            output: Object.assign({
                trajectories: [],
                landings: [],
                metrics: {},
                candidates: [],
                warnings: []
            }, clone(options.output || {})),
            provenance: Object.assign({
                appCommit: '',
                predictorSource: '',
                landSeaClassifierVersion: '',
                randomSeed: null
            }, clone(options.provenance || {})),
            error: normalizeError(options.error, { runId: options.id || '' })
        };
        record.error = record.error ? Object.assign(record.error, { runId: record.id }) : null;
        return record;
    }

    function assertRecord(record) {
        if (!record || record.schemaVersion !== SCHEMA_VERSION) throw new Error('RunRecord schemaVersion must be ' + SCHEMA_VERSION);
        if (!record.id) throw new Error('RunRecord id is required');
        normalizeType(record.type);
        normalizeStatus(record.status);
        return record;
    }

    function canTransition(fromStatus, toStatus) {
        normalizeStatus(fromStatus);
        normalizeStatus(toStatus);
        return fromStatus === toStatus || TRANSITIONS[fromStatus].indexOf(toStatus) !== -1;
    }

    function transition(record, nextStatus, patch) {
        assertRecord(record);
        normalizeStatus(nextStatus);
        if (!canTransition(record.status, nextStatus)) {
            throw new Error('Invalid RunRecord transition: ' + record.status + ' -> ' + nextStatus);
        }
        var next = clone(record);
        var timestamp = patch && patch.updatedAt || nowIso();
        next.status = nextStatus;
        next.updatedAt = timestamp;
        if (nextStatus === 'running' && !next.startedAt) next.startedAt = timestamp;
        if (TERMINAL_STATUSES.indexOf(nextStatus) !== -1) next.finishedAt = timestamp;
        if (patch) {
            if (patch.title !== undefined) next.title = patch.title;
            if (patch.progress) next.progress = Object.assign({}, next.progress, clone(patch.progress));
            if (patch.output) next.output = Object.assign({}, next.output, clone(patch.output));
            if (patch.provenance) next.provenance = Object.assign({}, next.provenance, clone(patch.provenance));
            if (patch.error !== undefined) next.error = normalizeError(patch.error, { runId: next.id });
        }
        return next;
    }

    function update(record, patch) {
        assertRecord(record);
        patch = patch || {};
        var next = clone(record);
        next.updatedAt = patch.updatedAt || nowIso();
        if (patch.title !== undefined) next.title = patch.title;
        if (patch.input) {
            next.input = Object.assign({}, next.input, clone(patch.input));
            if (patch.input.launch) next.input.launch = Object.assign({}, record.input.launch, normalizeLaunch(patch.input.launch));
            if (patch.input.flight) next.input.flight = Object.assign({}, record.input.flight, normalizeFlight(patch.input.flight));
            if (patch.input.api) next.input.api = Object.assign({}, record.input.api, normalizeApi(patch.input.api));
        }
        if (patch.progress) next.progress = Object.assign({}, next.progress, clone(patch.progress));
        if (patch.output) next.output = Object.assign({}, next.output, clone(patch.output));
        if (patch.provenance) next.provenance = Object.assign({}, next.provenance, clone(patch.provenance));
        if (patch.error !== undefined) next.error = normalizeError(patch.error, { runId: next.id });
        return next;
    }

    function createHistoryEntry(record, pinned) {
        assertRecord(record);
        var landings = Array.isArray(record.output && record.output.landings) ? record.output.landings : [];
        var metrics = record.output && record.output.metrics || {};
        return {
            schemaVersion: SCHEMA_VERSION,
            runId: record.id,
            type: record.type,
            status: record.status,
            title: record.title || '',
            launchDatetimeUtc: record.input && record.input.launch ? record.input.launch.datetimeUtc : null,
            launchPointLabel: record.input && record.input.launch ? record.input.launch.label || '' : '',
            updatedAt: record.updatedAt,
            pinned: pinned === true,
            summary: {
                landingCount: landings.length,
                seaRate: finite(metrics.seaRate),
                unknownRate: finite(metrics.unknownRate),
                nearestSupportDistanceKm: finite(metrics.nearestSupportDistanceKm)
            }
        };
    }

    return {
        schemaVersion: SCHEMA_VERSION,
        types: TYPES.slice(),
        statuses: STATUSES.slice(),
        terminalStatuses: TERMINAL_STATUSES.slice(),
        activeStatuses: ACTIVE_STATUSES.slice(),
        create: create,
        update: update,
        transition: transition,
        canTransition: canTransition,
        assertRecord: assertRecord,
        createHistoryEntry: createHistoryEntry,
        normalizeError: normalizeError,
        makeId: makeId,
        clone: clone
    };
}));
