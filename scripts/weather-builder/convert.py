"""Regional GRIB -> package-compatible arrays. Runs offline inside Docker."""
import hashlib
import importlib.metadata
import json
import pathlib
import sys
import eccodes as ec
import numpy as np

LEVELS = [1000,975,950,925,900,875,850,825,800,775,750,725,700,675,650,625,600,575,550,525,500,475,450,425,400,375,350,325,300,275,250,225,200,175,150,125,100,70,50,30,20,10,7,5,3,2,1]
def require(ok, message):
    if not ok:
        raise ValueError(message)

def convert(directory):
    p = json.loads((directory / 'plan.json').read_text(encoding='utf-8'))
    hours, ny, nx = p['hours'], p['rows'], p['columns']
    data = np.full((len(hours),47,3,ny,nx),np.nan,dtype='<f4')
    records = []
    for ti,hour in enumerate(hours):
        source = directory / ('f%d.grib2' % hour)
        seen = set()
        with source.open('rb') as stream:
            while True:
                handle = ec.codes_grib_new_from_file(stream)
                if handle is None:
                    break
                try:
                    name,kind,level = (ec.codes_get(handle,k) for k in ['shortName','typeOfLevel','level'])
                    if name not in ['gh','u','v'] or kind != 'isobaricInhPa' or level not in LEVELS:
                        continue
                    require(ec.codes_get(handle,'dataDate') == int(p['run'][:10].replace('-','')) and
                            ec.codes_get(handle,'dataTime') == int(p['run'][11:13])*100 and
                            ec.codes_get(handle,'endStep') == hour and ec.codes_get(handle,'stepUnits') == 1,
                            'GRIB run/forecast mismatch')
                    require(ec.codes_get(handle,'gridType') == 'regular_ll' and
                            ec.codes_get(handle,'iDirectionIncrementInDegrees') == .5 and
                            ec.codes_get(handle,'jDirectionIncrementInDegrees') == .5,'Unsupported grid')
                    require(ec.codes_get(handle,'units') == ('gpm' if name == 'gh' else 'm s**-1'),'Unexpected unit')
                    key = (level,name)
                    duplicate = key in seen
                    seen.add(key)
                    cells=set()
                    for point in ec.codes_grib_get_data(handle):
                        y,x=round((point['lat']-p['south'])*2),round((point['lon']-p['west'])*2)
                        require(0 <= y < ny and 0 <= x < nx and
                                abs(point['lat']-(p['south']+y*.5)) < 1e-9 and
                                abs(point['lon']-(p['west']+x*.5)) < 1e-9 and (y,x) not in cells,'GRIB region mismatch')
                        cells.add((y,x))
                        index=(ti,LEVELS.index(level),['gh','u','v'].index(name),y,x)
                        if duplicate:
                            require(data[index] == np.float32(point['value']),'Conflicting duplicate')
                        else:
                            data[index]=point['value']
                    require(len(cells)==ny*nx,'Incomplete spatial grid')
                finally:
                    ec.codes_release(handle)
        require(len(seen)==141,'Missing pressure levels or variables: %d/141' % len(seen))
        records.append({'file':source.name,'sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'bytes':source.stat().st_size})
    require(np.isfinite(data).all() and (np.diff(data[:,:,0],axis=1)>0).all(),'Invalid weather values')
    raw=data.tobytes()
    require(len(raw)==p['weatherBytes'],'Unexpected byte count')
    manifest={'schemaVersion':1,'model':'GFS','run':p['run'],'forecastHours':hours,
              'pressureLevelsHpa':LEVELS,'variables':['height','wind_u','wind_v'],'units':['gpm','m/s','m/s'],
              'latitude':{'start':p['south'],'step':.5,'count':ny},'longitude':{'start':p['west'],'step':.5,'count':nx},
              'shape':[len(hours),47,3,ny,nx],'dtype':'float32-le','file':'weather.bin','bytes':len(raw),
              'sha256':hashlib.sha256(raw).hexdigest(),
              'conversion':{'eccodes':importlib.metadata.version('eccodes'),'eccodesLibrary':ec.codes_get_api_version(),'numpy':np.__version__,'gribFiles':records},
              'sources':json.loads((directory/'sources.json').read_text(encoding='utf-8'))}
    (directory/'weather.bin').write_bytes(raw)
    (directory/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
    print('Validated %d forecasts; %d bytes' % (len(hours),len(raw)))

if __name__ == '__main__':
    convert(pathlib.Path(sys.argv[1]))