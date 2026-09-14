const {test,expect}=require('@playwright/test');
const {once}=require('node:events');
const fs=require('node:fs/promises');
const Package=require('../js/pred/weather-package.js');
const {createServer}=require('../scripts/weather-builder/server.cjs');
test('地域データ作成画面で範囲エラーを表示し、完成パッケージを保存できる',async({page})=>{
 const dir='poc/browser-predictor/fixtures/';
 const ab=b=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);
 const bytes=Buffer.from(await Package.encode({
   manifest:JSON.parse(await fs.readFile(dir+'manifest.json','utf8')),
   terrainMeta:JSON.parse(await fs.readFile(dir+'terrain.json','utf8')),
   weatherBuffer:ab(await fs.readFile(dir+'weather.bin')),terrainBuffer:ab(await fs.readFile(dir+'terrain.bin'))
 }));
 let calls=0;
 const server=await createServer({build:async p=>{expect(p.hours).toEqual([3,6,9]);calls++;return bytes;}});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 try{
   await page.goto('http://127.0.0.1:'+server.address().port);
   await expect(page.locator('#terrain')).toContainText('緯度 32〜35');
   await page.locator('#date').fill('2026-09-12');
   await page.locator('#cycle').selectOption('00');
   await page.locator('#north').fill('36');
   await page.locator('#build').click();
   await expect(page.locator('#message')).toContainText('標高がありません');
   expect(calls).toBe(0);
   await page.locator('#north').fill('35');
   await page.locator('#build').click();
   await expect(page.locator('#message')).toContainText('作成完了');
   const pending=page.waitForEvent('download');
   await page.locator('#download').click();
   const file=await pending;
   expect(await fs.readFile(await file.path())).toEqual(bytes);
   expect(calls).toBe(1);
   await page.locator('#terrainFile').setInputFiles({name:'bad.wasawx',mimeType:'application/octet-stream',buffer:Buffer.from('bad')});
   await expect(page.locator('#message')).toContainText('気象パッケージ');
   await expect(page.locator('#terrain')).toContainText('緯度 32〜35');
 }finally{await page.close();await server.stopBuild();server.close();}
});

test('取得条件の提案はGFS取得を開始せず、JSTと標高範囲を検証する',async({page})=>{
 const server=await createServer({build:async()=>{throw Error('提案中に作成は開始されません');}});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 try{
  await page.goto('http://127.0.0.1:'+server.address().port);
  await expect(page.locator('#terrain')).toContainText('緯度 32〜35');
  await page.locator('#suggestDatetime').fill('2026-09-13T13:30');
  await page.locator('#suggest').click();
  await expect(page.locator('#suggestResult')).toContainText('容量上限目安');
  await expect(page.locator('#south')).toHaveValue('32.5');
  await expect(page.locator('#north')).toHaveValue('34');
  await expect(page.locator('#west')).toHaveValue('132');
  await expect(page.locator('#east')).toHaveValue('133.5');
  await page.locator('#suggestLatitude').fill('36');
  await page.locator('#suggest').click();
  await expect(page.locator('#suggestResult')).toContainText('標高がありません');
 }finally{await page.close();await server.stopBuild();server.close();}
});
