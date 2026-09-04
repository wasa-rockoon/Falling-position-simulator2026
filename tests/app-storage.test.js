const test = require('node:test');
const assert = require('node:assert/strict');
const AppStorage = require('../js/core/app-storage.js');

test('memory fallback stores cloned values', async () => {
    const store = AppStorage.createStore('settings');
    await store.clear();
    const source = { nested: { value: 3 } };
    await store.set('sample', source);
    source.nested.value = 9;
    assert.deepEqual(await store.get('sample'), { nested: { value: 3 } });
    await store.delete('sample');
    assert.equal(await store.get('sample'), undefined);
});
