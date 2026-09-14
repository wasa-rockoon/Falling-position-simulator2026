const {plan}=require('./plan.cjs');

// Propose acquisition bounds only. Launch settings are never embedded in .wasawx.
function suggest(input,terrain,now=Date.now()) {
    const launch=Date.parse(input.launchDatetime);
    const {latitude,longitude,durationHours,marginDegrees}=input;
    if (!Number.isFinite(launch) || ![latitude,longitude,durationHours,marginDegrees].every(Number.isFinite) ||
        latitude < -90 || latitude > 90 || longitude < -180 || longitude > 360 ||
        durationHours <= 0 || durationHours > 69 || marginDegrees < .5 || marginDegrees > 4.5) {
        throw Error('放球日時・座標・飛行時間（0〜69時間）・地域の余裕（0.5〜4.5度）を確認してください。');
    }
    const hour=3600000;
    const runTime=Math.floor(Math.min(now-8*hour,launch)/(6*hour))*6*hour;
    const lon=((longitude%360)+360)%360;
    const proposed={run:new Date(runTime).toISOString().replace('.000Z','Z'),
        south:Math.floor((latitude-marginDegrees)*2)/2,north:Math.ceil((latitude+marginDegrees)*2)/2,
        west:Math.floor((lon-marginDegrees)*2)/2,east:Math.ceil((lon+marginDegrees)*2)/2,
        firstHour:Math.floor((launch-runTime)/(3*hour))*3,
        // Include a grid time strictly AFTER the estimated landing, even on a boundary.
        lastHour:(Math.floor((launch+durationHours*hour-runTime)/(3*hour))+1)*3};
    const checked=plan(proposed,terrain,now);
    return {input:proposed,bytesUpperBound:checked.weatherBytes+checked.terrainBytes+256*1024+12,
        start:new Date(runTime+proposed.firstHour*hour).toISOString(),
        end:new Date(runTime+proposed.lastHour*hour).toISOString(),
        warning:'runは公開遅延8時間を仮定した候補です。公開済みかは未確認です。地域の余裕と飛行時間は入力した見積りで、全経路の収容を保証しません。'};
}
module.exports={suggest};
