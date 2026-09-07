'use strict';
const { timingSafeEqual } = require('node:crypto');
function send(res, status, data) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(JSON.stringify(data));
}
function checkRequest(req, port, token) {
    let origin;
    try {
        const address = new URL('http://' + req.headers.host);
        if (!['localhost', '127.0.0.1', '[::1]'].includes(address.hostname) || address.port !== String(port) || address.username || address.password) return false;
        origin = address.origin;
        if (new URL(req.url, origin).origin !== origin) return false;
    } catch (_) { return false; }
    if (req.headers.origin && req.headers.origin !== origin) return false;
    if (req.headers['sec-fetch-site'] === 'cross-site') return false;
    if (req.method !== 'GET') {
        const supplied = req.headers['x-local-token'];
        if (typeof supplied !== 'string' || Buffer.byteLength(supplied) !== Buffer.byteLength(token) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(token))) return false;
        if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) return false;
    }
    return true;
}
async function body(req) {
    let text = '';
    for await (const chunk of req) {
        text += chunk;
        if (Buffer.byteLength(text) > 4096) throw Object.assign(new Error('リクエストが大きすぎます。'), { status: 413 });
    }
    try { const data = JSON.parse(text || '{}'); if (!data || Array.isArray(data) || typeof data !== 'object') throw new Error(); return data; }
    catch (_) { throw Object.assign(new Error('JSON形式が不正です。'), { status: 400 }); }
}
async function handle(req, res, service, port) {
    if (!service) { send(res, 404, { error: { description: 'ローカル管理はstart-local.batから起動した場合だけ利用できます。' } }); return; }
    if (!checkRequest(req, port, service.token)) { send(res, 403, { error: { description: 'このローカル画面から操作してください。' } }); return; }
    try {
        const url = new URL(req.url, 'http://' + req.headers.host);
        const route = url.pathname;
        if (req.method === 'GET' && route === '/local/session') return send(res, 200, { token: service.token });
        if (req.method === 'GET' && (route === '/local/status' || route === '/local/weather/status')) return send(res, 200, await service.status());
        if (req.method === 'GET' && route === '/local/weather/resolve') return send(res, 200, await service.resolve(Object.fromEntries(url.searchParams)));
        if (req.method === 'POST' && route === '/local/weather/download') {
            const data = await body(req); return send(res, 202, { job: await service.startDownload(data.dataset) });
        }
        if (req.method === 'POST' && route === '/local/weather/recover') {
            if (!service.job || service.job.status !== 'recovery_required') return send(res, 409, { error: { description: '復旧待ちのジョブはありません。' } });
            await service.recover(true); return send(res, 200, await service.status());
        }
        if (req.method === 'POST' && route === '/local/weather/cancel') {
            const data = await body(req); return send(res, 202, { job: await service.cancel(data.id) });
        }
        if (req.method === 'DELETE' && route === '/local/weather/dataset') {
            const data = await body(req); return send(res, 200, await service.deleteFile('delete-run', data.run, data.fingerprint));
        }
        if (req.method === 'DELETE' && route === '/local/weather/temporary') {
            const data = await body(req); return send(res, 200, await service.deleteFile('cleanup', data.name, data.fingerprint));
        }
        send(res, 404, { error: { description: '操作が見つかりません。' } });
    } catch (error) { send(res, error.status || 503, { error: { description: error.message.slice(0, 2000) } }); }
}
module.exports = { handle, send, checkRequest };
