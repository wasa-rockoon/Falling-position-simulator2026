const test = require('node:test');
const assert = require('node:assert/strict');

function localStorageMock() {
    const data = new Map();
    return {
        get length() { return data.size; },
        key(index) { return Array.from(data.keys())[index] || null; },
        getItem(key) { return data.has(key) ? data.get(key) : null; },
        setItem(key, value) { data.set(key, String(value)); },
        removeItem(key) { data.delete(key); }
    };
}

test('SettingsRepository preserves legacy localStorage keys and clones values', () => {
    const previous = global.localStorage;
    global.localStorage = localStorageMock();
    delete require.cache[require.resolve('../js/core/settings-repository.js')];
    const repository = require('../js/core/settings-repository.js');

    const settings = { lat: '33.1' };
    repository.saveLastSettings(settings);
    settings.lat = '0';
    assert.deepEqual(repository.getLastSettings(), { lat: '33.1' });
    assert.equal(global.localStorage.getItem('predictor_last_settings'), '{"lat":"33.1"}');

    repository.savePresets([{ name: 'test', values: { ascent: '5' } }]);
    assert.equal(repository.getPresets()[0].name, 'test');
    global.localStorage = previous;
});
