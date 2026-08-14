(function (root, factory) {
    var storage = root.AppStorage;
    var runRecord = root.RunRecord;
    if (typeof module === 'object' && module.exports) {
        storage = storage || require('./app-storage.js');
        runRecord = runRecord || require('../domain/run-record.js');
        module.exports = factory(storage, runRecord);
    } else {
        root.RunRepository = factory(storage, runRecord);
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function (AppStorage, RunRecord) {
    'use strict';

    if (!AppStorage || !RunRecord) throw new Error('RunRepository requires AppStorage and RunRecord');

    function Repository(options) {
        options = options || {};
        this.runs = options.runsStore || AppStorage.createStore('runs');
        this.history = options.historyStore || AppStorage.createStore('history');
        this.migrations = options.migrationsStore || AppStorage.createStore('migrations');
        this.historyLimit = Math.max(1, Number(options.historyLimit) || 50);
        this.updateQueues = new Map();
    }

    Repository.prototype.get = function (runId) {
        return this.runs.get(runId);
    };

    Repository.prototype.save = async function (record) {
        RunRecord.assertRecord(record);
        var copy = RunRecord.clone(record);
        copy.updatedAt = copy.updatedAt || new Date().toISOString();
        var previousHistory = await this.history.get(copy.id);
        var historyEntry = RunRecord.createHistoryEntry(copy, previousHistory && previousHistory.pinned === true);
        await this.runs.set(copy.id, copy);
        await this.history.set(copy.id, historyEntry);
        await this.prune();
        return RunRecord.clone(copy);
    };

    Repository.prototype.create = async function (options) {
        var record = RunRecord.create(options);
        return this.save(record);
    };

    Repository.prototype.update = function (runId, patch) {
        var repository = this;
        var previous = repository.updateQueues.get(runId) || Promise.resolve();
        var operation = previous.catch(function () { /* a later boundary may still be persisted */ }).then(async function () {
            var current = await repository.get(runId);
            if (!current) throw new Error('RunRecord not found: ' + runId);
            var nextStatus = patch && patch.status;
            var next;
            if (nextStatus && nextStatus !== current.status) {
                var transitionPatch = Object.assign({}, patch);
                delete transitionPatch.status;
                next = RunRecord.transition(current, nextStatus, transitionPatch);
            } else {
                next = RunRecord.update(current, patch || {});
            }
            return repository.save(next);
        });
        var tracked = operation.finally(function () {
            if (repository.updateQueues.get(runId) === tracked) repository.updateQueues.delete(runId);
        });
        repository.updateQueues.set(runId, tracked);
        return tracked;
    };

    Repository.prototype.saveBoundary = async function (runId, boundary) {
        boundary = boundary || {};
        return this.update(runId, {
            status: boundary.status,
            progress: boundary.progress,
            output: boundary.output,
            provenance: boundary.provenance,
            error: boundary.error,
            updatedAt: boundary.updatedAt
        });
    };

    Repository.prototype.listRuns = async function (filters) {
        filters = filters || {};
        var entries = await this.runs.list();
        return entries.map(function (entry) { return entry.value; }).filter(function (record) {
            if (!record || record.schemaVersion !== RunRecord.schemaVersion) return false;
            if (filters.type && record.type !== filters.type) return false;
            if (filters.status && record.status !== filters.status) return false;
            if (filters.statuses && filters.statuses.indexOf(record.status) === -1) return false;
            return true;
        }).sort(function (a, b) {
            return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
        });
    };

    Repository.prototype.listHistory = async function (filters) {
        filters = filters || {};
        var entries = await this.history.list();
        return entries.map(function (entry) { return entry.value; }).filter(function (item) {
            if (!item || item.schemaVersion !== RunRecord.schemaVersion) return false;
            if (filters.type && item.type !== filters.type) return false;
            if (filters.status && item.status !== filters.status) return false;
            if (filters.statuses && filters.statuses.indexOf(item.status) === -1) return false;
            return true;
        }).sort(function (a, b) {
            if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
            return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
        });
    };

    Repository.prototype.getActive = function (type) {
        return this.listRuns({ type: type, statuses: RunRecord.activeStatuses });
    };

    Repository.prototype.setPinned = async function (runId, pinned) {
        var entry = await this.history.get(runId);
        if (!entry) throw new Error('HistoryEntry not found: ' + runId);
        entry.pinned = pinned === true;
        entry.updatedAt = new Date().toISOString();
        await this.history.set(runId, entry);
        return RunRecord.clone(entry);
    };

    Repository.prototype.remove = async function (runId, options) {
        options = options || {};
        var record = await this.get(runId);
        if (!record) return false;
        if (!options.force && RunRecord.activeStatuses.indexOf(record.status) !== -1) {
            throw new Error('実行中または中断中の履歴は削除できません');
        }
        await this.runs.delete(runId);
        await this.history.delete(runId);
        return true;
    };

    Repository.prototype.prune = async function () {
        var entries = await this.history.list();
        var removable = entries.map(function (entry) { return entry.value; }).filter(function (item) {
            return item && item.pinned !== true && RunRecord.terminalStatuses.indexOf(item.status) !== -1;
        }).sort(function (a, b) {
            return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
        });
        if (removable.length <= this.historyLimit) return 0;
        var overflow = removable.slice(this.historyLimit);
        for (var index = 0; index < overflow.length; index += 1) {
            await this.runs.delete(overflow[index].runId);
            await this.history.delete(overflow[index].runId);
        }
        return overflow.length;
    };

    Repository.prototype.getMigration = function (migrationId) {
        return this.migrations.get(migrationId);
    };

    Repository.prototype.setMigration = function (migrationId, details) {
        return this.migrations.set(migrationId, Object.assign({
            schemaVersion: 1,
            id: migrationId,
            migratedAt: new Date().toISOString()
        }, RunRecord.clone(details || {})));
    };

    function stableLegacyId(prefix, value, index) {
        var text = String(value || index || '0');
        var hash = 2166136261;
        for (var i = 0; i < text.length; i += 1) {
            hash ^= text.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
        }
        return prefix + '_' + (hash >>> 0).toString(16);
    }

    Repository.prototype.migrateLegacyEhime = async function (items) {
        var migrationId = 'legacy:ehime_history_runs_v1';
        var existing = await this.getMigration(migrationId);
        if (existing && existing.completed) return existing;

        var list = Array.isArray(items) ? items : [];
        var imported = 0;
        for (var index = 0; index < list.length; index += 1) {
            var item = list[index] || {};
            var rows = Array.isArray(item.rows) ? item.rows : [];
            var base = item.baseSettings || {};
            var known = Number(item.landCount || 0) + Number(item.waterCount || 0);
            var unknown = Math.max(0, rows.length - known);
            var record = RunRecord.create({
                id: stableLegacyId('legacy_ehime', item.savedAt || item.id, index),
                type: 'ehime_ensemble',
                status: 'completed',
                title: '愛媛13条件 ' + (item.siteName || ''),
                createdAt: item.savedAt || new Date().toISOString(),
                updatedAt: item.savedAt || new Date().toISOString(),
                finishedAt: item.savedAt || new Date().toISOString(),
                input: {
                    launch: {
                        latitude: base.launch_latitude,
                        longitude: base.launch_longitude,
                        altitudeM: base.initial_alt,
                        datetimeUtc: base.launch_datetime,
                        label: item.siteName || base.launch_site_name || ''
                    },
                    flight: {
                        ascentRateMps: base.ascent_rate,
                        descentRateMps: base.descent_rate,
                        burstAltitudeM: base.burst_altitude,
                        profileId: base.profile
                    },
                    api: {
                        endpointId: base.api_source || '',
                        resolvedBaseUrl: base.api_custom_url || ''
                    },
                    feature: { legacySnapshot: true }
                },
                progress: { completedUnits: rows.length, totalUnits: rows.length },
                output: {
                    landings: rows.map(function (row) {
                        return {
                            seriesId: row.label || '',
                            latitude: row.lat,
                            longitude: row.lng,
                            timeUtc: row.landingDatetime || null,
                            landSea: {
                                classification: row.isWater === true ? 'sea' : (row.isWater === false ? 'land' : 'unknown'),
                                confidence: 'unknown',
                                source: 'legacy',
                                coastDistanceKm: null,
                                dataVersion: '',
                                reason: 'migrated-legacy-ehime'
                            }
                        };
                    }),
                    trajectories: rows.map(function (row) {
                        return {
                            id: 'legacy_' + (row.label || row.index || ''),
                            runId: stableLegacyId('legacy_ehime', item.savedAt || item.id, index),
                            variantId: row.label || null,
                            label: row.label || '',
                            color: '',
                            visible: row.label === 'BASE',
                            points: Array.isArray(row.flightPath) ? row.flightPath.map(function (point) {
                                return {
                                    latitude: Array.isArray(point) ? point[0] : null,
                                    longitude: Array.isArray(point) ? point[1] : null,
                                    altitudeM: Array.isArray(point) ? point[2] : null,
                                    timeUtc: null,
                                    horizontalSpeedMps: null,
                                    verticalSpeedMps: null,
                                    phase: null
                                };
                            }) : []
                        };
                    }),
                    metrics: {
                        seaRate: known ? Number(item.waterCount || 0) / known * 100 : null,
                        unknownRate: rows.length ? unknown / rows.length * 100 : null,
                        meanLatitude: item.meanLat,
                        meanLongitude: item.meanLng,
                        maximumDeviationKm: item.maxDev
                    }
                },
                provenance: { legacySource: 'ehime_history_runs_v1' }
            });
            await this.save(record);
            imported += 1;
        }

        var result = { completed: true, imported: imported, sourceCount: list.length };
        await this.setMigration(migrationId, result);
        return result;
    };

    Repository.prototype.clearAll = async function () {
        await this.runs.clear();
        await this.history.clear();
        await this.migrations.clear();
    };

    var defaultRepository = new Repository();
    defaultRepository.Repository = Repository;
    return defaultRepository;
}));
