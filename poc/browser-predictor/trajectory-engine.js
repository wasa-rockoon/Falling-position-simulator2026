// SPDX-License-Identifier: GPL-3.0-or-later
// Port of Tawhiri models.py / solver.pyx (2014 Adam Greig, Daniel Richman).
// The pinned local image is the reference, including its termination behavior.
import {longitude360} from './weather-interpolator.js';

export function descentVelocity(alt,rate) {
    let temp,pressure;
    if(alt>25000) {temp=-131.21+.00299*alt;pressure=2.488*((temp+273.1)/216.6)**(-11.388);}
    else if(alt>11000) {temp=-56.46;pressure=22.65*Math.exp(1.73-.000157*alt);}
    else {temp=15.04-.00649*alt;pressure=101.29*((temp+273.1)/288.08)**5.256;}
    const density=pressure/(.2869*(temp+273.1));
    return -rate*1.1045/Math.sqrt(density);
}
const lerp=(a,b,w)=>(1-w)*a+w*b;
export function longitudeLerp(a,b,w) {
    let w2=1-w;
    if(a>b) {[a,b]=[b,a];[w,w2]=[w2,w];}
    return b-a<180 ? w2*a+w*b : longitude360(w2*(a+360)+w*b);
}
function add(a,k,b) {return [a[0]+k*b[0],longitude360(a[1]+k*b[1]),a[2]+k*b[2]];}
function vectorLerp(a,b,w) {return [lerp(a[0],b[0],w),longitudeLerp(a[1],b[1],w),lerp(a[2],b[2],w)];}

export function rk4(t,y,model,terminate,dt=60,tolerance=.01,maxSteps=1000) {
    const result=[[t,...y]];
    for(let step=0;step<maxSteps;step++) {
        const k1=model(t,y), k2=model(t+dt/2,add(y,dt/2,k1));
        const k3=model(t+dt/2,add(y,dt/2,k2)),k4=model(t+dt,add(y,dt,k3));
        // Deliberately sequential additions, matching Cython rounding/order.
        let y2=add(y,dt/6,k1);
        y2=add(y2,dt/3,k2);y2=add(y2,dt/3,k3);y2=add(y2,dt/6,k4);
        const t2=t+dt;
        if(!y2.every(Number.isFinite)) throw Error('Nonfinite trajectory');
        if(terminate(t2,y2)) {
            let left=0,right=1,t3=t2,y3=y2;
            while(right-left>tolerance) {
                const mid=(left+right)/2;
                t3=lerp(t,t2,mid);y3=vectorLerp(y,y2,mid);
                if(terminate(t3,y3)) right=mid;else left=mid;
            }
            result.push([t3,...y3]);return result;
        }
        t=t2;y=y2;result.push([t,...y]);
    }
    throw Error('Maximum integration steps exceeded');
}

export function predict(c,manifest,weather,terrain) {
    const numeric=['launchLatitude','launchLongitude','launchAltitude','ascentRate','descentRate','burstAltitude'];
    if(numeric.some(k=>!Number.isFinite(c[k]))||c.ascentRate<=0||c.descentRate<=0||c.burstAltitude<=c.launchAltitude||
        c.timestepSeconds!==60||c.terminationTolerance!==.01||!Number.isInteger(c.maxStepsPerStage)||c.maxStepsPerStage<1||c.maxStepsPerStage>10000) throw Error('Invalid fixed test case');
    const start=Date.parse(c.launchDatetime)/1000,epoch=Date.parse(manifest.run)/1000;
    if(!Number.isFinite(start)||!Number.isFinite(epoch)) throw Error('Invalid fixture time');
    function model(up) {return (t,[lat,lon,alt])=>{
        const [u,v]=weather.wind((t-epoch)/3600,lat,lon,alt), radius=6371009+alt;
        return [180/Math.PI*v/radius,180/Math.PI*u/(radius*Math.cos(lat*(Math.PI/180))),up?c.ascentRate:descentVelocity(alt,c.descentRate)];
    };}
    const ascent=rk4(start,[c.launchLatitude,longitude360(c.launchLongitude),c.launchAltitude],model(true),(_t,y)=>y[2]>=c.burstAltitude,60,.01,c.maxStepsPerStage);
    const final=ascent.at(-1);
    const descent=rk4(final[0],final.slice(1),model(false),(_t,y)=>terrain.get(y[0],y[1])>y[2],60,.01,c.maxStepsPerStage);
    return {request:{...c,dataset:manifest.run},prediction:[ascent,descent].map((points,i)=>({stage:i?'descent':'ascent',trajectory:points.map(([t,latitude,longitude,altitude])=>({latitude,longitude,altitude,datetime:new Date(t*1000).toISOString(),timeSeconds:t}))}))};
}
