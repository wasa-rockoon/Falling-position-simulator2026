/**
 * CORSプロキシ + 静的ファイル配信サーバ
 *
 * - ポート3100(既定)で静的ファイル (index.html, css/, js/ など) を配信
 * - /api/ へのリクエストをローカルTawhiriへ転送
 *
 * 使い方:
 *   node cors-proxy.js
 *
 * 環境変数:
 *   PORT         サーバポート (デフォルト: 3100)
 *   TAWHIRI_HOST Tawhiri APIのホスト (デフォルト: localhost)
 *   TAWHIRI_PORT Tawhiri APIのポート (デフォルト: 8000)
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = parseInt(process.env.PORT || '3100', 10);
const TAWHIRI_HOST = process.env.TAWHIRI_HOST || 'localhost';
const TAWHIRI_PORT = parseInt(process.env.TAWHIRI_PORT || '8000', 10);
const STATIC_DIR = __dirname;
const HOST = process.env.HOST || '127.0.0.1';
const LOCAL_SHUTDOWN_TOKEN = process.env.LOCAL_SHUTDOWN_TOKEN || '';
const localHttp = require('./local/http-api.js');
const localService = process.env.LOCAL_MANAGEMENT === '1' ? new (require('./local/service.js').LocalService)() : null;

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.csv': 'text/csv; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
    '.md': 'text/markdown; charset=utf-8'
};

async function proxyToTawhiri(req, res) {
    const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    let lease;
    try {
        if (localService && reqUrl.pathname === '/api/v1/') {
            if (req.method !== 'GET') return localHttp.send(res, 405, { error: { description: '予測はGETのみです。' } });
            lease = await localService.acquirePrediction(Object.fromEntries(reqUrl.searchParams));
            if (res.destroyed) { lease.release(); return; }
            reqUrl.searchParams.set('dataset', lease.dataset);
            reqUrl.searchParams.delete('_local_revision');
            res.once('close', lease.release);
            res.once('finish', lease.release);
        }
    } catch (error) { localHttp.send(res, error.status || 503, { error: { description: error.message } }); return; }
    const exportFormat = ['csv', 'kml'].includes(reqUrl.searchParams.get('format')) ? reqUrl.searchParams.get('format') : null;
    if (exportFormat) reqUrl.searchParams.delete('format');
    const targetPath = `${reqUrl.pathname}${reqUrl.search}`;

    const options = {
        hostname: TAWHIRI_HOST,
        port: TAWHIRI_PORT,
        path: targetPath,
        method: req.method,
        headers: {
            ...req.headers,
            host: `${TAWHIRI_HOST}:${TAWHIRI_PORT}`
        }
    };

    const proxyReq = http.request(options, (proxyRes) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        if (lease) {
            proxyRes.headers['x-local-revision'] = lease.revision;
            proxyRes.headers['x-local-engine'] = lease.engine;
            proxyRes.headers['cache-control'] = 'no-store';
        }
        if (exportFormat && proxyRes.statusCode === 200) {
            let size = 0; const chunks = [];
            proxyRes.on('data', chunk => {
                size += chunk.length;
                if (size > 32 * 1024 * 1024) { proxyRes.destroy(); localHttp.send(res, 502, { error: { description: '出力する予測結果が大きすぎます。' } }); }
                else chunks.push(chunk);
            });
            proxyRes.on('end', () => {
                if (res.destroyed || res.writableEnded) return;
                try {
                    const output = require('./local/prediction-export').predictionExport(JSON.parse(Buffer.concat(chunks).toString('utf8')), exportFormat);
                    const headers = { 'Content-Type': exportFormat === 'csv' ? 'text/csv; charset=utf-8' : 'application/vnd.google-earth.kml+xml; charset=utf-8', 'Content-Disposition': 'attachment; filename="prediction.' + exportFormat + '"', 'Cache-Control': 'no-store' };
                    if (lease) { headers['x-local-revision'] = lease.revision; headers['x-local-engine'] = lease.engine; }
                    res.writeHead(200, headers); res.end(output);
                } catch (error) { localHttp.send(res, 502, { error: { description: error.message } }); }
            });
            proxyRes.on('error', error => { if (!res.writableEnded && !res.destroyed) localHttp.send(res, 502, { error: { description: error.message } }); });
            return;
        }
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res);
    });

    proxyReq.setTimeout(120000, () => proxyReq.destroy(new Error('予測APIがタイムアウトしました。')));
    res.once('close', () => { if (!res.writableFinished) proxyReq.destroy(); });
    proxyReq.on('error', (err) => {
        if (res.destroyed || res.headersSent) return;
        console.error(`[Proxy Error] ${err.message}`);
        res.writeHead(502, {
            'Content-Type': 'application/json; charset=utf-8',
            'Access-Control-Allow-Origin': '*'
        });
        res.end(JSON.stringify({
            error: {
                description: `Tawhiri APIへ接続できません (${TAWHIRI_HOST}:${TAWHIRI_PORT}): ${err.message}`
            }
        }));
    });

    req.pipe(proxyReq);
}

function proxyToSondeHub(req, res) {
    const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const options = {
        hostname: 'api.v2.sondehub.org',
        port: 443,
        path: '/tawhiri' + reqUrl.search,
        method: req.method,
        headers: { Accept: 'application/json' }
    };

    const proxyReq = https.request(options, (proxyRes) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res);
    });

    proxyReq.on('error', (err) => {
        console.error(`[SondeHub Proxy Error] ${err.message}`);
        res.writeHead(502, {
            'Content-Type': 'application/json; charset=utf-8',
            'Access-Control-Allow-Origin': '*'
        });
        res.end(JSON.stringify({ error: { description: `SondeHub APIへ接続できません: ${err.message}` } }));
    });

    req.pipe(proxyReq);
}
function serveStaticFile(req, res) {
    const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    let pathname;
    try { pathname = decodeURIComponent(reqUrl.pathname); }
    catch (_) { res.writeHead(400); res.end('Bad Request'); return; }
    // Runtime credentials, configuration and Git metadata must never be served.
    if (pathname.split(/[\\/]/).some(part => part.startsWith('.')) || /^\/local(?:\/|$)/.test(pathname)) {
        res.writeHead(403); res.end('Forbidden'); return;
    }

    if (pathname === '/') pathname = '/index.html';

    const filePath = path.join(STATIC_DIR, pathname);
    if (!filePath.startsWith(STATIC_DIR + path.sep)) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Forbidden');
        return;
    }

    fs.stat(filePath, (err, stats) => {
        if (err || !stats.isFile()) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end(`Not Found: ${pathname}`);
            return;
        }

        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': contentType });
        fs.createReadStream(filePath).pipe(res);
    });
}

const server = http.createServer(async (req, res) => {
    if (req.url === '/local/shutdown') {
        if (!LOCAL_SHUTDOWN_TOKEN || req.method !== 'POST' || req.headers.origin ||
            req.headers.authorization !== `Bearer ${LOCAL_SHUTDOWN_TOKEN}`) {
            res.writeHead(403); res.end('Forbidden'); return;
        }
        try { if (localService) await localService.shutdown(); }
        catch (error) { localHttp.send(res, error.status || 503, { error: { description: error.message } }); return; }
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ stopped: true }));
        server.close(() => process.exit(0));
        setTimeout(() => process.exit(0), 2000).unref();
        return;
    }
    if (req.url.startsWith('/local/')) { await localHttp.handle(req, res, localService, server.address().port); return; }
    if (req.url === '/__server-info') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
            app: 'Falling-position-simulator2026',
            staticDir: STATIC_DIR,
            localManagement: Boolean(localService),
            localInstance: LOCAL_SHUTDOWN_TOKEN ? LOCAL_SHUTDOWN_TOKEN.slice(0, 16) : null,
            tawhiri: `${TAWHIRI_HOST}:${TAWHIRI_PORT}`
        }, null, 2));
        return;
    }

    if (req.method === 'OPTIONS' && req.url.startsWith('/api/')) {
        res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Max-Age': '86400'
        });
        res.end();
        return;
    }

    if (req.url.startsWith('/api/sondehub/')) {
        console.log(`[SondeHub Proxy] ${req.method} ${req.url}`);
        proxyToSondeHub(req, res);
        return;
    }
    if (req.url.startsWith('/api/')) {
        console.log(`[Proxy] ${req.method} ${req.url} -> ${TAWHIRI_HOST}:${TAWHIRI_PORT}`);
        proxyToTawhiri(req, res);
        return;
    }

    serveStaticFile(req, res);
});

function printBootLog(port) {
    console.log('===========================================');
    console.log('  Falling Position Simulator 2026 Dev Server');
    console.log('===========================================');
    console.log(`  Static files : http://localhost:${port}/`);
    console.log(`  API proxy    : http://localhost:${port}/api/v1/ -> http://${TAWHIRI_HOST}:${TAWHIRI_PORT}/api/v1/`);
    console.log(`  Server info  : http://localhost:${port}/__server-info`);
    console.log(`  Static root  : ${STATIC_DIR}`);
    console.log('===========================================');
}

function listenWithFallback(port, retriesLeft) {
    const candidate = Number(port);
    server.once('error', (err) => {
        if (err.code === 'EADDRINUSE' && retriesLeft > 0) {
            const nextPort = candidate + 1;
            console.warn(`[Warn] ポート ${candidate} は使用中です。${nextPort} で再試行します。`);
            listenWithFallback(nextPort, retriesLeft - 1);
            return;
        }
        console.error(`[Error] サーバ起動失敗: ${err.message}`);
        process.exit(1);
    });

    server.listen(candidate, HOST, () => {
        printBootLog(candidate);
    });
}

listenWithFallback(PORT, process.env.STRICT_PORT === '1' ? 0 : 20);
