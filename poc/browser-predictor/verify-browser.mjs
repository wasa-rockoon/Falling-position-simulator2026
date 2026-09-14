import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import {chromium} from '@playwright/test';
import {startServer} from './serve.mjs';
const server=await startServer();
const origin='http://127.0.0.1:'+server.address().port;
let browser;
try {
    browser=await chromium.launch({headless:true});
    const context=await browser.newContext({serviceWorkers:'block'});
    const requests=[],errors=[],workers=[];
    await context.route('**/*',route=>{
        const url=route.request().url();
        requests.push(url);
        if(!url.startsWith(origin+'/')) return route.abort();
        return route.continue();
    });
    const page=await context.newPage();
    page.on('pageerror',e=>errors.push(e.message));
    page.on('worker',w=>workers.push(w.url()));
    await page.goto(origin);
    const loaded=await page.evaluate(()=>window.poc.ready);
    assert.equal(loaded.pass,true);
    assert.equal(workers.length,1,'exactly one Dedicated Worker');
    const once=await page.evaluate(()=>window.poc.calculate(1));
    assert.equal(once.comparison.pass,true);
    // From this point no request may be made, even to localhost.
    const before=requests.length;
    await context.setOffline(true);
    const hundred=await page.evaluate(()=>window.poc.calculate(100));
    const again=await page.evaluate(()=>window.poc.calculate(1));
    assert.equal(hundred.performance.count,100);
    assert.equal(hundred.comparison.pass,true);
    assert.equal(again.comparison.pass,true);
    assert.deepEqual(again.result,once.result);
    assert.deepEqual(hundred.result,once.result);
    assert.equal(requests.length,before,'no requests after loading fixtures');
    assert.ok(requests.every(url=>url.startsWith(origin+'/')),'no external API requests');
    assert.equal(workers.length,1,'same single Worker reused');
    assert.deepEqual(errors,[]);
    await fs.mkdir(new URL('./results/',import.meta.url),{recursive:true});
    const report={timestamp:new Date().toISOString(),environment:{platform:os.platform(),release:os.release(),cpu:os.cpus()[0]?.model,
        logicalCpus:os.cpus().length,ramBytes:os.totalmem(),node:process.version,chromium:browser.version(),headless:true},
        interpolation:{maxWindError:loaded.maxWindError,maxTerrainError:loaded.maxTerrainError,maxDescentError:loaded.maxDescentError,samples:loaded.wind.length},
        single:once.performance,hundred:hundred.performance,comparison:once.comparison,
        offline:{pass:true,additionalRequests:requests.length-before,sameWorker:true},requests};
    await fs.writeFile(new URL('./results/browser-verification.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
    await fs.writeFile(new URL('./results/browser-trajectory.json',import.meta.url),JSON.stringify(once.result,null,2)+'\n');
    await page.screenshot({path:new URL('./results/poc.png',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1'),fullPage:true});
    console.log(JSON.stringify({...report,comparison:report.comparison.metrics,requests:requests.length},null,2));
} finally {
    if(browser) await browser.close();
    await new Promise(resolve=>server.close(resolve));
}
