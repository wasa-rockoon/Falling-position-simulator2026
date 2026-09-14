// Integration adapter: numerical engine and original PoC remain unchanged.
import {createWeather} from './weather-interpolator.js';
import {createTerrain} from './terrain-sampler.js';
import {predict} from './trajectory-engine.js';
let state;
function message(error) {
    if(/Weather fixture does not cover/.test(error.message)) return '飛行経路または飛行時刻が固定気象データの範囲を超えました。条件を変更してください。';
    if(/Terrain fixture does not cover/.test(error.message)) return '飛行経路が固定地表標高の範囲を超えました。条件を変更してください。';
    return error.message;
}
self.onmessage=({data})=>{
    try {
        if(data.type==='load') {
            state={manifest:data.manifest,weather:createWeather(data.manifest,data.weatherBuffer),terrain:createTerrain(data.terrainMeta,data.terrainBuffer)};
            self.postMessage({id:data.id,type:'ready'});
        } else if(data.type==='terrain') {
            if(!state) throw Error('固定データを先に読み込んでください。');
            self.postMessage({id:data.id,type:'terrain',altitude:state.terrain.get(data.latitude,data.longitude)});
        } else if(data.type==='predict') {
            if(!state) throw Error('固定データを先に読み込んでください。');
            const ground=state.terrain.get(data.testCase.launchLatitude,data.testCase.launchLongitude);
            const requestedLaunchAltitude=data.testCase.launchAltitude;
            if(data.testCase.launchAltitude<=ground) data.testCase.launchAltitude=ground+0.01;
            const result=predict(data.testCase,state.manifest,state.weather,state.terrain);
            result.metadata={complete_datetime:new Date().toISOString(),terrainAdjustment:
                data.testCase.launchAltitude!==requestedLaunchAltitude
                    ? {requestedAltitude:requestedLaunchAltitude,groundAltitude:ground,usedAltitude:data.testCase.launchAltitude}
                    : null};
            self.postMessage({id:data.id,type:'result',data:result});
        } else throw Error('Unsupported browser predictor command');
    } catch(error) {self.postMessage({id:data.id,type:'error',error:message(error)});}
};
