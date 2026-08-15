const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const serviceWorker = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

function htmlAssets() {
    return [...html.matchAll(/<(?:script|link)\b[^>]*(?:src|href)=["']([^"']+)["']/gi)]
        .map((match) => match[1])
        .filter((asset) => !/^(?:https?:|data:|#)/i.test(asset))
        .map((asset) => asset.split(/[?#]/, 1)[0]);
}

function appShellAssets() {
    const match = serviceWorker.match(/var APP_SHELL = (\[[\s\S]*?\]);/);
    assert.ok(match, 'generated APP_SHELL is present');
    return JSON.parse(match[1]);
}

function hashableContent(relativeFile) {
    const bytes = fs.readFileSync(path.join(root, relativeFile));
    const textExtensions = new Set(['.html', '.css', '.js', '.json', '.geojson', '.txt', '.md', '.xml', '.kml', '.svg']);
    if (!textExtensions.has(path.extname(relativeFile).toLowerCase())) return bytes;
    return Buffer.from(bytes.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
}
function pngSize(relativeFile) {
    const data = fs.readFileSync(path.join(root, relativeFile));
    assert.equal(data.subarray(1, 4).toString('ascii'), 'PNG');
    return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

test('HTML executable and stylesheet dependencies are all same-origin local files', () => {
    assert.doesNotMatch(html, /<(?:script|link)\b[^>]*(?:src|href)=["']https?:/i);
    for (const asset of htmlAssets()) {
        assert.ok(fs.existsSync(path.join(root, asset)), asset);
    }
});

test('generated service worker includes every page asset and required local data', () => {
    const cached = new Set(appShellAssets());
    for (const asset of htmlAssets()) assert.ok(cached.has(`./${asset}`), asset);
    for (const asset of ['./sites.json', './ports.json', './data/land_japan_raw.geojson', './data/inland_water_japan_w09_05.geojson', './data/land-sea-datasets.json']) {
        assert.ok(cached.has(asset), asset);
    }
    assert.match(serviceWorker, /if \(isApiRequest\(requestUrl\)\) return;/);
    assert.match(serviceWorker, /TILE_CACHE_LIMIT = 500/);
});

test('service worker cache version matches current app-shell contents', () => {
    const version = serviceWorker.match(/var CACHE_VERSION = '([a-f0-9]{12})';/);
    assert.ok(version, 'content-based cache version is present');
    const hash = createHash('sha256');
    for (const asset of appShellAssets()) {
        const relativeFile = asset === './' ? 'index.html' : asset.slice(2);
        hash.update(asset);
        hash.update(hashableContent(relativeFile));
    }
    assert.equal(version[1], hash.digest('hex').slice(0, 12));
    assert.match(serviceWorker, /TILE_CACHE_NAME = CACHE_PREFIX \+ 'tiles-v1'/);
});

test('manifest icon declarations match real PNG dimensions', () => {
    assert.equal(manifest.lang, 'ja');
    assert.equal(manifest.scope, './');
    for (const icon of manifest.icons) {
        const expected = Number(icon.sizes.split('x')[0]);
        assert.deepEqual(pngSize(icon.src), { width: expected, height: expected });
        assert.match(icon.purpose, /maskable/);
    }
});

test('all local CSS url references resolve to files', () => {
    const cssDirectory = path.join(root, 'css');
    for (const file of fs.readdirSync(cssDirectory).filter((name) => name.endsWith('.css'))) {
        const css = fs.readFileSync(path.join(cssDirectory, file), 'utf8');
        for (const match of css.matchAll(/url\((?:["'])?([^"')]+)(?:["'])?\)/gi)) {
            const reference = match[1].trim();
            if (/^(?:data:|https?:|#)/i.test(reference)) continue;
            assert.ok(fs.existsSync(path.resolve(cssDirectory, path.dirname(file), reference)), `${file}: ${reference}`);
        }
    }
});

test('map tiles use HTTPS', () => {
    const mapCode = fs.readFileSync(path.join(root, 'js/pred/pred-map.js'), 'utf8');
    assert.doesNotMatch(mapCode, /http:\/\/server\.arcgisonline\.com/);
});
