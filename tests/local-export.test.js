const test=require('node:test');const assert=require('node:assert/strict');const {predictionExport}=require('../local/prediction-export');
test('local JSON trajectory exports actual coordinates, altitude and UTC time',()=>{
const data={prediction:[{stage:'ascent',trajectory:[{latitude:33,longitude:132,altitude:100,datetime:'2026-09-07T01:00:00Z'}]},{stage:'descent',trajectory:[{latitude:34,longitude:133,altitude:0,datetime:'2026-09-07T02:00:00Z'}]}]};
const csv=predictionExport(data,'csv');assert.match(csv,/Tawhiri,33,132,100,2026-09-07T01:00:00Z/);assert.match(csv,/Tawhiri,34,133,0/);
const kml=predictionExport(data,'kml');assert.match(kml,/<kml/);assert.match(kml,/132,33,100/);assert.match(kml,/133,34,0/);
assert.throws(()=>predictionExport({},'csv'));assert.throws(()=>predictionExport(data,'html'));
});
