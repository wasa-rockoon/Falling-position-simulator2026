// Run explicitly against a packaged app and existing usable Docker datasets.
const { _electron: electron, expect } = require('playwright/test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const root = path.resolve(__dirname, '..');
const executablePath = path.join(root, 'out/WASA Falling Position Simulator-win32-x64/WasaSimulator.exe');
async function open() {
    const app = await electron.launch({ executablePath, timeout: 60000 });
    const page = await app.firstWindow();
    await page.waitForURL('http://localhost:3100/**', { timeout: 120000 });
    await page.locator('#local_environment').waitFor({state:'visible',timeout:30000});
    return {app,page};
}
async function close(app) {
    const closed=app.waitForEvent('close',{timeout:60000});
    await app.evaluate(({BrowserWindow})=>{BrowserWindow.getAllWindows()[0].close();});
    await closed;
}
(async()=>{
    let current;
    try {
        current=await open(); const {app,page}=current;
        const errors=[];page.on('pageerror',e=>errors.push(e.message));
        const before=await page.evaluate(()=>window.RunRepository.listHistory());
        await page.evaluate(async()=>{
            const status=await(await fetch('/local/status')).json();
            const run=status.weather.datasets.filter(d=>d.valid).sort((a,b)=>b.run.localeCompare(a.run))[0];
            if(!run)throw Error('Download weather before running smoke test');
            const time=new Date(Date.parse(run.forecastStart)+10*3600000);
            const values={year:time.getUTCFullYear(),month:time.getUTCMonth()+1,day:time.getUTCDate(),hour:time.getUTCHours(),min:0,lat:33.1333,lon:132.5052,initial_alt:100,ascent:5,drag:5,burst:1000,flight_profile:'standard_profile',prediction_type:'single',api_source:'local'};
            for(const [id,value] of Object.entries(values)){const input=document.getElementById(id);input.value=String(value);input.dispatchEvent(new Event('change',{bubbles:true}));}
        });
        await page.locator('#run_pred_btn').click();
        await expect(page.locator('#results_status_badge')).toHaveText('完了',{timeout:120000});
        const history=await page.evaluate(()=>window.RunRepository.listHistory());
        assert.ok(history.length>before.length,'prediction history saved');
        const output=path.join(root,'local/.runtime/desktop-smoke-'+Date.now()+'.csv');
        await app.evaluate(({session},file)=>{session.fromPartition('persist:wasa-simulator').once('will-download',(_event,item)=>item.setSavePath(file));},output);
        await page.locator('.sidebar-tab[data-panel="panel-results"]').click();
        await page.locator('#dlcsv').click();
        for(let n=0;n<100&&!fs.existsSync(output);n++)await new Promise(r=>setTimeout(r,100));
        assert.match(fs.readFileSync(output,'utf8'),/latitude,longitude,altitude_m/,'CSV content');
        const kmlOutput=output.replace(/csv$/, 'kml');
        await app.evaluate(({session},file)=>{session.fromPartition('persist:wasa-simulator').once('will-download',(_event,item)=>item.setSavePath(file));},kmlOutput);
        await page.locator('#dlkml').click();
        for(let n=0;n<100&&!fs.existsSync(kmlOutput);n++)await new Promise(r=>setTimeout(r,100));
        assert.match(fs.readFileSync(kmlOutput,'utf8'),/<kml/,'KML content');assert.deepEqual(errors,[]);
        await close(app);current=null;
        current=await open();
        const restored=await current.page.evaluate(()=>window.RunRepository.listHistory());
        assert.ok(restored.length>=history.length,'history survives app restart');
        await close(current.app);current=null;
        await assert.rejects(fetch('http://127.0.0.1:3100/__server-info'));
        console.log('Packaged Electron: real prediction, CSV/KML, history persistence, restart and owned server shutdown passed.');
    } finally {if(current)await current.app.close().catch(()=>{});}
})().catch(error=>{console.error(error);process.exitCode=1;});
