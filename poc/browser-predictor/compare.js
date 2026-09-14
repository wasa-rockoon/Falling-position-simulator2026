// Standalone comparison: no app/provider imports.
export const time = p => p.timeSeconds ?? Date.parse(p.datetime)/1000;
export function distance(a,b) {
    const rad=Math.PI/180,lat1=a.latitude*rad,lat2=b.latitude*rad;
    const dlat=lat2-lat1,dlon=(b.longitude-a.longitude)*rad;
    const h=Math.sin(dlat/2)**2+Math.cos(lat1)*Math.cos(lat2)*Math.sin(dlon/2)**2;
    return 6371009*2*Math.asin(Math.sqrt(Math.max(0,Math.min(1,h))));
}
function flat(data) {
    const points=[];
    for(const stage of data.prediction) for(const point of stage.trajectory) {
        if(!points.length||time(point)>time(points.at(-1))) points.push(point);
    }
    return points;
}
function at(points,t) {
    let lo=0,hi=points.length-1;
    while(hi-lo>1) {const mid=(hi+lo)>>1;if(time(points[mid])<=t) lo=mid;else hi=mid;}
    const a=points[lo],b=points[hi],f=(t-time(a))/(time(b)-time(a));
    let dlon=((b.longitude-a.longitude+540)%360)-180;
    return {latitude:a.latitude+(b.latitude-a.latitude)*f,longitude:a.longitude+dlon*f,altitude:a.altitude+(b.altitude-a.altitude)*f};
}
export function compare(reference,actual) {
    const r=flat(reference),a=flat(actual);
    if(r.length<2||a.length<2) throw Error('Missing trajectory');
    const rb=reference.prediction[0].trajectory.at(-1),ab=actual.prediction[0].trajectory.at(-1);
    const rl=r.at(-1),al=a.at(-1);
    const start=Math.max(time(r[0]),time(a[0])),end=Math.min(time(rl),time(al));
    if(end<=start) throw Error('No common trajectory interval');
    const times=new Set([start,end]);
    for(let t=start;t<end;t+=60) times.add(t);
    for(const p of [...r,...a]) if(time(p)>=start&&time(p)<=end) times.add(time(p));
    const rows=[...times].sort((x,y)=>x-y).map(t=>{
        const rp=at(r,t),ap=at(a,t),horizontal=distance(rp,ap),vertical=Math.abs(rp.altitude-ap.altitude);
        return {timeSeconds:t,horizontalErrorM:horizontal,altitudeErrorM:vertical,positionErrorM:Math.hypot(horizontal,vertical)};
    });
    const burstErrorM=distance(rb,ab),landingErrorM=distance(rl,al);
    const maxTrajectoryErrorM=Math.max(...rows.map(p=>p.positionErrorM));
    const burstTimeErrorS=Math.abs(time(rb)-time(ab)),landingTimeErrorS=Math.abs(time(rl)-time(al));
    return {
        pass:maxTrajectoryErrorM<=1&&burstErrorM<=1&&landingErrorM<=1&&burstTimeErrorS<=1&&landingTimeErrorS<=1,
        reference:{durationSeconds:time(rl)-time(r[0]),burst:rb,landing:rl},
        browser:{durationSeconds:time(al)-time(a[0]),burst:ab,landing:al},
        metrics:{maxTrajectoryErrorM,meanTrajectoryErrorM:rows.reduce((s,p)=>s+p.positionErrorM,0)/rows.length,
            burstErrorM,burstAltitudeErrorM:Math.abs(rb.altitude-ab.altitude),landingErrorM,
            landingAltitudeErrorM:Math.abs(rl.altitude-al.altitude),burstTimeErrorS,landingTimeErrorS,
            durationErrorS:Math.abs((time(rl)-time(r[0]))-(time(al)-time(a[0])))},
        commonTimeSamples:rows.length,trajectoryErrors:rows
    };
}
