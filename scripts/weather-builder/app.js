'use strict';
const $=id=>document.getElementById(id);
let token='',localBusy=false,localError=false;
const date=new Date(Date.now()-8*3600000);
date.setUTCHours(Math.floor(date.getUTCHours()/6)*6,0,0,0);
$('date').value=date.toISOString().slice(0,10);
$('cycle').value=String(date.getUTCHours()).padStart(2,'0');
$('suggestDatetime').value=new Date(Date.now()+9*3600000).toISOString().slice(0,16);
let suggesting=false;
$('suggest').addEventListener('click',async()=>{
    suggesting=true;$('suggest').disabled=true;
    try {
        const value=$('suggestDatetime').value;
        if(!value)throw Error('放球予定日時を入力してください。');
        const number=id=>{if(!$(id).value.trim())throw Error('数値を入力してください。');return Number($(id).value);};
        const result=await request('/api/suggest',JSON.stringify({
            launchDatetime:new Date(value+':00+09:00').toISOString(),
            latitude:number('suggestLatitude'),longitude:number('suggestLongitude'),
            durationHours:number('suggestDuration'),marginDegrees:number('suggestMargin')
        }));
        $('date').value=result.input.run.slice(0,10);$('cycle').value=result.input.run.slice(11,13);
        for(const field of ['south','north','west','east','firstHour','lastHour'])$(field).value=result.input[field];
        const jst=t=>new Date(Date.parse(t)+9*3600000).toISOString().slice(0,16).replace('T',' ');
        $('suggestResult').textContent='対応時間: '+jst(result.start)+'〜'+jst(result.end)+' JST未満。容量上限目安 '+(result.bytesUpperBound/1048576).toFixed(2)+' MiB。'+result.warning;
    }catch(e){$('suggestResult').textContent=e.message;}
    finally{suggesting=false;$('suggest').disabled=false;}
});
function error(e){localError=true;$('message').textContent=e.message;}
async function request(url,body,type='application/json'){
    const response=await fetch(url,{method:'POST',headers:{'Content-Type':type,'X-WASA-Token':token},body});
    const data=await response.json();if(!response.ok)throw Error(data.error);return data;
}
async function status(){
    const response=await fetch('/api/status');if(!response.ok)throw Error('作成サーバーに接続できません。');
    const s=await response.json();token=s.token;
    $('terrain').textContent=`使用可能な標高: 緯度 ${s.terrain.south}〜${s.terrain.north} / 経度 ${s.terrain.west}〜${s.terrain.east}`;
    const running=s.state==='running';
    $('suggest').disabled=running||localBusy||suggesting;
    $('build').disabled=running||localBusy;$('cancel').disabled=!running;
    $('terrainFile').disabled=running||localBusy;$('resetTerrain').disabled=running||localBusy;
    $('download').hidden=!s.downloadReady;
    if(!localError&&(running||s.state==='completed'||s.state==='failed'))$('message').textContent=s.message+(s.bytes?` (${(s.bytes/1048576).toFixed(2)} MiB)`:'');
    return s;
}
$('form').addEventListener('submit',async event=>{
    event.preventDefault();localError=false;localBusy=true;$('build').disabled=true;
    try{
        const data={run:$('date').value+'T'+$('cycle').value+':00:00Z'};
        for(const field of ['south','north','west','east','firstHour','lastHour'])data[field]=Number($(field).value);
        await request('/api/build',JSON.stringify(data));await status();
    }catch(e){error(e);}
    finally{localBusy=false;}
});
$('terrainFile').addEventListener('change',async()=>{
    const file=$('terrainFile').files[0];if(!file)return;
    localError=false;localBusy=true;
    try{
        if(file.size>64*1048576)throw Error('上限は64MiBです。');
        await request('/api/terrain',file,'application/octet-stream');
        $('message').textContent='標高を切り替えました。取得地域は自動変更していません。';
    }catch(e){error(e);}
    finally{localBusy=false;$('terrainFile').value='';await status().catch(error);}
});
$('resetTerrain').onclick=async()=>{localError=false;try{await request('/api/reset-terrain','{}');await status();}catch(e){error(e);}};
$('cancel').onclick=async()=>{try{await request('/api/cancel','{}');}catch(e){error(e);}};
async function poll(){try{await status();}catch(e){error(e);}setTimeout(poll,1000);}
poll();