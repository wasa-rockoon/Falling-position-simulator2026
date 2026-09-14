/* Developer-only verification. Reads an existing package; never downloads GFS. */
const fs=require('node:fs/promises');
const http=require('node:http');
const path=require('node:path');
const assert=require('node:assert/strict');
const {once}=require('node:events');
const {chromium}=require('@playwright/test');
const ROOT=path.resolve(__dirname,'../..');
(async()=>{
 const packagePath=path.resolve(process.argv[2]||'.weather-builder/live-2026091200.wasawx');
 await fs.access(packagePath);
 const server=http.createServer(async(req,res)=>{
   const pathname=new URL(req.url,'http://localhost').pathname;
   if(pathname==='/'){res.setHeader('Content-Type','text/html');res.end('<input id="package" type="file"><script src="/js/pred/weather-package.js"></script><script src="/js/pred/browser-predictor-provider.js"></script>');return;}
   const filename=path.resolve(ROOT,'.'+decodeURIComponent(pathname));
   if(!filename.startsWith(ROOT+path.sep)){res.writeHead(403);res.end();return;}
   try{res.setHeader('Content-Type','application/javascript');res.end(await fs.readFile(filename));}
   catch{res.writeHead(404);res.end();}
 });
 server.listen(0,'127.0.0.1');await once(server,'listening');
 let browser;
 try{
   browser=await chromium.launch();
   const page=await browser.newPage();
   const requests=[],workers=[];
   page.on('request',r=>requests.push(r.url()));page.on('worker',w=>workers.push(w.url()));
   const origin='http://127.0.0.1:'+server.address().port;
   await page.goto(origin);
   await page.locator('#package').setInputFiles(packagePath);
   const first=await page.evaluate(async()=>{
     window.client=BrowserPredictor.getClient();
     await client.importPackage(document.getElementById('package').files[0]);
     const d=client.describe();
     window.params={pred_type:'single',profile:'standard_profile',launch_latitude:33.13492,launch_longitude:132.50477,
       launch_altitude:100,launch_datetime:new Date(Date.parse(d.coverage.start)+90*60000).toISOString(),
       ascent_rate:5,descent_rate:5,burst_altitude:30000};
     return (await client.request(params,{label:'single'})).data;
   });
   const before=requests.length;
   await page.context().setOffline(true);
   const second=await page.evaluate(async()=>(await client.request(params,{label:'single'})).data);
   assert.deepEqual(first.prediction,second.prediction);
   assert.equal(requests.length,before);assert.equal(workers.length,1);
   assert.ok(requests.every(url=>url.startsWith(origin)));
   const report={packagePath,provenance:first.metadata.provenance,
     pointCount:first.prediction.reduce((n,s)=>n+s.trajectory.length,0),
     landing:first.prediction.at(-1).trajectory.at(-1),workerCount:workers.length,
     externalPredictionApiCalls:0,offlineAdditionalRequests:requests.length-before};
   await fs.writeFile(path.join(ROOT,'.weather-builder/verification-live.json'),JSON.stringify(report,null,2));
   console.log(JSON.stringify(report,null,2));
 }finally{await browser?.close();server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});