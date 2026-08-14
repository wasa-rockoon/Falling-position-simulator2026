(function (root, factory) {
    var api = factory(root);
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.AppStorage = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
    'use strict';

    var DATABASE_NAME = 'falling-position-simulator-2026';
    var DATABASE_VERSION = 1;
    var STORE_NAMES = ['predictionCache', 'jobs', 'settings'];
    var memoryStores = {};
    var databasePromise = null;

    function clone(value) {
        if (value === undefined) return undefined;
        if (typeof root.structuredClone === 'function') {
            try { return root.structuredClone(value); } catch (_error) { if (typeof reportNonFatalError === 'function') reportNonFatalError(_error, 'non-fatal fallback'); }
        }
        return JSON.parse(JSON.stringify(value));
    }

    function getMemoryStore(name) {
        if (!memoryStores[name]) memoryStores[name] = new Map();
        return memoryStores[name];
    }

    function openDatabase() {
        if (!root.indexedDB) return Promise.resolve(null);
        if (databasePromise) return databasePromise;
        databasePromise = new Promise(function (resolve) {
            var request;
            try {
                request = root.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
            } catch (_error) {
                resolve(null);
                return;
            }
            request.onupgradeneeded = function () {
                STORE_NAMES.forEach(function (name) {
                    if (!request.result.objectStoreNames.contains(name)) {
                        request.result.createObjectStore(name);
                    }
                });
            };
            request.onsuccess = function () { resolve(request.result); };
            request.onerror = function () { resolve(null); };
            request.onblocked = function () { resolve(null); };
        });
        return databasePromise;
    }

    function localStorageKey(storeName, key) {
        return DATABASE_NAME + ':' + storeName + ':' + key;
    }

    function createStore(storeName) {
        if (STORE_NAMES.indexOf(storeName) === -1) {
            throw new Error('Unknown storage area: ' + storeName);
        }

        async function withStore(mode, operation) {
            var database = await openDatabase();
            if (!database) return { supported: false };
            return new Promise(function (resolve, reject) {
                try {
                    var transaction = database.transaction(storeName, mode);
                    var store = transaction.objectStore(storeName);
                    operation(store, resolve, reject);
                    transaction.onerror = function () { reject(transaction.error); };
                } catch (error) {
                    reject(error);
                }
            });
        }

        return {
            async get(key) {
                try {
                    var idbResult = await withStore('readonly', function (store, resolve, reject) {
                        var request = store.get(key);
                        request.onsuccess = function () { resolve({ supported: true, value: request.result }); };
                        request.onerror = function () { reject(request.error); };
                    });
                    if (idbResult.supported) return clone(idbResult.value);
                } catch (_error) { if (typeof reportNonFatalError === 'function') reportNonFatalError(_error, 'non-fatal fallback'); }

                try {
                    if (root.localStorage) {
                        var raw = root.localStorage.getItem(localStorageKey(storeName, key));
                        if (raw !== null) return JSON.parse(raw);
                    }
                } catch (_error2) { if (typeof reportNonFatalError === 'function') reportNonFatalError(_error2, 'non-fatal fallback'); }
                return clone(getMemoryStore(storeName).get(key));
            },

            async set(key, value) {
                var copied = clone(value);
                try {
                    var result = await withStore('readwrite', function (store, resolve, reject) {
                        var request = store.put(copied, key);
                        request.onsuccess = function () { resolve({ supported: true }); };
                        request.onerror = function () { reject(request.error); };
                    });
                    if (result.supported) return;
                } catch (_error) { if (typeof reportNonFatalError === 'function') reportNonFatalError(_error, 'non-fatal fallback'); }

                try {
                    if (root.localStorage) {
                        root.localStorage.setItem(localStorageKey(storeName, key), JSON.stringify(copied));
                        return;
                    }
                } catch (_error2) { if (typeof reportNonFatalError === 'function') reportNonFatalError(_error2, 'non-fatal fallback'); }
                getMemoryStore(storeName).set(key, copied);
            },

            async delete(key) {
                try {
                    var result = await withStore('readwrite', function (store, resolve, reject) {
                        var request = store.delete(key);
                        request.onsuccess = function () { resolve({ supported: true }); };
                        request.onerror = function () { reject(request.error); };
                    });
                    if (result.supported) return;
                } catch (_error) { if (typeof reportNonFatalError === 'function') reportNonFatalError(_error, 'non-fatal fallback'); }
                try {
                    if (root.localStorage) root.localStorage.removeItem(localStorageKey(storeName, key));
                } catch (_error2) { if (typeof reportNonFatalError === 'function') reportNonFatalError(_error2, 'non-fatal fallback'); }
                getMemoryStore(storeName).delete(key);
            },

            async clear() {
                try {
                    var result = await withStore('readwrite', function (store, resolve, reject) {
                        var request = store.clear();
                        request.onsuccess = function () { resolve({ supported: true }); };
                        request.onerror = function () { reject(request.error); };
                    });
                    if (result.supported) return;
                } catch (_error) { if (typeof reportNonFatalError === 'function') reportNonFatalError(_error, 'non-fatal fallback'); }
                try {
                    if (root.localStorage) {
                        var prefix = localStorageKey(storeName, '');
                        var keys = [];
                        for (var index = 0; index < root.localStorage.length; index += 1) {
                            var key = root.localStorage.key(index);
                            if (key && key.indexOf(prefix) === 0) keys.push(key);
                        }
                        keys.forEach(function (key) { root.localStorage.removeItem(key); });
                    }
                } catch (_error2) { if (typeof reportNonFatalError === 'function') reportNonFatalError(_error2, 'non-fatal fallback'); }
                getMemoryStore(storeName).clear();
            }
        };
    }

    return {
        createStore: createStore,
        databaseName: DATABASE_NAME
    };
}));
