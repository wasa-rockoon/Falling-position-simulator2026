const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { LocalService, chooseDataset, validRun } = require('../local/service');
const { checkRequest } = require('../local/http-api');
function sample() {
    return { elevation: { ready: true, fingerprint: 'terrain' }, freeBytes: 100 * 1024 ** 3, revision: 'inventory', temporary: [], datasets: [
        { run: '2026090600', valid: true, fingerprint: 'a'.repeat(64), forecastStart: '2026-09-06T00:00:00Z', forecastEnd: '2026-09-14T00:00:00Z' },
        { run: '2026090700', valid: true, fingerprint: 'b'.repeat(64), forecastStart: '2026-09-07T00:00:00Z', forecastEnd: '2026-09-15T00:00:00Z' }
    ] };
}
async function fixture(t, overrides = {}) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wasa-local-test-'));
    const data = sample(), calls = [];
    const runtime = {
        compose: async args => { calls.push(args); return args.includes('inventory') ? JSON.stringify(data) : args.includes('--images') ? 'image@sha256:abc' : args.includes('maintenance') ? JSON.stringify({ deleted: ['2026090600'], bytes: 100 }) : ''; },
        run: async args => { calls.push(args); return ''; },
        performDownload: async () => {},
        waitTawhiri: async () => {},
        ...overrides
    };
    const service = new LocalService({ runtime, directory });
    await service.ready;
    t.after(async () => {
        if (service.controller && service.job && ['running','cancelling'].includes(service.job.status)) { service.controller.abort(); await service.completion; }
        assert.equal(path.dirname(directory), os.tmpdir());
        assert.ok(path.basename(directory).startsWith('wasa-local-test-'));
        fs.rmSync(directory, { recursive: true, force: true });
    });
    return { service, data, calls, directory, runtime };
}
test('run validation rejects nonexistent dates and command/path text', () => {
    for (const value of ['2026023000', '../../srv', '2026090701', '2026090700;rm', null]) assert.equal(validRun(value), false);
    assert.equal(validRun('2024022906'), true);
});
test('resolve selects a covering run and checks the requested end time', () => {
    const data = sample();
    assert.equal(chooseDataset(data, { launch_datetime: '2026-09-06T05:00:00Z' }, 'engine').run, '2026090600');
    assert.equal(chooseDataset(data, { launch_datetime: '2026-09-07T05:00:00Z' }, 'engine').run, '2026090700');
    assert.throws(() => chooseDataset(data, { launch_datetime: '2026-09-15T00:00:00Z' }, 'engine'), /GFS/);
    assert.throws(() => chooseDataset(data, { launch_datetime: '2026-09-07T05:00:00Z', stop_datetime: '2026-09-16T00:00:00Z' }, 'engine'), /GFS/);
    data.elevation.ready = false;
    assert.throws(() => chooseDataset(data, { launch_datetime: '2026-09-07T05:00:00Z' }, 'engine'), /標高/);
});
test('local mutations reject cross-site, DNS rebinding, absent and Unicode tokens', () => {
    const token = 'a'.repeat(64);
    const good = { method: 'POST', url: '/local/weather/download', headers: { host: 'localhost:3100', origin: 'http://localhost:3100', 'content-type': 'application/json', 'x-local-token': token } };
    assert.equal(checkRequest(good,3100,token), true);
    for (const headers of [ {origin:'https://evil.example'}, {host:'evil.example:3100'}, {'x-local-token':undefined}, {'x-local-token':'あ'.repeat(64)}, {'sec-fetch-site':'cross-site'}, {'content-type':'text/plain'} ]) {
        assert.equal(checkRequest({...good,headers:{...good.headers,...headers}},3100,token),false);
    }
});
test('active prediction blocks download/deletion, release is idempotent', async t => {
    const {service}=await fixture(t);
    const lease=await service.acquirePrediction({ launch_datetime:'2026-09-07T05:00:00Z' });
    await assert.rejects(service.startDownload(null), /予測中/);
    await assert.rejects(service.deleteFile('delete-run','2026090600','a'.repeat(64)),/予測中/);
    lease.release(); lease.release(); assert.equal(service.activePredictions,0);
});
test('download continues without a browser, blocks predictions, and can be cancelled', async t => {
    let started;
    const began = new Promise(resolve=>{started=resolve;});
    const {service,directory}=await fixture(t,{performDownload:async (_dataset,options)=>{
        options.onStage('gfs'); options.onData('downloading'); started();
        await new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new Error('cancel')), {once:true}));
    }});
    const job=await service.startDownload('2026090700'); await began;
    assert.equal(JSON.parse(fs.readFileSync(path.join(directory,'weather-job.json'))).log,'downloading');
    await assert.rejects(service.startDownload(null),/データ操作中/);
    await assert.rejects(service.resolve({launch_datetime:'2026-09-07T05:00:00Z'}),/操作中/);
    await service.cancel(job.id); await service.completion;
    assert.equal(service.job.status,'cancelled'); assert.equal(service.mutating,false);
    assert.equal(fs.existsSync(service.lockFile),false);
});
test('cleanup failures retain the lock and require recovery instead of allowing new predictions', async t => {
    const {service}=await fixture(t,{run:async()=>{throw new Error('Docker disconnected');}});
    await service.startDownload('2026090700'); await service.completion;
    assert.equal(service.job.status,'recovery_required'); assert.equal(service.mutating,true);
    await assert.rejects(service.resolve({launch_datetime:'2026-09-07T05:00:00Z'}),/操作中/);
});
test('deletion verifies the preview fingerprint and stops workers before deleting', async t => {
    const {service,calls}=await fixture(t);
    await assert.rejects(service.deleteFile('delete-run','2026090600','c'.repeat(64)),/変更/);
    const result=await service.deleteFile('delete-run','2026090600','a'.repeat(64));
    assert.equal(result.deleted[0],'2026090600');
    const stop=calls.findIndex(a=>Array.isArray(a)&&a[0]==='stop');
    const remove=calls.findIndex(a=>Array.isArray(a)&&a.includes('maintenance'));
    const up=calls.findIndex(a=>Array.isArray(a)&&a[0]==='up');
    assert.ok(stop>=0&&stop<remove&&remove<up); assert.equal(service.mutating,false);
});
test('dataset or engine changes alter cache identity; stale preflight is rejected', async t => {
    const {service,data}=await fixture(t);
    const params={launch_datetime:'2026-09-07T05:00:00Z'};
    const first=await service.resolve(params);
    data.datasets[1].fingerprint='c'.repeat(64); service.cache=null;
    const next=await service.resolve(params); assert.notEqual(first.revision,next.revision);
    await assert.rejects(service.acquirePrediction({...params,_local_revision:first.revision}),/更新/);
    assert.notEqual(chooseDataset(data,params,'different-engine').revision,next.revision);
});

test('recovery keeps the launcher lock while cleaning an interrupted job', async t => {
    const {directory,runtime,calls}=await fixture(t);
    const id='d'.repeat(32);
    fs.writeFileSync(path.join(directory,'weather-job.json'),JSON.stringify({id,containerName:'wasa-local-'+id,kind:'download',status:'running'}));
    fs.writeFileSync(path.join(directory,'operation.lock'),JSON.stringify({kind:'launcher',pid:process.pid}));
    const recovered=new LocalService({directory,runtime}); await recovered.ready;
    assert.equal(recovered.job.status,'interrupted');
    assert.equal(recovered.mutating,false);
    assert.equal(JSON.parse(fs.readFileSync(path.join(directory,'operation.lock'))).kind,'launcher');
    assert.ok(calls.some(args=>Array.isArray(args)&&args[0]==='up'));
});
test('recovery refuses to clean a job owned by another live server', async t => {
    const {directory,runtime}=await fixture(t);
    const id='e'.repeat(32);
    fs.writeFileSync(path.join(directory,'weather-job.json'),JSON.stringify({id,containerName:'wasa-local-'+id,kind:'download',status:'running'}));
    fs.writeFileSync(path.join(directory,'operation.lock'),JSON.stringify({jobId:id,pid:process.pid}));
    const recovered=new LocalService({directory,runtime}); await recovered.ready;
    assert.equal(recovered.job.status,'recovery_required'); assert.equal(recovered.mutating,true);
    await recovered.recover(true); assert.equal(recovered.job.status,'interrupted');
    assert.equal(fs.existsSync(path.join(directory,'operation.lock')),false);
});
