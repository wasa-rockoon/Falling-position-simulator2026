const {createHash}=require('node:crypto');
const Package=require('../../js/pred/weather-package.js');
const LEVELS=[1000,975,950,925,900,875,850,825,800,775,750,725,700,675,650,625,600,575,550,525,500,475,450,425,400,375,350,325,300,275,250,225,200,175,150,125,100,70,50,30,20,10,7,5,3,2,1];
function check(ok,message){if(!ok)throw Error(message);}
const hash=b=>createHash('sha256').update(new Uint8Array(b)).digest('hex');
const arrayBuffer=b=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);
function plan(input,terrain,now=Date.now()){
    const run=input.run;
    check(typeof run==='string' && /^\d{4}-\d\d-\d\dT(?:00|06|12|18):00:00Z$/.test(run) &&
        Number.isFinite(Date.parse(run)) && new Date(run).toISOString().replace('.000Z','Z')===run,'GFS runはUTCの00/06/12/18時を指定してください。');
    check(Date.parse(run)<=now,'未来のGFS runはまだ取得できません。');
    const {south,north,west,east,firstHour,lastHour}=input;
    check([south,north,west,east,firstHour,lastHour].every(x=>typeof x==='number' && Number.isFinite(x)),'数値入力を確認してください。');
    check(south>=-90 && north<=90 && west>=0 && east<=359.5 && south<north && west<east &&
        [south,north,west,east].every(x=>Number.isInteger(x*2)),'地域は0.5度刻み、経度0〜359.5度で指定してください。');
    check(north-south<=10 && east-west<=10,'取得地域は緯度・経度それぞれ最大10度幅です。');
    check(firstHour>=0 && lastHour<=192 && firstHour<lastHour &&
        firstHour%3===0 && lastHour%3===0 && lastHour-firstHour<=72,'予報時間は0〜192時間の3時間刻み、最大72時間幅で指定してください。');
    const t=terrain.terrainMeta, minLat=90-(t.firstGlobalRow+t.rows-1)/240, maxLat=90-t.firstGlobalRow/240;
    const minLon=((t.firstGlobalColumn/240-180)%360+360)%360, maxLon=minLon+(t.columns-1)/240;
    check(south>=minLat && north<=maxLat && west>=minLon && east<=maxLon,'指定地域を覆う標高がありません。地域を標高範囲内にするか、別の標高パッケージを読み込んでください。');
    const hours=Array.from({length:(lastHour-firstHour)/3+1},(_,i)=>firstHour+i*3);
    const rows=(north-south)*2+1,columns=(east-west)*2+1;
    const weatherBytes=hours.length*47*3*rows*columns*4;
    const terrainBytes=((north-south)*240+1)*((east-west)*240+1)*2;
    check(weatherBytes+terrainBytes+256*1024+12<=Package.maxBytes,'出力が64MiBを超えます。地域・予報時間を狭めてください。');
    return {run,south,north,west,east,hours,rows,columns,weatherBytes,terrainBytes};
}
function urlFor(p,hour){
    check(p.hours.includes(hour),'予報時刻が不正です。');
    const date=p.run.slice(0,10).replaceAll('-',''),cycle=p.run.slice(11,13);
    const url=new URL('https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_0p50.pl');
    const q=url.searchParams;
    q.set('file',`gfs.t${cycle}z.pgrb2full.0p50.f${String(hour).padStart(3,'0')}`);
    q.set('dir',`/gfs.${date}/${cycle}/atmos`);
    for(const v of ['UGRD','VGRD','HGT'])q.set('var_'+v,'on');
    for(const level of LEVELS)q.set('lev_'+level+'_mb','on');
    q.set('subregion','');q.set('leftlon',p.west);q.set('rightlon',p.east);q.set('bottomlat',p.south);q.set('toplat',p.north);
    return url.href;
}
function cropTerrain(p,terrain){
    const source=terrain.terrainMeta;
    const firstGlobalRow=Math.round((90-p.north)*240);
    const firstGlobalColumn=Math.round(((p.west+180)%360)*240);
    const rows=Math.round((p.north-p.south)*240)+1,columns=Math.round((p.east-p.west)*240)+1;
    const rowOffset=firstGlobalRow-source.firstGlobalRow,columnOffset=firstGlobalColumn-source.firstGlobalColumn;
    check(rowOffset>=0 && columnOffset>=0 && rowOffset+rows<=source.rows && columnOffset+columns<=source.columns,'標高範囲が不正です。');
    const output=new Uint8Array(rows*columns*2), input=new Uint8Array(terrain.terrainBuffer);
    for(let row=0;row<rows;row++){
        const start=((row+rowOffset)*source.columns+columnOffset)*2;
        output.set(input.subarray(start,start+columns*2),row*columns*2);
    }
    return {terrainMeta:{dtype:'int16-le',samplesPerDegree:240,firstGlobalRow,firstGlobalColumn,rows,columns,
        file:'terrain.bin',bytes:output.byteLength,sha256:hash(output.buffer),
        source:{...source.source,parentCropSha256:source.sha256}},
        terrainBuffer:output.buffer};
}
module.exports={LEVELS,plan,urlFor,cropTerrain,hash,arrayBuffer};