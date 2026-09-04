(function (root) {
    'use strict';

    var handlers = new Map();

    function register(id, clearHandler) {
        if (!id || typeof clearHandler !== 'function') throw new TypeError('display id and clear handler are required');
        handlers.set(String(id), clearHandler);
    }

    function unregister(id) {
        handlers.delete(String(id));
    }

    function clearAll(options) {
        options = options || {};
        handlers.forEach(function (handler, id) {
            try {
                handler({ source: 'all' });
            } catch (error) {
                if (typeof root.reportNonFatalError === 'function') root.reportNonFatalError(error, 'map-display.clear.' + id);
            }
        });
        if (root.dispatchEvent && typeof root.CustomEvent === 'function') root.dispatchEvent(new root.CustomEvent('wasa:map-display-cleared'));
        if (!options.silent && typeof root.showToast === 'function') {
            root.showToast('地図上の結果をすべて消しました（履歴・表・グラフ・設定は保持）', 'info', 3500);
        }
    }

    root.MapDisplayController = { register: register, unregister: unregister, clearAll: clearAll };
}(typeof globalThis !== 'undefined' ? globalThis : this));