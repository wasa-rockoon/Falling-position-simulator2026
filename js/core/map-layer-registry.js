(function (root, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.MapLayerRegistry = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    function Registry(map) {
        this.map = map || null;
        this.entries = new Map();
    }

    Registry.prototype.register = function (id, layer, options) {
        if (!id || !layer) throw new Error('layer id and layer are required');
        options = options || {};
        this.remove(id);
        var entry = { id: id, layer: layer, group: options.group || 'prediction', visible: false };
        this.entries.set(id, entry);
        this.setVisible(id, options.visible !== false);
        return layer;
    };

    Registry.prototype.get = function (id) {
        var entry = this.entries.get(id);
        return entry && entry.layer || null;
    };

    Registry.prototype.isVisible = function (id) {
        var entry = this.entries.get(id);
        return Boolean(entry && entry.visible);
    };

    Registry.prototype.setVisible = function (id, visible) {
        var entry = this.entries.get(id);
        if (!entry) return false;
        var map = this.map;
        if (visible && map && typeof entry.layer.addTo === 'function') entry.layer.addTo(map);
        if (!visible && typeof entry.layer.remove === 'function') entry.layer.remove();
        entry.visible = visible === true;
        return true;
    };

    Registry.prototype.remove = function (id) {
        var entry = this.entries.get(id);
        if (!entry) return false;
        if (entry.layer && typeof entry.layer.remove === 'function') entry.layer.remove();
        this.entries.delete(id);
        return true;
    };

    Registry.prototype.clearGroup = function (group) {
        var registry = this;
        Array.from(this.entries.values()).forEach(function (entry) {
            if (entry.group === group) registry.remove(entry.id);
        });
    };

    Registry.prototype.clear = function () {
        var registry = this;
        Array.from(this.entries.keys()).forEach(function (id) { registry.remove(id); });
    };

    return { Registry: Registry };
}));
