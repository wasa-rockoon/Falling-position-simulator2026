// One dedicated worker; never performs network requests.
import {createWeather} from './weather-interpolator.js';
import {createTerrain} from './terrain-sampler.js';
import {predict,descentVelocity} from './trajectory-engine.js';
import {compare} from './compare.js';
let state;
self.onmessage=({data})=>{
    try {
        if(data.type==='load') {
            const {manifest,terrainMeta,weatherBuffer,terrainBuffer,testCase,reference}=data;
            state={manifest,testCase,reference,weather:createWeather(manifest,weatherBuffer),terrain:createTerrain(terrainMeta,terrainBuffer)};
            const wind=reference.windSamples.map(p=>{
                const [u,v]=state.weather.wind(p.hour,p.latitude,p.longitude,p.altitude);
                return {...p,browserU:u,browserV:v,uError:Math.abs(u-p.u),vError:Math.abs(v-p.v)};
            });
            const terrainErrors=reference.terrainSamples.map(p=>Math.abs(state.terrain.get(p.latitude,p.longitude)-p.altitude));
            const descentErrors=reference.descentSamples.map(p=>Math.abs(descentVelocity(p.altitude,testCase.descentRate)-p.velocity));
            const maxWindError=Math.max(...wind.flatMap(p=>[p.uError,p.vError]));
            const maxTerrainError=Math.max(...terrainErrors),maxDescentError=Math.max(...descentErrors);
            self.postMessage({id:data.id,type:'loaded',wind,maxWindError,maxTerrainError,maxDescentError,
                pass:maxWindError<=1e-5&&maxTerrainError===0&&maxDescentError<=1e-10,
                fixtureBytes:state.weather.bytes+state.terrain.bytes});
        } else if(data.type==='calculate') {
            if(!state) throw Error('Load fixtures first');
            const count=data.count;
            if(count!==1&&count!==100) throw Error('Only 1 or 100 repetitions are supported');
            const begin=performance.now();
            let result;
            for(let i=0;i<count;i++) result=predict(state.testCase,state.manifest,state.weather,state.terrain);
            const totalMs=performance.now()-begin;
            const comparison=compare(state.reference,result);
            self.postMessage({id:data.id,type:'result',result,comparison,performance:{
                count,totalMs,averageMs:totalMs/count,pointCount:result.prediction.reduce((n,s)=>n+s.trajectory.length,0),
                fixtureBytes:state.weather.bytes+state.terrain.bytes,
                approximateLastResultJsonBytes:new TextEncoder().encode(JSON.stringify(result)).byteLength,
                peakMemoryBytes:null,memoryNote:'Exact peak memory unavailable; fixture bytes and serialized last result are lower-bound components, not JS heap usage.',
                worker:true
            }});
        } else throw Error('Unknown worker command');
    } catch(error) {
        self.postMessage({id:data.id,type:'error',error:error.message});
    }
};
