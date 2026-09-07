const {_electron:electron,expect}=require('playwright/test');
const http=require('node:http');const {once}=require('node:events');const path=require('node:path');const assert=require('node:assert/strict');
(async()=>{
 const server=http.createServer((_req,res)=>res.end('existing app'));server.listen(3100,'127.0.0.1');await once(server,'listening');let app;
 try{
 app=await electron.launch({executablePath:path.resolve('out/WASA Falling Position Simulator-win32-x64/WasaSimulator.exe'),timeout:60000});const page=await app.firstWindow();
 await expect(page.locator('#status')).toContainText('3100番ポートは使用中',{timeout:30000});
 const closed=app.waitForEvent('close',{timeout:30000});await app.evaluate(({BrowserWindow})=>{BrowserWindow.getAllWindows()[0].close();});await closed;app=null;
 assert.equal(await(await fetch('http://127.0.0.1:3100')).text(),'existing app');console.log('Occupied port: Japanese error, existing server preserved after app close.');
 }finally{if(app)await app.close().catch(()=>{});await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1});
