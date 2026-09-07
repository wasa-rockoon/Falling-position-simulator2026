const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const RunRecord = require('../js/domain/run-record');
const RunRepository = require('../js/core/run-repository');
test('local cache is keyed by selected GFS revision and missing data never falls back to cached predictions', async () => {
    let revision='first', unavailable=false, calls=0;
    const root={ Map, URL, setTimeout, clearTimeout, AbortController, LocalEnvironment:{prepare:async()=>{if(unavailable)throw new Error('missing');return {dataset:'2026-09-07T00:00:00Z',revision};}} };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../js/pred/pred-api-client.js'),'utf8'),root);
    const client=new root.PredictionApi.PredictionClient({source:'local',policy:{minIntervalMs:0},fetchImpl:async()=>{calls++;return {ok:true,headers:{get:()=>null},json:async()=>({prediction:[],sample:calls})};}});
    const params={launch_datetime:'2026-09-07T01:00:00Z'};
    assert.equal((await client.request(params)).cacheHit,false);
    assert.equal((await client.request(params)).cacheHit,true);
    revision='second'; assert.equal((await client.request(params)).cacheHit,false); assert.equal(calls,2);
    unavailable=true; await assert.rejects(client.request(params),/missing/); assert.equal(calls,2);
});
test('concurrent context provenance merges every GFS and survives later progress updates', async () => {
    const repo=new RunRepository.Repository();
    const record=RunRecord.create({id:'local-provenance-test',type:'single',status:'running'});
    await repo.save(record);
    const a={dataset:'2026-09-06T00:00:00Z',revision:'a',engine:'image'}, b={dataset:'2026-09-07T00:00:00Z',revision:'b',engine:'image'};
    await Promise.all([repo.recordLocalDataset(record.id,a),repo.recordLocalDataset(record.id,b),repo.recordLocalDataset(record.id,a)]);
    await repo.update(record.id,{provenance:{predictorSource:'local'}});
    const saved=await repo.get(record.id);
    assert.equal(saved.provenance.localDatasets.length,2);
    assert.equal(RunRecord.createHistoryEntry(saved).localDatasets.length,2);
});
