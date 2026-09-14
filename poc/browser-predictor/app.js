const status=document.querySelector('#status'), output=document.querySelector('#output');
const worker=new Worker('./predictor.worker.js',{type:'module'});
let serial=0;
const pending=new Map();
worker.onmessage=({data})=>{
    const p=pending.get(data.id);if(!p) return;
    pending.delete(data.id);
    if(data.type==='error') p.reject(Error(data.error));else p.resolve(data);
};
worker.onerror=event=>{
    for(const p of pending.values()) p.reject(Error(event.message));
    pending.clear();
};
function call(type,args={},transfer=[]) {
    return new Promise((resolve,reject)=>{
        const id=++serial;pending.set(id,{resolve,reject});
        worker.postMessage({id,type,...args},transfer);
    });
}
async function get(name,json=true) {
    const r=await fetch('./fixtures/'+name);
    if(!r.ok) throw Error('Fixture load failed: '+name);
    return json?r.json():r.arrayBuffer();
}
async function verify(buffer,expected,name) {
    const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',buffer))].map(x=>x.toString(16).padStart(2,'0')).join('');
    if(hash!==expected) throw Error('Fixture hash mismatch: '+name);
}
let loaded;
async function initialize() {
    const [manifest,terrainMeta,testCase,reference,weatherBuffer,terrainBuffer,caseBuffer]=await Promise.all([
        get('manifest.json'),get('terrain.json'),get('case.json'),get('reference.json'),get('weather.bin',false),get('terrain.bin',false),get('case.json',false)]);
    await verify(weatherBuffer,manifest.sha256,'weather');
    await verify(terrainBuffer,terrainMeta.sha256,'terrain');
    await verify(caseBuffer,reference.caseSha256,'case');
    if(reference.weatherSha256!==manifest.sha256||reference.terrainSha256!==terrainMeta.sha256) throw Error('Reference uses different fixtures');
    loaded=await call('load',{manifest,terrainMeta,testCase,reference,weatherBuffer,terrainBuffer},[weatherBuffer,terrainBuffer]);
    if(!loaded.pass) throw Error('Interpolation/terrain/descent comparison failed');
    status.textContent='準備完了：固定fixtureを読み込みました。以降の計算はオフラインで実行できます。';
    output.textContent=JSON.stringify(loaded,null,2);
    document.querySelectorAll('button').forEach(b=>b.disabled=false);
    return loaded;
}
let busy=false;
async function calculate(count) {
    if(busy) throw Error('Calculation already running');
    busy=true;
    document.querySelectorAll('button').forEach(b=>b.disabled=true);
    status.textContent=count+'回を同じWorkerで計算しています…';
    try {
        const result=await call('calculate',{count});
        output.textContent=JSON.stringify({performance:result.performance,comparison:{...result.comparison,trajectoryErrors:undefined}},null,2);
        status.textContent=result.comparison.pass?'PASS：同一fixtureで1m / 1sの比較基準を満たしました。':'FAIL：比較結果を確認してください。';
        window.poc.last=result;
        return result;
    } finally {busy=false;document.querySelectorAll('button').forEach(b=>b.disabled=false);}
}
window.poc={ready:initialize(),calculate};
window.poc.ready.catch(error=>{status.textContent='エラー：'+error.message;});
document.querySelector('#once').onclick=()=>calculate(1).catch(e=>status.textContent=e.message);
document.querySelector('#hundred').onclick=()=>calculate(100).catch(e=>status.textContent=e.message);
