const http=require('node:http');
const fs=require('node:fs/promises');
const path=require('node:path');
const {randomBytes}=require('node:crypto');
const {execFile}=require('node:child_process');
const Package=require('../../js/pred/weather-package.js');
const {plan,arrayBuffer}=require('./plan.cjs');
const {build}=require('./build.cjs');
const {suggest}=require('./suggest.cjs');
const ROOT=path.resolve(__dirname,'../..');
async function builtin(){
    const terrainMeta=JSON.parse(await fs.readFile(path.join(ROOT,'poc/browser-predictor/fixtures/terrain.json'),'utf8'));
    const terrainBuffer=arrayBuffer(await fs.readFile(path.join(ROOT,'poc/browser-predictor/fixtures/terrain.bin')));
    return {terrainMeta,terrainBuffer};
}
function terrainInfo(t){
    const m=t.terrainMeta,west=((m.firstGlobalColumn/240-180)%360+360)%360;
    return {south:90-(m.firstGlobalRow+m.rows-1)/240,north:90-m.firstGlobalRow/240,
        west,east:west+(m.columns-1)/240,sha256:m.sha256};
}
async function body(req,max){
    if(Number(req.headers['content-length'])>max)throw Error('入力サイズが上限を超えました。');
    let size=0;const chunks=[];
    for await(const chunk of req){size+=chunk.length;if(size>max)throw Error('入力サイズが上限を超えました。');chunks.push(chunk);}
    return Buffer.concat(chunks);
}
async function createServer(options={}){
    let terrain=await builtin(),status={state:'idle',message:'作成条件を入力してください。'},output=null,controller=null,active=null,uploading=false;
    const token=randomBytes(24).toString('hex');
    const runBuild=options.build || build;
    const server=http.createServer(async(req,res)=>{
        const port=server.address().port;
        const hosts=[`127.0.0.1:${port}`,`localhost:${port}`];
        const json=(code,value)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
        try{
            if(!hosts.includes(req.headers.host))return json(403,{error:'Hostを確認してください。'});
            const url=new URL(req.url,'http://127.0.0.1');
            if(req.method==='GET' && url.pathname==='/api/status')return json(200,{...status,terrain:terrainInfo(terrain),token,downloadReady:Boolean(output)});
            if(req.method==='GET' && url.pathname==='/package.wasawx'){
                if(!output)return json(404,{error:'作成済みパッケージがありません。'});
                res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':'attachment; filename="regional-weather.wasawx"','Cache-Control':'no-store'});
                return res.end(output);
            }
            if(req.method==='GET' && ['/', '/app.js'].includes(url.pathname)){
                res.writeHead(200,{'Content-Type':url.pathname==='/'?'text/html; charset=utf-8':'text/javascript; charset=utf-8',
                    'Content-Security-Policy':"default-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
                    'Cache-Control':'no-store'});
                return res.end(await fs.readFile(path.join(__dirname,url.pathname==='/'?'index.html':'app.js')));
            }
            if(req.method!=='POST')return json(404,{error:'Not found'});
            if(!hosts.some(host=>req.headers.origin==='http://'+host)||req.headers['x-wasa-token']!==token)return json(403,{error:'この画面から操作してください。'});
            if(url.pathname==='/api/cancel'){controller?.abort();return json(200,{ok:true});}
            if(active||uploading)return json(409,{error:'実行中です。完了または中止を待ってください。'});
            if(url.pathname==='/api/suggest'){
                const input=JSON.parse((await body(req,4096)).toString('utf8'));
                return json(200,suggest(input,terrain));
            }
            if(url.pathname==='/api/terrain'){
                uploading=true;
                try{
                    const parsed=await Package.decode(arrayBuffer(await body(req,Package.maxBytes)));
                    terrain={terrainMeta:parsed.terrainMeta,terrainBuffer:parsed.terrainBuffer};
                    status={state:'idle',message:'標高を切り替えました。'};output=null;
                    return json(200,{terrain:terrainInfo(terrain)});
                } finally{uploading=false;}
            }
            if(url.pathname==='/api/reset-terrain'){
                uploading=true;
                try{terrain=await builtin();status={state:'idle',message:'同梱の標高に戻しました。'};output=null;return json(200,{terrain:terrainInfo(terrain)});}
                finally{uploading=false;}
            }
            if(url.pathname==='/api/build'){
                uploading=true;
                try {
                const input=JSON.parse((await body(req,4096)).toString('utf8'));
                const p=plan(input,terrain);
                controller=new AbortController();output=null;
                status={state:'running',message:'準備中',plan:p};
                const snapshot=terrain,signal=controller.signal;
                active=Promise.resolve().then(()=>runBuild(p,snapshot,{signal,onProgress:message=>{status.message=message;}}))
                    .then(bytes=>{output=bytes;status={state:'completed',message:'作成完了。パッケージを保存してください。',plan:p,bytes:bytes.length};})
                    .catch(error=>{status={state:'failed',message:error.message};})
                    .finally(()=>{active=null;controller=null;});
                return json(202,{ok:true,plan:p});
                } finally {uploading=false;}
            }
            return json(404,{error:'Not found'});
        }catch(error){if(!res.headersSent)json(400,{error:error.message});else res.end();}
    });
    server.stopBuild=async()=>{controller?.abort();await active;};
    return server;
}
if(require.main===module){
    createServer().then(server=>{
        const port=Number(process.env.WEATHER_BUILDER_PORT||3101);
        server.on('error',error=>{console.error(error.code==='EADDRINUSE'?'3101番ポートが使用中です。既に開いている作成画面を確認してください。':error.message);process.exitCode=1;});
        server.listen(port,'127.0.0.1',()=>{
            const url=`http://127.0.0.1:${server.address().port}`;
            console.log('地域GFSパッケージ作成: '+url+'\n停止: Ctrl+C');
            if(process.argv.includes('--open')&&process.platform==='win32')execFile('cmd.exe',['/d','/c','start','',url],{windowsHide:true});
        });
        process.on('SIGINT',async()=>{await server.stopBuild();server.close();});
    }).catch(error=>{console.error(error);process.exitCode=1;});
}
module.exports={createServer,builtin,terrainInfo};