const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const vm = require('node:vm');
const fs = require('node:fs');
const runtime = require('../local/scripts/local-runtime.js');
const root = path.resolve(__dirname, '..');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function listen(server) { server.listen(0, '127.0.0.1'); await once(server, 'listening'); return server.address().port; }
async function availablePort() { const server = http.createServer(); const port = await listen(server); await new Promise(resolve => server.close(resolve)); return port; }

test('local proxy forwards prediction, protects runtime, and stops only with owner token', async t => {
    let observed;
    const upstream = http.createServer((req, res) => {
        observed = req.url;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ prediction: [{ stage: 'ascent', trajectory: [] }, { stage: 'descent', trajectory: [] }] }));
    });
    const upstreamPort = await listen(upstream);
    t.after(() => upstream.close());
    const port = await availablePort();
    const token = 'test-owner-token-0123456789';
    const child = spawn(process.execPath, [path.join(root, 'cors-proxy.js')], { windowsHide: true, env: {
        ...process.env, PORT: String(port), HOST: '127.0.0.1', STRICT_PORT: '1', TAWHIRI_HOST: '127.0.0.1', TAWHIRI_PORT: String(upstreamPort), LOCAL_SHUTDOWN_TOKEN: token
    }, stdio: 'ignore' });
    t.after(() => child.kill());
    const base = `http://127.0.0.1:${port}`;
    let ready = false;
    for (let i = 0; i < 80; i++) {
        try { if ((await fetch(base + '/__server-info')).ok) { ready = true; break; } } catch (_) { }
        await delay(100);
    }
    assert.ok(ready);
    assert.equal((await fetch(base + '/')).status, 200);
    assert.equal((await fetch(base + '/local/.runtime/server.json')).status, 404);
    assert.equal((await fetch(base + '/.git/config')).status, 403);
    assert.equal((await fetch(base + '/%ZZ')).status, 400);
    const response = await fetch(base + '/api/v1/?launch_latitude=33&ascent_rate=5');
    assert.equal((await response.json()).prediction.length, 2);
    assert.equal(observed, '/api/v1/?launch_latitude=33&ascent_rate=5');
    assert.equal((await fetch(base + '/local/shutdown', { method: 'POST' })).status, 403);
    assert.equal((await fetch(base + '/local/shutdown', { method: 'POST', headers: { Authorization: `Bearer ${token}`, Origin: 'https://example.com' } })).status, 403);
    const exit = once(child, 'exit');
    assert.equal((await fetch(base + '/local/shutdown', { method: 'POST', headers: { Authorization: `Bearer ${token}` } })).status, 200);
    await exit;
});

test('strict server exits on occupied port instead of silently changing port', async t => {
    const existing = http.createServer();
    const port = await listen(existing);
    t.after(() => existing.close());
    const child = spawn(process.execPath, [path.join(root, 'cors-proxy.js')], { windowsHide: true, env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), STRICT_PORT: '1' }, stdio: 'ignore' });
    t.after(() => child.kill());
    const [code] = await once(child, 'exit');
    assert.equal(code, 1);
});

test('latest GFS selection walks backward through completed six-hour runs', async () => {
    const original = global.fetch;
    const urls = [];
    global.fetch = async (url, options) => { urls.push(url); assert.equal(options.method, 'HEAD'); return { ok: urls.length === 2, status: urls.length === 2 ? 200 : 404 }; };
    try {
        const run = await runtime.latestRun();
        assert.match(run, /^\d{8}(00|06|12|18)$/);
        assert.equal(urls.length, 2);
        assert.match(urls[1], /pgrb2\.0p50\.f192$/);
    } finally { global.fetch = original; }
});

test('Pages uses public endpoint; localhost local requests keep same-origin proxy and safe policy', () => {
    const code = fs.readFileSync(path.join(root, 'js/pred/pred-api-client.js'), 'utf8');
    for (const hostname of ['wasa-rockoon.github.io', 'localhost']) {
        const context = { location: { hostname }, Map, URL, setTimeout, clearTimeout };
        vm.runInNewContext(code, context);
        assert.equal(context.PredictionApi.resolveApiUrl('sondehub'), hostname === 'localhost' ? '/api/sondehub/' : 'https://api.v2.sondehub.org/tawhiri');
        assert.equal(context.PredictionApi.resolveApiUrl('local'), '/api/v1/');
        const client = new context.PredictionApi.PredictionClient({ source: 'local', fetchImpl: async () => {} });
        assert.equal(client.queue.concurrency, 2);
        assert.equal(client.queue.minIntervalMs, 100);
    }
});

test('command JSON output excludes Docker-style progress on stderr', async () => {
    const output = await runtime.run(process.execPath, ['-e', 'process.stderr.write("Container creating\\n"); process.stdout.write(JSON.stringify({ok:true}));']);
    assert.deepEqual(JSON.parse(output), {ok:true});
});
