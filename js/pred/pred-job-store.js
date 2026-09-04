(function (root, factory) {
    var storage = root.AppStorage;
    if (typeof module === 'object' && module.exports) {
        storage = storage || require('../core/app-storage.js');
        module.exports = factory(storage);
    } else {
        root.PredictionJobStore = factory(storage);
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function (AppStorage) {
    'use strict';

    var store = AppStorage.createStore('jobs');

    function JobStore(jobType) {
        this.jobType = jobType;
        this.key = 'active:' + jobType;
    }

    JobStore.prototype.save = async function (snapshot) {
        var payload = Object.assign({}, snapshot, {
            schemaVersion: 1,
            jobType: this.jobType,
            updatedAt: new Date().toISOString()
        });
        await store.set(this.key, payload);
        return payload;
    };

    JobStore.prototype.load = async function () {
        var payload = await store.get(this.key);
        if (!payload || payload.schemaVersion !== 1 || payload.jobType !== this.jobType) return null;
        return payload;
    };

    JobStore.prototype.clear = function () {
        return store.delete(this.key);
    };

    function PauseController() {
        this.status = 'idle';
        this.pauseRequested = false;
    }

    PauseController.prototype.start = function () {
        this.status = 'running';
        this.pauseRequested = false;
    };

    PauseController.prototype.requestPause = function () {
        if (this.status === 'running') {
            this.status = 'pausing';
            this.pauseRequested = true;
        }
    };

    PauseController.prototype.reachBoundary = function () {
        if (!this.pauseRequested) return false;
        this.status = 'paused';
        return true;
    };

    PauseController.prototype.resume = function () {
        this.status = 'running';
        this.pauseRequested = false;
    };

    PauseController.prototype.complete = function () {
        this.status = 'completed';
        this.pauseRequested = false;
    };

    return {
        JobStore: JobStore,
        PauseController: PauseController
    };
}));
