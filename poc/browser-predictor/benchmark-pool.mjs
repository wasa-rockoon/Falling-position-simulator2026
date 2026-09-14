import fs from 'node:fs/promises';
import os from 'node:os';
import {chromium} from '@playwright/test';
import {startServer} from './serve.mjs';

const server=await startServer();
const origin='http://127.0.0.1:'+server.address().port;
let browser;
try {
    browser=await chromium.launch({headless:true});
    const page=await browser.newPage({serviceWorkers:'block'});
    await page.goto(origin);
    const report=await page.evaluate(async() => {
        const [manifest,terrainMeta,weatherBuffer,terrainBuffer,testCase]=await Promise.all([
            fetch('./fixtures/manifest.json').then(r=>r.json()),
            fetch('./fixtures/terrain.json').then(r=>r.json()),
            fetch('./fixtures/weather.bin').then(r=>r.arrayBuffer()),
            fetch('./fixtures/terrain.bin').then(r=>r.arrayBuffer()),
            fetch('./fixtures/case.json').then(r=>r.json())
        ]);
        async function measure(workerCount,count) {
            const slots=Array.from({length:workerCount},()=> {
                const worker=new Worker('./browser-provider.worker.js',{type:'module'});
                let id=0;
                const pending=new Map();
                worker.onmessage=({data})=>{
                    const item=pending.get(data.id);
                    if(!item)return;
                    pending.delete(data.id);
                    data.type==='error'?item.reject(Error(data.error)):item.resolve(data);
                };
                return {worker,call(type,values={}){return new Promise((resolve,reject)=>{
                    const next=++id;pending.set(next,{resolve,reject});worker.postMessage({id:next,type,...values});
                });}};
            });
            await Promise.all(slots.map(slot=>slot.call('load',{manifest,terrainMeta,weatherBuffer,terrainBuffer})));
            await Promise.all(slots.map(async slot=>{for(let i=0;i<5;i++)await slot.call('predict',{testCase});}));
            const begin=performance.now();
            await Promise.all(slots.map(async(slot,lane)=>{
                for(let i=lane;i<count;i+=workerCount)await slot.call('predict',{testCase});
            }));
            const totalMs=performance.now()-begin;
            slots.forEach(slot=>slot.worker.terminate());
            return {workerCount,count,totalMs,averageMs:totalMs/count,
                copiedFixtureBytes:(weatherBuffer.byteLength+terrainBuffer.byteLength)*workerCount};
        }
        const results=[];
        for(const size of [1,2,4])results.push(await measure(size,200));
        return {fixtureBytes:weatherBuffer.byteLength+terrainBuffer.byteLength,results};
    });
    const output={timestamp:new Date().toISOString(),environment:{platform:os.platform(),release:os.release(),
        cpu:os.cpus()[0]?.model,logicalCpus:os.cpus().length,ramBytes:os.totalmem(),chromium:browser.version()},...report};
    await fs.mkdir(new URL('./measurements/',import.meta.url),{recursive:true});
    await fs.writeFile(new URL('./measurements/worker-pool.json',import.meta.url),JSON.stringify(output,null,2)+'\n');
    console.log(JSON.stringify(output,null,2));
} finally {
    if(browser)await browser.close();
    await new Promise(resolve=>server.close(resolve));
}
