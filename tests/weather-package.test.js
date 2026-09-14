const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const Package = require('../js/pred/weather-package.js');
const Browser = require('../js/pred/browser-predictor-provider.js');
const directory = path.join(__dirname, '../poc/browser-predictor/fixtures');
async function fixture() {
    async function json(name) { return JSON.parse(await fs.readFile(path.join(directory,name),'utf8')); }
    async function bytes(name) { const b = await fs.readFile(path.join(directory,name)); return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength); }
    return { manifest:await json('manifest.json'), terrainMeta:await json('terrain.json'),
        sampleCase:await json('case.json'), weatherBuffer:await bytes('weather.bin'), terrainBuffer:await bytes('terrain.bin') };
}
test('package round trip preserves exact weather and terrain bytes and derives coverage', async () => {
    const a = await fixture(), buffer = await Package.encode(a), decoded = await Package.decode(buffer);
    assert.deepEqual(decoded.weatherBuffer,a.weatherBuffer);
    assert.deepEqual(decoded.terrainBuffer,a.terrainBuffer);
    assert.deepEqual(decoded.sampleCase,a.sampleCase);
    assert.equal(decoded.coverage.start,'2026-09-10T03:00:00.000Z');
    assert.equal(decoded.coverage.end,'2026-09-10T09:00:00.000Z');
    assert.deepEqual(decoded.coverage.terrain,{south:32,north:35,west:131,east:135});
    assert.match(decoded.packageSha256,/^[a-f0-9]{64}$/);
});
test('malformed, truncated, corrupted and unsupported packages are rejected', async () => {
    const buffer = await Package.encode(await fixture());
    await assert.rejects(Package.decode(buffer.slice(0,-1)),/長さ/);
    const badMagic = buffer.slice(0); new Uint8Array(badMagic)[0]=0;
    await assert.rejects(Package.decode(badMagic),/wasawx/);
    const badLength = buffer.slice(0); new DataView(badLength).setUint32(8,0xffffffff,true);
    await assert.rejects(Package.decode(badLength),/ヘッダー/);
    const corrupt = buffer.slice(0); new Uint8Array(corrupt)[corrupt.byteLength-1]^=1;
    await assert.rejects(Package.decode(corrupt),/SHA-256/);
    const a = await fixture(); a.manifest.units[0]='m';
    await assert.rejects(Package.encode(a),/単位/);
    a.manifest.units[0]='gpm'; a.manifest.pressureLevelsHpa.reverse();
    await assert.rejects(Package.encode(a),/47気圧面/);
});
test('misaligned grids, nonconsecutive hours and nonoverlapping terrain are rejected', async () => {
    let a=await fixture(); a.manifest.latitude.start=30.1;
    await assert.rejects(Package.encode(a),/格子/);
    a=await fixture(); a.manifest.forecastHours=[3,6,12];
    await assert.rejects(Package.encode(a),/3時間/);
    a=await fixture(); a.terrainMeta.firstGlobalRow=1000;
    await assert.rejects(Package.encode(a),/重なって/);
});
test('an imported date range is used; failed replacement retains old data and reset restores builtin', async () => {
    const a=await fixture();
    // Synthetic metadata shift tests selection only; not a new real GFS run.
    a.manifest.run='2026-09-11T00:00:00Z'; a.sampleCase.launchDatetime='2026-09-11T04:30:00Z';
    const buffer=await Package.encode(a);
    let fetched=0;
    const client=Browser.create({baseUrl:'https://example.test/poc/',fetchImpl:()=>{fetched++;throw Error('network');}});
    const file={size:buffer.byteLength,arrayBuffer:async()=>buffer};
    await client.importPackage(file);
    assert.equal(client.describe().run,a.manifest.run);
    assert.equal((await client.sample()).launchDatetime,a.sampleCase.launchDatetime);
    const identity=client.describe().packageSha256;
    await assert.rejects(client.importPackage({size:3,arrayBuffer:async()=>new ArrayBuffer(3)}));
    assert.equal(client.describe().packageSha256,identity);
    const exported=await Package.decode(await client.exportPackage());
    assert.equal(exported.manifest.run,a.manifest.run);
    assert.equal(fetched,0);
    let read=false;
    await assert.rejects(client.importPackage({size:Package.maxBytes+1,arrayBuffer:()=>{read=true;}}),/64MiB/);
    assert.equal(read,false);
    client.useBuiltin();
    assert.equal(client.describe().imported,false);
    assert.equal(client.describe().run,'2026-09-10T00:00:00Z');
});
test('selected region drives input bounds rather than builtin Ehime bounds', async () => {
    const a=await fixture();
    // Synthetic geographical shift only checks metadata routing.
    a.manifest.latitude.start-=3; a.terrainMeta.firstGlobalRow+=720;
    a.sampleCase.launchLatitude-=3;
    const decoded=await Package.decode(await Package.encode(a));
    const params={pred_type:'single',profile:'standard_profile',launch_datetime:a.sampleCase.launchDatetime,
        launch_latitude:a.sampleCase.launchLatitude,launch_longitude:a.sampleCase.launchLongitude,
        launch_altitude:100,ascent_rate:5,descent_rate:5,burst_altitude:30000};
    assert.equal(Browser.parameters(params,{},decoded.coverage).launchLatitude,30.13492);
    assert.throws(()=>Browser.parameters(params),/標高/);
    assert.throws(()=>Browser.parameters({...params,launch_latitude:33.13492},{},decoded.coverage),/標高/);
});
test('nonfinite weather and missing terrain are rejected even with matching checksums', async () => {
    const { createHash }=require('node:crypto');
    const a=await fixture();
    new DataView(a.weatherBuffer).setFloat32(0,NaN,true);
    a.manifest.sha256=createHash('sha256').update(new Uint8Array(a.weatherBuffer)).digest('hex');
    await assert.rejects(Package.encode(a),/NaN/);
    const b=await fixture();
    new DataView(b.terrainBuffer).setInt16(0,-32768,true);
    b.terrainMeta.sha256=createHash('sha256').update(new Uint8Array(b.terrainBuffer)).digest('hex');
    await assert.rejects(Package.encode(b),/欠損値/);
});