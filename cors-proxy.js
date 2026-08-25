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

function proxyToTawhiri(req, res) {
    const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
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

        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res);
    });

    proxyReq.on('error', (err) => {
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
    let pathname = decodeURIComponent(reqUrl.pathname);

    if (pathname === '/') pathname = '/index.html';

    const filePath = path.join(STATIC_DIR, pathname);
    if (!filePath.startsWith(STATIC_DIR)) {
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

const server = http.createServer((req, res) => {
    if (req.url === '/__server-info') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
            app: 'Falling-position-simulator2026',
            staticDir: STATIC_DIR,
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

    server.listen(candidate, () => {
        printBootLog(candidate);
    });
}

listenWithFallback(PORT, 20);
