const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'vendor-dependencies.json'), 'utf8'));
const readCanonicalText = (relative) => Buffer.from(
    fs.readFileSync(path.join(root, relative), 'utf8').replace(/\r\n/g, '\n'),
    'utf8'
);

test('vendored browser dependencies match the recorded SHA-256 values', () => {
    assert.equal(manifest.schemaVersion, 1);
    assert.equal(manifest.checksumFormat, 'sha256-lf-normalized-text');
    for (const dependency of manifest.dependencies) {
        const bytes = readCanonicalText(dependency.file);
        const actual = crypto.createHash('sha256').update(bytes).digest('hex');
        assert.equal(actual, dependency.sha256, dependency.file);
    }
});

test('every runtime vendor is loaded locally and unused CDN libraries are absent', () => {
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    for (const dependency of manifest.dependencies.filter((item) => item.runtime)) {
        assert.match(html, new RegExp(dependency.file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
    assert.doesNotMatch(html, /@turf|leaflet\.heat|jquery\.form\.js/i);
});
