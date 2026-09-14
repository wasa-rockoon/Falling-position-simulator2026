// No production UI change. Runs the existing real Dedicated Worker in an empty test page.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import os from 'node:os';
import {chromium} from '@playwright/test';
import {startServer} from './serve.mjs';
const fixtures=new URL('./fixtures/',import.meta.url);
const read=name=>fs.readFile(new URL(name,fixtures));
const json=async name=>JSON.parse(await read(name));
const suite=await json('validation-suite.json');
const baseline=await json('baseline.json');
const m=await json('manifest.json'),tm=await json('terrain.json');
const hash=async name=>createHash('sha256').update(await read(name)).digest('hex');
assert.equal(await hash('weather.bin'),m.sha256);
assert.equal(await hash('terrain.bin'),tm.sha256);
for(const entry of suite.cases) {
    const r=await json(entry.referenceFile);
    assert.equal(r.image,baseline.image);
    assert.equal(r.caseSha256,await hash(entry.caseFile));
    assert.equal(r.weatherSha256,m.sha256);
    assert.equal(r.terrainSha256,tm.sha256);
}
const server=await startServer(),origin='http://127.0.0.1:'+server.address().port;
let browser;
try {
    browser=await chromium.launch({headless:true});
    const context=await browser.newContext({serviceWorkers:'block'});
    const requests=[],workers=[],pageErrors=[];
    await context.route('**/*',async route=>{
        const url=route.request().url();requests.push(url);
        if(!url.startsWith(origin+'/')) return route.abort();
        if(url===origin+'/') return route.fulfill({contentType:'text/html',body:'<!doctype html><title>Fixed-case verification</title>'});
        return route.continue();
    });
    const page=await context.newPage();
    page.on('worker',worker=>workers.push(worker.url()));
    page.on('pageerror',error=>pageErrors.push(error.message));
    await page.goto(origin);
    await page.evaluate(async()=>{
        async function get(name,binary=false) {
            const response=await fetch('./fixtures/'+name);
            if(!response.ok) throw Error('Missing '+name);
            return binary?response.arrayBuffer():response.json();
        }
        const suite=await get('validation-suite.json');
        const [manifest,terrainMeta,weatherBuffer,terrainBuffer,testCase,reference]=await Promise.all([
            get('manifest.json'),get('terrain.json'),get('weather.bin',true),get('terrain.bin',true),get(suite.baseCase),get('reference.json')]);
        const entries=await Promise.all(suite.cases.map(async entry=>({...entry,testCase:await get(entry.caseFile),reference:await get(entry.referenceFile)})));
        const worker=new Worker('./predictor.worker.js',{type:'module'});
        const pending=new Map();let serial=0;
        worker.onmessage=({data})=>{const p=pending.get(data.id);if(p){clearTimeout(p.timer);pending.delete(data.id);p.resolve(data);}};
        worker.onerror=event=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error(event.message));}pending.clear();};
        const call=(type,params={},transfer=[])=>new Promise((resolve,reject)=>{
            const id=++serial;
            const timer=setTimeout(()=>{pending.delete(id);reject(Error('Worker timed out'));},15000);
            pending.set(id,{resolve,reject,timer});worker.postMessage({id,type,...params},transfer);
        });
        const load=(c,r)=>{
            // Preserve one host copy; transfer ownership of copies to the same Worker.
            const wb=weatherBuffer.slice(0),tb=terrainBuffer.slice(0);
            return call('load',{manifest,terrainMeta,testCase:c,reference:r,weatherBuffer:wb,terrainBuffer:tb},[wb,tb]);
        };
        window.validation={suite,entries,base:{testCase,reference},load,call,worker};
        const initial=await load(testCase,reference);
        if(!initial.pass) throw Error('Baseline interpolation failed');
    });
    assert.equal(workers.length,1);
    const before=requests.length;
    await context.setOffline(true);
    const outcome=await page.evaluate(async()=>{
        const v=window.validation,results=[],errors=[];
        for(const entry of v.entries) {
            const loaded=await v.load(entry.testCase,entry.reference);
            if(loaded.type==='error'||!loaded.pass) throw Error(entry.id+': interpolation failed');
            const result=await v.call('calculate',{count:1});
            if(result.type==='error') throw Error(entry.id+': '+result.error);
            results.push({id:entry.id,pass:result.comparison.pass,
                maxWindError:loaded.maxWindError,maxTerrainError:loaded.maxTerrainError,
                metrics:result.comparison.metrics,reference:result.comparison.reference,browser:result.comparison.browser,
                performance:result.performance});
        }
        for(const entry of v.suite.errorCases) {
            // Error cases have no valid trajectory reference. Only the error is asserted.
            const loaded=await v.load({...v.base.testCase,...entry.overrides},v.base.reference);
            if(loaded.type==='error') throw Error('Unexpected initialization error');
            const error=await v.call('calculate',{count:1});
            errors.push({id:entry.id,expected:entry.expectedError,actual:error.error,pass:error.type==='error'&&error.error===entry.expectedError});
        }
        await v.load(v.base.testCase,v.base.reference);
        const recovered=await v.call('calculate',{count:1});
        return {results,errors,recovered:recovered.type==='result'&&recovered.comparison.pass};
    });
    assert.ok(outcome.results.every(r=>r.pass&&Object.values(r.metrics).every(n=>Number.isFinite(n)&&n<=1)));
    assert.ok(outcome.errors.every(r=>r.pass));
    assert.equal(outcome.recovered,true);
    assert.equal(workers.length,1);
    assert.equal(requests.length,before);
    assert.ok(requests.every(url=>url.startsWith(origin+'/')));
    assert.deepEqual(pageErrors,[]);
    const report={timestamp:new Date().toISOString(),image:baseline.image,weatherSha256:m.sha256,terrainSha256:tm.sha256,
        environment:{cpu:os.cpus()[0].model,platform:os.platform(),node:process.version,chromium:browser.version(),headless:true},
        ...outcome,offline:{pass:true,additionalRequests:0,workerCount:1},requestCount:requests.length};
    await fs.mkdir(new URL('./results/',import.meta.url),{recursive:true});
    await fs.writeFile(new URL('./results/validation-cases.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
    console.table(report.results.map(r=>({case:r.id,landingM:r.metrics.landingErrorM,trajectoryM:r.metrics.maxTrajectoryErrorM,timeS:r.metrics.landingTimeErrorS,pass:r.pass})));
    console.log('Range errors:',report.errors,'Offline:',report.offline,'Recovery:',report.recovered);
} finally {
    if(browser) await browser.close();
    await new Promise(resolve=>server.close(resolve));
}
