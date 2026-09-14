/* Versioned, local-only weather package. No network or executable content. */
(function (root, factory) {
    var api = factory(root);
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.WeatherPackage = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
    'use strict';
    var MAGIC = 'WASAWX01', MAX_BYTES = 64 * 1024 * 1024, MAX_HEADER = 256 * 1024;
    var LEVELS = [1000,975,950,925,900,875,850,825,800,775,750,725,700,675,650,625,600,575,550,525,500,475,450,425,400,375,350,325,300,275,250,225,200,175,150,125,100,70,50,30,20,10,7,5,3,2,1];
    function check(condition, message) {
        if (!condition) {
            var error = new Error('気象パッケージ: ' + message);
            error.userMessage = error.message;
            throw error;
        }
    }
    function integer(value, min, max) { return Number.isInteger(value) && value >= min && value <= max; }
    function lon(value) { return ((value % 360) + 360) % 360; }
    async function digest(buffer) {
        return Array.from(new Uint8Array(await root.crypto.subtle.digest('SHA-256', buffer)))
            .map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
    }
    function coverage(m, t) {
        return {
            start: new Date(Date.parse(m.run) + m.forecastHours[0] * 3600000).toISOString(),
            end: new Date(Date.parse(m.run) + m.forecastHours[m.forecastHours.length - 1] * 3600000).toISOString(),
            weather: { south: m.latitude.start, north: m.latitude.start + (m.latitude.count - 1) * .5,
                west: m.longitude.start, east: m.longitude.start + (m.longitude.count - 1) * .5 },
            terrain: { south: 90 - (t.firstGlobalRow + t.rows - 1) / 240, north: 90 - t.firstGlobalRow / 240,
                west: lon(t.firstGlobalColumn / 240 - 180), east: lon((t.firstGlobalColumn + t.columns - 1) / 240 - 180) }
        };
    }
    async function validate(a) {
        check(a && a.manifest && a.terrainMeta, '気象・標高メタデータが必要です。');
        var m = a.manifest, t = a.terrainMeta;
        check(m.schemaVersion === 1 && m.model === 'GFS' && m.dtype === 'float32-le', '未対応の気象形式です。');
        check(JSON.stringify(m.pressureLevelsHpa) === JSON.stringify(LEVELS), '47気圧面の順序が不正です。');
        check(JSON.stringify(m.variables) === JSON.stringify(['height','wind_u','wind_v']) &&
            JSON.stringify(m.units) === JSON.stringify(['gpm','m/s','m/s']), '変数または単位が未対応です。');
        check(typeof m.run === 'string' && /^\d{4}-\d\d-\d\dT\d\d:00:00(?:\.000)?Z$/.test(m.run) &&
            Number.isFinite(Date.parse(m.run)) && new Date(m.run).toISOString().replace('.000Z','Z') === m.run.replace('.000Z','Z'), 'GFS runはUTCの正時で指定してください。');
        check(Array.isArray(m.forecastHours) && m.forecastHours.length >= 2 && m.forecastHours.length <= 65 &&
            m.forecastHours.every(function (h, i) { return integer(h,0,192) && h % 3 === 0 && (!i || h === m.forecastHours[i-1] + 3); }), '予報時刻は連続する3時間間隔が必要です。');
        check(m.latitude && m.longitude && m.latitude.step === .5 && m.longitude.step === .5 &&
            integer(m.latitude.count,2,361) && integer(m.longitude.count,2,720) &&
            Number.isFinite(m.latitude.start) && m.latitude.start * 2 % 1 === 0 &&
            Number.isFinite(m.longitude.start) && m.longitude.start * 2 % 1 === 0, '0.5度格子の設定が不正です。');
        check(t.dtype === 'int16-le' && t.samplesPerDegree === 240 && integer(t.rows,2,43201) &&
            integer(t.columns,2,86401) && integer(t.firstGlobalRow,0,43200) && integer(t.firstGlobalColumn,0,86400) &&
            t.firstGlobalRow + t.rows <= 43201 && t.firstGlobalColumn + t.columns <= 86401, '15秒角標高格子が不正です。');
        var c = coverage(m,t);
        check(c.weather.south >= -90 && c.weather.north <= 90 && c.weather.west >= 0 && c.weather.east <= 359.5 &&
            c.terrain.west < c.terrain.east, '日付変更線・経度原点をまたぐ領域には未対応です。');
        check(Math.max(c.weather.south,c.terrain.south) < Math.min(c.weather.north,c.terrain.north) &&
            Math.max(c.weather.west,c.terrain.west) < Math.min(c.weather.east,c.terrain.east), '気象と標高の領域が重なっていません。');
        var shape = [m.forecastHours.length,47,3,m.latitude.count,m.longitude.count];
        var weatherBytes = shape.reduce(function (x,y) { return x*y; },4), terrainBytes = t.rows*t.columns*2;
        check(JSON.stringify(m.shape) === JSON.stringify(shape) &&
            a.weatherBuffer instanceof ArrayBuffer && a.terrainBuffer instanceof ArrayBuffer &&
            weatherBytes === m.bytes && terrainBytes === t.bytes &&
            a.weatherBuffer.byteLength === weatherBytes && a.terrainBuffer.byteLength === terrainBytes &&
            weatherBytes + terrainBytes <= MAX_BYTES, 'データの寸法・容量が一致しません。');
        check(/^[a-f0-9]{64}$/.test(m.sha256) && /^[a-f0-9]{64}$/.test(t.sha256), 'SHA-256が不正です。');
        check(await digest(a.weatherBuffer) === m.sha256 && await digest(a.terrainBuffer) === t.sha256, 'データのSHA-256が一致しません。');
        var view = new DataView(a.weatherBuffer), cells = m.latitude.count*m.longitude.count;
        for (var time = 0; time < shape[0]; time++) {
            for (var level = 0; level < 47; level++) {
                for (var variable = 0; variable < 3; variable++) {
                    for (var cell = 0; cell < cells; cell++) {
                        var offset = (((time*47+level)*3+variable)*cells+cell)*4;
                        var value = view.getFloat32(offset,true);
                        check(Number.isFinite(value), '気象値にNaNまたはInfinityがあります。');
                        if (variable === 0 && level > 0) check(value > view.getFloat32(offset-3*cells*4,true), '気圧面の高度が昇順ではありません。');
                    }
                }
            }
        }
        var terrainView = new DataView(a.terrainBuffer);
        for (var offsetTerrain = 0; offsetTerrain < terrainBytes; offsetTerrain += 2) {
            check(terrainView.getInt16(offsetTerrain,true) !== -32768, '標高に欠損値があります。');
        }
        if (a.sampleCase != null) {
            var sample = a.sampleCase;
            check(sample && ['launchLatitude','launchLongitude','launchAltitude','ascentRate','descentRate','burstAltitude']
                .every(function (key) { return typeof sample[key] === 'number' && Number.isFinite(sample[key]); }) &&
                Number.isFinite(Date.parse(sample.launchDatetime)), 'サンプル条件が不正です。');
            check(Date.parse(sample.launchDatetime) >= Date.parse(c.start) && Date.parse(sample.launchDatetime) < Date.parse(c.end) &&
                sample.launchLatitude >= Math.max(c.weather.south,c.terrain.south) &&
                sample.launchLatitude < Math.min(c.weather.north,c.terrain.north) &&
                lon(sample.launchLongitude) >= Math.max(c.weather.west,c.terrain.west) &&
                lon(sample.launchLongitude) < Math.min(c.weather.east,c.terrain.east) &&
                sample.ascentRate > 0 && sample.descentRate > 0 && sample.launchAltitude >= 0 &&
                sample.burstAltitude > sample.launchAltitude, 'サンプル条件がデータ範囲外です。');
        }
        return c;
    }
    async function encode(a) {
        await validate(a);
        var header = new TextEncoder().encode(JSON.stringify({
            schemaVersion: 1, engine: 'tawhiri-0.2.0-js-phase0-v1',
            manifest: a.manifest, terrainMeta: a.terrainMeta, sampleCase: a.sampleCase || null
        }));
        check(header.length <= MAX_HEADER, 'メタデータが大きすぎます。');
        var totalBytes = 12 + header.length + a.weatherBuffer.byteLength + a.terrainBuffer.byteLength;
        check(totalBytes <= MAX_BYTES, '64MiBを超えるパッケージには未対応です。');
        var buffer = new ArrayBuffer(totalBytes);
        var bytes = new Uint8Array(buffer);
        bytes.set(new TextEncoder().encode(MAGIC));
        new DataView(buffer).setUint32(8,header.length,true);
        bytes.set(header,12);
        bytes.set(new Uint8Array(a.weatherBuffer),12+header.length);
        bytes.set(new Uint8Array(a.terrainBuffer),12+header.length+a.weatherBuffer.byteLength);
        return buffer;
    }
    async function decode(buffer) {
        check(buffer instanceof ArrayBuffer && buffer.byteLength >= 12 && buffer.byteLength <= MAX_BYTES, 'ファイル容量が不正です（上限64MiB）。');
        check(new TextDecoder().decode(new Uint8Array(buffer,0,8)) === MAGIC, '対応する.wasawxファイルではありません。');
        var headerBytes = new DataView(buffer).getUint32(8,true);
        check(headerBytes > 0 && headerBytes <= MAX_HEADER && 12+headerBytes < buffer.byteLength, 'ヘッダー長が不正です。');
        var header;
        try { header = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(new Uint8Array(buffer,12,headerBytes))); }
        catch (_) { check(false,'メタデータJSONを読めません。'); }
        check(header && header.schemaVersion === 1 && header.engine === 'tawhiri-0.2.0-js-phase0-v1', '未対応のパッケージバージョンです。');
        var m = header.manifest, t = header.terrainMeta;
        check(m && t && integer(m.bytes,1,MAX_BYTES) && integer(t.bytes,1,MAX_BYTES) &&
            12+headerBytes+m.bytes+t.bytes === buffer.byteLength, 'ファイルが欠落しているか、長さが不正です。');
        var a = { manifest:m, terrainMeta:t, sampleCase:header.sampleCase,
            weatherBuffer:buffer.slice(12+headerBytes,12+headerBytes+m.bytes),
            terrainBuffer:buffer.slice(12+headerBytes+m.bytes) };
        a.coverage = await validate(a);
        a.packageSha256 = await digest(buffer);
        return a;
    }
    return { maxBytes:MAX_BYTES, validate:validate, coverage:coverage, encode:encode, decode:decode };
}));