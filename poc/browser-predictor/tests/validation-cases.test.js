import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {createWeather} from '../weather-interpolator.js';
import {createTerrain} from '../terrain-sampler.js';
import {predict} from '../trajectory-engine.js';
import {compare} from '../compare.js';
const dir=new URL('../fixtures/',import.meta.url);
const bytes=name=>fs.readFileSync(new URL(name,dir));
const json=name=>JSON.parse(bytes(name));
const sha=name=>createHash('sha256').update(bytes(name)).digest('hex');
const buffer=name=>{const b=bytes(name);return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);};
const suite=json('validation-suite.json'),base=json(suite.baseCase);
const m=json('manifest.json'),tm=json('terrain.json'),baseline=json('baseline.json');
const weather=createWeather(m,buffer('weather.bin')),terrain=createTerrain(tm,buffer('terrain.bin'));
assert.equal(suite.cases.length,5);
for(const entry of suite.cases) test(entry.id+': native Tawhiri comparison within 1m / 1s',()=>{
    const c=json(entry.caseFile),reference=json(entry.referenceFile);
    assert.equal(reference.caseSha256,sha(entry.caseFile));
    assert.equal(reference.weatherSha256,sha('weather.bin'));
    assert.equal(reference.terrainSha256,sha('terrain.bin'));
    assert.equal(reference.image,baseline.image);
    const result=predict(c,m,weather,terrain),report=compare(reference,result);
    assert.equal(report.pass,true,JSON.stringify(report.metrics));
    for(const [name,value] of Object.entries(report.metrics)) assert.ok(Number.isFinite(value)&&value<=1,name+': '+value);
    for(const p of reference.windSamples) {
        const [u,v]=weather.wind(p.hour,p.latitude,p.longitude,p.altitude);
        assert.ok(Math.abs(u-p.u)<=1e-5&&Math.abs(v-p.v)<=1e-5);
    }
    for(const p of reference.terrainSamples) assert.equal(terrain.get(p.latitude,p.longitude),p.altitude);
});
for(const entry of suite.errorCases) test(entry.id+': explicit error and reusable engine',()=>{
    assert.throws(()=>predict({...base,...entry.overrides},m,weather,terrain),error=>error.message===entry.expectedError);
    assert.equal(compare(json('reference.json'),predict(base,m,weather,terrain)).pass,true);
});
