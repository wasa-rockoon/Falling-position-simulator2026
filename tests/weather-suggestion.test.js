const test=require('node:test');
const assert=require('node:assert/strict');
const {suggest}=require('../scripts/weather-builder/suggest.cjs');
const {builtin}=require('../scripts/weather-builder/server.cjs');
const now=Date.parse('2026-09-13T04:00:00Z');
const input={launchDatetime:'2026-09-13T04:30:00Z',latitude:33.13492,longitude:132.50477,durationHours:4,marginDegrees:.5};

test('suggestion brackets launch and landing without storing flight settings',async()=>{
 const result=suggest(input,await builtin(),now);
 assert.equal(result.input.run,'2026-09-12T18:00:00Z');
 assert.equal(result.input.firstHour,9);
 assert.equal(result.input.lastHour,15);
 assert.ok(Date.parse(result.start)<=Date.parse(input.launchDatetime));
 assert.ok(Date.parse(result.end)>Date.parse(input.launchDatetime)+4*3600000);
 assert.equal(result.input.south,32.5);
 assert.equal(result.input.north,34);
 assert.equal(result.input.launchDatetime,undefined);
});

test('exact landing grid time requires later forecast',async()=>{
 const result=suggest({...input,launchDatetime:'2026-09-13T03:00:00Z',durationHours:3},await builtin(),now);
 assert.equal(result.input.lastHour,15);
});

test('missing terrain and excessive horizon never yield clipped plans',async()=>{
 const terrain=await builtin();
 for(const changed of [{latitude:35},{launchDatetime:'2026-10-01T00:00:00Z'},{durationHours:0},{marginDegrees:0},{latitude:NaN}]) {
   assert.throws(()=>suggest({...input,...changed},terrain,now));
 }
});
