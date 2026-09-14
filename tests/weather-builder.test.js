const test=require('node:test');
const assert=require('node:assert/strict');
const {once}=require('node:events');
const {plan,urlFor,cropTerrain}=require('../scripts/weather-builder/plan.cjs');
const {createServer,builtin}=require('../scripts/weather-builder/server.cjs');
const input={run:'2026-09-12T00:00:00Z',south:32,north:35,west:131,east:135,firstHour:3,lastHour:9};
test('regional plan selects the verified NOAA endpoint, 47 levels and bounded times',async()=>{
 const p=plan(input,await builtin(),Date.parse('2026-09-13T00:00:00Z'));
 assert.deepEqual(p.hours,[3,6,9]);
 const url=new URL(urlFor(p,6));
 assert.equal(url.hostname,'nomads.ncep.noaa.gov');
 assert.equal(url.searchParams.get('file'),'gfs.t00z.pgrb2full.0p50.f006');
 assert.equal([...url.searchParams.keys()].filter(k=>k.startsWith('lev_')).length,47);
 assert.equal(url.searchParams.get('leftlon'),'131');
 assert.equal(url.searchParams.get('var_UGRD'),'on');
 assert.ok(url.searchParams.has('subregion'));
});
test('missing terrain, bad grids, future runs and excessive ranges stop before acquisition',async()=>{
 const t=await builtin();
 for(const change of [{north:36},{west:130},{south:32.1},{firstHour:4},{lastHour:99},{run:'2099-01-01T00:00:00Z'}])
   assert.throws(()=>plan({...input,...change},t));
});
test('terrain crop preserves exact source values and dimensions',async()=>{
 const t=await builtin(),p=plan({...input,south:33,north:34,west:132,east:133},t);
 const crop=cropTerrain(p,t);
 assert.equal(crop.terrainMeta.rows,241);
 assert.equal(crop.terrainMeta.columns,241);
 const a=new DataView(t.terrainBuffer),b=new DataView(crop.terrainBuffer);
 for(const [row,col] of [[0,0],[120,120],[240,240]])
   assert.equal(b.getInt16((row*241+col)*2,true),a.getInt16(((row+240)*t.terrainMeta.columns+col+240)*2,true));
});
test('builder API enforces same-origin token, rejects overlapping jobs, and cancels',async t=>{
 let calls=0;
 const server=await createServer({build:async(_p,_terrain,{signal})=>{
   calls++;
   await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('cancelled')),{once:true}));
 }});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(async()=>{await server.stopBuild();server.close();});
 const base='http://127.0.0.1:'+server.address().port;
 const config=await(await fetch(base+'/api/status')).json();
 const post=(route,headers={})=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(input)});
 assert.equal((await post('/api/build')).status,403);
 const headers={'Origin':base,'X-WASA-Token':config.token};
 assert.equal((await post('/api/build',headers)).status,202);
 assert.equal((await post('/api/build',headers)).status,409);
 assert.equal(calls,1);
 assert.equal((await post('/api/cancel',headers)).status,200);
 await server.stopBuild();
 assert.equal((await(await fetch(base+'/api/status')).json()).state,'failed');
});