import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {createWeather} from '../weather-interpolator.js';
import {createTerrain} from '../terrain-sampler.js';
import {predict,descentVelocity,longitudeLerp,rk4} from '../trajectory-engine.js';
import {compare} from '../compare.js';
const dir=new URL('../fixtures/',import.meta.url);
const read=name=>fs.readFileSync(new URL(name,dir));
const json=name=>JSON.parse(read(name));
const buffer=name=>{const b=read(name);return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);};
const m=json('manifest.json'),tm=json('terrain.json'),c=json('case.json'),ref=json('reference.json');
const weather=createWeather(m,buffer('weather.bin')),terrain=createTerrain(tm,buffer('terrain.bin'));
const sha=name=>createHash('sha256').update(read(name)).digest('hex');

test('reference is bound to exact case/weather/terrain bytes and pinned native source',()=>{
    assert.equal(sha('weather.bin'),m.sha256);
    assert.equal(sha('terrain.bin'),tm.sha256);
    assert.equal(sha('case.json'),ref.caseSha256);
    assert.equal(ref.weatherSha256,m.sha256);
    assert.equal(ref.terrainSha256,tm.sha256);
    const baseline=json('baseline.json');
    assert.match(baseline.image,/@sha256:9714dc04/);
    for(const [name,hash] of Object.entries(baseline.sourceHashes)) {
        const bytes=fs.readFileSync(new URL('../reference-source/'+name,import.meta.url));
        assert.equal(createHash('sha256').update(bytes).digest('hex'),hash);
    }
});
test('decoded global-grid fixture samples agree with converter audit',()=>{
    for(const p of m.cellChecks) assert.equal(weather.read(...p.index),p.value);
});
test('wind interpolation matches native Cython at fixed and trajectory samples',()=>{
    for(const p of ref.windSamples) {
        const [u,v]=weather.wind(p.hour,p.latitude,p.longitude,p.altitude);
        assert.ok(Math.abs(u-p.u)<=1e-5,JSON.stringify(p));
        assert.ok(Math.abs(v-p.v)<=1e-5,JSON.stringify(p));
    }
});
test('terrain matches native Ruaumoko samples and every reference landing check',()=>{
    for(const p of [...tm.cellChecks,...ref.terrainSamples]) assert.equal(terrain.get(p.latitude,p.longitude),p.altitude);
});
test('standard atmosphere matches image at piecewise model boundaries',()=>{
    for(const p of ref.descentSamples) assert.ok(Math.abs(descentVelocity(p.altitude,c.descentRate)-p.velocity)<1e-10);
});
test('full trajectory, burst and landing meet 1m / 1s thresholds',()=>{
    const result=predict(c,m,weather,terrain);
    const report=compare(ref,result);
    assert.equal(report.pass,true,JSON.stringify(report.metrics));
    assert.ok(report.metrics.landingErrorM<=1);
    assert.deepEqual(result.prediction.map(p=>p.trajectory.length),ref.prediction.map(p=>p.trajectory.length));
});
test('comparison detects a real displacement rather than passing any trajectory',()=>{
    const bad=structuredClone(ref);
    for(const s of bad.prediction) for(const p of s.trajectory) p.latitude+=.01;
    assert.equal(compare(ref,bad).pass,false);
});
test('negative longitude representation and dateline interpolation',()=>{
    assert.deepEqual(weather.wind(4.5,c.launchLatitude,c.launchLongitude,12000),weather.wind(4.5,c.launchLatitude,c.launchLongitude-360,12000));
    assert.equal(longitudeLerp(359,1,.5),0);
    assert.equal(longitudeLerp(1,359,.5),0);
});
test('missing weather/terrain and corrupted arrays fail explicitly',()=>{
    assert.throws(()=>weather.wind(9,33,132,100),/cover/);
    assert.throws(()=>weather.wind(4,20,132,100),/cover/);
    assert.throws(()=>weather.wind(4,33,132,NaN),/altitude/);
    assert.throws(()=>terrain.get(20,132),/cover/);
    assert.throws(()=>createWeather(m,new ArrayBuffer(4)),/dimensions/);
    const bad=buffer('weather.bin');new DataView(bad).setFloat32(0,NaN,true);
    assert.throws(()=>createWeather(m,bad),/Nonfinite/);
});
test('invalid launch and non-terminating integration do not hang',()=>{
    assert.throws(()=>predict({...c,ascentRate:0},m,weather,terrain),/Invalid/);
    assert.throws(()=>rk4(0,[0,0,0],()=>[0,0,1],()=>false,60,.01,2),/Maximum/);
});
