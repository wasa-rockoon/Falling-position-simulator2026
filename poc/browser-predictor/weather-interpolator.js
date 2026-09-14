// SPDX-License-Identifier: GPL-3.0-or-later
// Port of Tawhiri interpolate.pyx, Copyright 2014 Adam Greig, Daniel Richman.
// See reference-source/ and NOTICE.md. Preserve accumulation/search order.
export function longitude360(value) {
    return ((value % 360) + 360) % 360;
}

export function createWeather(manifest, buffer) {
    const m = manifest;
    if (m.schemaVersion !== 1 || m.dtype !== 'float32-le' || m.pressureLevelsHpa.length !== 47 ||
        JSON.stringify(m.variables) !== JSON.stringify(['height','wind_u','wind_v'])) throw Error('Unsupported weather fixture');
    const [nt,nl,nv,ny,nx] = m.shape;
    if (nt !== m.forecastHours.length || nl !== 47 || nv !== 3 || ny !== m.latitude.count || nx !== m.longitude.count ||
        buffer.byteLength !== nt*nl*nv*ny*nx*4 || buffer.byteLength !== m.bytes) throw Error('Invalid weather dimensions');
    if (m.forecastHours.some((h,i)=>!Number.isFinite(h) || h%3 || (i && h !== m.forecastHours[i-1]+3)) ||
        m.latitude.step !== .5 || m.longitude.step !== .5) throw Error('Unsupported grid');
    const data = new Float32Array(buffer.byteLength/4);
    const view = new DataView(buffer);
    for (let i=0;i<data.length;i++) {
        data[i] = view.getFloat32(i*4,true);
        if (!Number.isFinite(data[i])) throw Error('Nonfinite weather data');
    }
    const read = (t,l,v,y,x)=>data[((((t*47+l)*3+v)*ny+y)*nx+x)];
    // Pick on the ORIGINAL global lattice, then translate into the crop.
    // This also preserves floating-point rounding at the source-grid origin.
    function pick(value,left,step,n,name) {
        const a=(value-left)/step, b=Math.trunc(a);
        if (!Number.isFinite(a) || b<0 || b>=n-1) throw RangeError(`${name} outside Tawhiri grid`);
        return [[b,1-(a-b)],[b+1,a-b]];
    }
    function stencil(hour,lat,lon) {
        const ts=pick(hour,0,3,65,'hour');
        const ys=pick(lat,-90,.5,361,'latitude');
        const xs=pick(longitude360(lon),0,.5,721,'longitude');
        const corners=[];
        for (const [t,tw] of ts) for (const [y,yw] of ys) for (const [x,xw] of xs) {
            const ti=t-m.forecastHours[0]/3;
            const yi=y-(m.latitude.start+90)*2;
            const xi=(x%720)-m.longitude.start*2;
            if(ti<0||ti>=nt||yi<0||yi>=ny||xi<0||xi>=nx) throw RangeError('Weather fixture does not cover this point/time');
            corners.push([ti,yi,xi,tw*yw*xw]);
        }
        return corners;
    }
    function wind(hour,lat,lon,alt) {
        if (!Number.isFinite(alt)) throw RangeError('Invalid altitude');
        const points=stencil(hour,lat,lon);
        function interp3(variable,level) {
            let result=0;
            for(const [t,y,x,w] of points) result+=read(t,level,variable,y,x)*w;
            return result;
        }
        let low=0,high=45;
        while(low<high) {
            const mid=Math.trunc((low+high+1)/2);
            if(alt<=interp3(0,mid)) high=mid-1;
            else low=mid;
        }
        const lower=interp3(0,low), upper=interp3(0,low+1);
        const weight=lower!==upper ? (upper-alt)/(upper-lower) : .5;
        return [1,2].map(v=>interp3(v,low)*weight+interp3(v,low+1)*(1-weight));
    }
    return {wind,read,bytes:data.byteLength};
}
