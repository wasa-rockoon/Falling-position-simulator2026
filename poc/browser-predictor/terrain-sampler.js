// SPDX-License-Identifier: GPL-3.0-or-later
// Ruaumoko uses nearest grid point (C round), NOT bilinear interpolation.
// Copyright 2014 Adam Greig, Daniel Richman; see NOTICE.md.
import {longitude360} from './weather-interpolator.js';
export function createTerrain(m,buffer) {
    if(m.dtype!=='int16-le'||m.samplesPerDegree!==240||buffer.byteLength!==m.rows*m.columns*2) throw Error('Invalid terrain fixture');
    const view=new DataView(buffer);
    return {bytes:buffer.byteLength,get(lat,lon) {
        if(!Number.isFinite(lat)||!Number.isFinite(lon)||lat < -90||lat > 90) throw RangeError('Invalid terrain coordinate');
        const row=Math.floor((90-lat)*240+.5)-m.firstGlobalRow;
        const column=Math.floor(((longitude360(lon)+180)%360)*240+.5)-m.firstGlobalColumn;
        if(row<0||row>=m.rows||column<0||column>=m.columns) throw RangeError('Terrain fixture does not cover this point');
        return view.getInt16((row*m.columns+column)*2,true);
    }};
}
