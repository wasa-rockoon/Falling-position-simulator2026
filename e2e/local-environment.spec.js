const { test, expect } = require('./fixture-app');
async function managedPage(page) {
    const row={run:'2026090700',valid:true,bytes:9528667200,fingerprint:'a'.repeat(64),forecastStart:'2026-09-07T00:00:00Z',forecastEnd:'2026-09-15T00:00:00Z'};
    const state={tawhiri:'running',busy:false,activePredictions:0,job:null,weather:{revision:'one',freeBytes:80*1024**3,usedBytes:16*1024**3,elevation:{ready:true},datasets:[row],temporary:[]}};
    const mutations=[];
    await page.route('**/__server-info',route=>route.fulfill({json:{app:'Falling-position-simulator2026',localManagement:true}}));
    await page.route('**/local/**',async route=>{
        const req=route.request(),url=new URL(req.url());
        if(req.method()!=='GET'){
            expect(req.headers()['x-local-token']).toBe('test-token');
            mutations.push({path:url.pathname,data:req.postDataJSON()});
        }
        if(url.pathname==='/local/session') return route.fulfill({json:{token:'test-token'}});
        if(url.pathname==='/local/weather/resolve') return route.fulfill({status:422,json:{error:{description:'指定日時を含むGFSがありません。'}}});
        if(url.pathname==='/local/weather/download'){
            state.busy=true;state.job={id:'job',kind:'download',status:'running',stage:'gfs',dataset:row.run,startedAt:new Date().toISOString(),log:'GFS downloading'};
            return route.fulfill({status:202,json:{job:state.job}});
        }
        if(url.pathname==='/local/weather/cancel'){
            state.busy=false;state.job.status='cancelled';state.job.finishedAt=new Date().toISOString();
            return route.fulfill({status:202,json:{job:state.job}});
        }
        if(req.method()==='DELETE'){
            state.weather.datasets=[];state.weather.revision='two';return route.fulfill({json:{deleted:[row.run]}});
        }
        return route.fulfill({json:state});
    });
    await page.reload();
    await expect(page.locator('#local_environment')).toBeVisible();
    await page.locator('#local_environment > summary').click();
    await expect(page.locator('#local_datasets')).toContainText(row.run);
    return {state,mutations};
}
test('GFS削除は対象と容量を確認してから実行し、履歴は保持する',async({app})=>{
    const {page}=app,{mutations}=await managedPage(page);
    await page.evaluate(async()=>{await RunRepository.save(RunRecord.create({id:'keep-history',type:'single',status:'completed',provenance:{localDatasets:[{dataset:'2026-09-07T00:00:00Z',revision:'a',engine:'test'}]}}));});
    await page.getByRole('button',{name:'このGFSを削除'}).click();
    await expect(page.locator('#local_delete_text')).toContainText('2026090700');
    await expect(page.locator('#local_delete_text')).toContainText('GiB');
    expect(mutations).toHaveLength(0);
    await page.locator('#local_delete_cancel').click(); expect(mutations).toHaveLength(0);
    await page.getByRole('button',{name:'このGFSを削除'}).click();
    await page.locator('#local_delete_execute').click();
    await expect(page.locator('#local_datasets')).toContainText('保存済みGFSはありません');
    expect(mutations.filter(x=>x.path==='/local/weather/dataset')).toHaveLength(1);
    expect(await page.evaluate(async()=>Boolean(await RunRepository.get('keep-history')))).toBe(true);
    expect(await page.evaluate(()=>LocalEnvironment.historyNote([{dataset:'2026-09-07T00:00:00Z'}]))).toContain('再取得');
});
test('取得は再読込後も表示され、キャンセル・再実行できる',async({app})=>{
    const {page}=app,{mutations}=await managedPage(page);
    await page.locator('#local_download').click();
    await expect(page.locator('#local_job_status')).toContainText('GFSを取得中');
    await expect(page.getByRole('button',{name:'このGFSを削除'})).toBeDisabled();
    await page.reload(); await page.locator('#local_environment > summary').click();
    await expect(page.locator('#local_job_log')).toHaveText('GFS downloading');
    await page.locator('#local_cancel').click();
    await expect(page.locator('#local_job_status')).toContainText('キャンセル済み');
    await page.locator('#local_retry').click();
    await expect(page.locator('#local_job_status')).toContainText('GFSを取得中');
    expect(mutations.filter(x=>x.path==='/local/weather/download')).toHaveLength(2);
});
test('小さい画面でも状態と日時範囲のエラーを確認できる',async({app})=>{
    const {page}=app;await page.setViewportSize({width:390,height:844});await managedPage(page);
    await app.setBaseSettings();await page.locator('#local_check_date').click();
    await expect(page.locator('#local_date_check')).toContainText('指定日時を含むGFSがありません');
    const overflow=await page.locator('#local_environment').evaluate(node=>node.scrollWidth>node.clientWidth+2);
    expect(overflow).toBe(false);
});
test('通常の静的・公開相当環境では管理パネルを出さない',async({app})=>{
    await expect(app.page.locator('#local_environment')).toBeHidden();
});
