const fs=require('node:fs/promises');
const path=require('node:path');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const {setTimeout:delay}=require('node:timers/promises');
const {randomUUID}=require('node:crypto');
const Package=require('../../js/pred/weather-package.js');
const {urlFor,cropTerrain,hash,arrayBuffer}=require('./plan.cjs');
const exec=promisify(execFile);
const ROOT=path.resolve(__dirname,'../..');
const WORK=path.join(ROOT,'.weather-builder','jobs');
const IMAGE='python:3.12-slim-bookworm@sha256:782412e85d0f0984994c290652577d4018aff08145c85b262bb63dc0c7522254';
const VOLUME='wasa-weather-builder-python312-v1';
let nextFetch=0;
async function docker(args,signal,timeout=600000){
    return exec('docker',args,{windowsHide:true,signal,timeout,maxBuffer:1024*1024});
}
async function environment(signal,onProgress,name){
    try {
        const version=await docker(['version','--format','{{.Server.Os}}'],signal,15000);
        if(version.stdout.trim()!=='linux')throw Error('Linux containers required');
    } catch(error){
        if(signal.aborted)throw error;
        throw Error('Docker Desktopを起動し、Linuxコンテナ / WSL2 backendを有効にしてください。');
    }
    onProgress('変換環境を確認中（初回はDocker imageを取得）');
    try{await docker(['image','inspect',IMAGE],signal,15000);}
    catch(error){if(signal.aborted)throw error; await docker(['pull',IMAGE],signal);}
    const mount=['--mount',`type=volume,source=${VOLUME},target=/deps`];
    const check=['run','--rm','--name',name,'--network','none',...mount,'-e','PYTHONPATH=/deps',IMAGE,'python','-c',
        "import eccodes,numpy,importlib.metadata as m; assert m.version('eccodes')=='2.48.0' and m.version('eccodeslib')=='2.48.2.27' and numpy.__version__=='2.4.6'; print(eccodes.codes_get_api_version())"];
    try{await docker(check,signal,30000);}
    catch(error){
        if(signal.aborted)throw error;
        onProgress('変換ライブラリを準備中（初回のみ。ソースビルドなし）');
        await docker(['run','--rm','--name',name,...mount,
            '--mount',`type=bind,source=${__dirname},target=/scripts,readonly`,
            IMAGE,'python','-m','pip','install','--only-binary=:all:','--no-cache-dir','--upgrade','--target','/deps','-r','/scripts/requirements.txt'],signal);
        await docker(check,signal,30000);
    }
}
async function download(url,signal){
    const wait=Math.max(0,nextFetch-Date.now());
    if(wait)await delay(wait,undefined,{signal});
    const timeout=AbortSignal.timeout(120000);
    const combined=AbortSignal.any([signal,timeout]);
    try{
        const response=await fetch(url,{signal:combined,redirect:'error'});
        if(!response.ok){
            await response.body?.cancel();
            throw Error(`NOAA取得失敗 (HTTP ${response.status})。run/予報時間が公開済みか確認してください。古いrunの公開終了や一時的な混雑でも発生します。`);
        }
        if(Number(response.headers.get('content-length'))>32*1024*1024){
            await response.body.cancel();throw Error('取得データが上限32MiBを超えました。');
        }
        const chunks=[];let length=0;
        for await(const chunk of response.body){
            length+=chunk.length;
            if(length>32*1024*1024){throw Error('取得データが上限32MiBを超えました。地域を狭めてください。');}
            chunks.push(chunk);
        }
        const bytes=Buffer.concat(chunks);
        if(bytes.length<16||bytes.toString('ascii',0,4)!=='GRIB'||bytes[7]!==2||bytes.toString('ascii',bytes.length-4)!=='7777')
            throw Error('NOAAからGRIB2以外の応答が返りました。公開状況を確認して後ほど再実行してください。');
        return bytes;
    } finally {nextFetch=Date.now()+10000;}
}
async function build(p,terrain,{signal,onProgress=()=>{},offlineSource=null}){
    await fs.mkdir(WORK,{recursive:true});
    const directory=await fs.mkdtemp(path.join(WORK,'job-'));
    const name='wasa-weather-'+randomUUID();
    try{
        await environment(signal,onProgress,name);
        await fs.writeFile(path.join(directory,'plan.json'),JSON.stringify(p));
        const sources=[];
        for(const [i,hour] of p.hours.entries()){
            signal.throwIfAborted();
            onProgress(`GFS f${hour}を取得中 (${i+1}/${p.hours.length}) — NOAAへの取得間隔は10秒以上`);
            const url=urlFor(p,hour);
            const bytes=offlineSource?await fs.readFile(path.join(offlineSource,`f${hour}.grib2`)):await download(url,signal);
            await fs.writeFile(path.join(directory,`f${hour}.grib2`),bytes);
            sources.push({forecastHour:hour,url,sha256:hash(arrayBuffer(bytes)),bytes:bytes.length,
                retrievedAt:new Date().toISOString(),...(offlineSource?{offlineReplay:true}:{} )});
        }
        await fs.writeFile(path.join(directory,'sources.json'),JSON.stringify(sources));
        onProgress('取得したGRIBを検証・変換中（オフラインコンテナ）');
        await docker(['run','--rm','--name',name,'--network','none','--memory','512m','--cpus','2',
            '--mount',`type=volume,source=${VOLUME},target=/deps,readonly`,
            '--mount',`type=bind,source=${__dirname},target=/scripts,readonly`,
            '--mount',`type=bind,source=${directory},target=/work`,
            '-e','PYTHONPATH=/deps',IMAGE,'python','/scripts/convert.py','/work'],signal,180000);
        const manifest=JSON.parse(await fs.readFile(path.join(directory,'manifest.json'),'utf8'));
        manifest.conversion.dockerImage=IMAGE;
        onProgress('標高を切り出し、パッケージを検証中');
        const data={manifest,weatherBuffer:arrayBuffer(await fs.readFile(path.join(directory,'weather.bin'))),
            ...cropTerrain(p,terrain),sampleCase:null};
        return Buffer.from(await Package.encode(data));
    } catch(error){
        if(signal.aborted)throw Error('作成を中止しました。');
        if(error.stderr)throw Error('GRIB変換環境でエラーが発生しました: '+error.stderr.slice(-1800));
        throw error;
    } finally {
        // Stop only this job's uniquely named container before removing its files.
        await exec('docker',['rm','-f',name],{windowsHide:true,timeout:15000}).catch(()=>{});
        const resolved=path.resolve(directory);
        if(resolved.startsWith(path.resolve(WORK)+path.sep))await fs.rm(resolved,{recursive:true,force:true});
    }
}
module.exports={build,IMAGE,VOLUME,download};