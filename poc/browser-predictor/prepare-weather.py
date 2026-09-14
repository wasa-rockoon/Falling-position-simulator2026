"""Offline, one-case GRIB conversion. No network or dataset discovery.

Usage: python prepare-weather.py DIRECTORY_WITH_f3_f6_f9_GRIB2
Requires eccodes==2.48.0 and numpy; does not affect the browser runtime.
"""
import hashlib
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent
if (ROOT / '.tools').exists():
    sys.path.insert(0, str(ROOT / '.tools'))
import eccodes as ec
import numpy as np

LEVELS = [1000,975,950,925,900,875,850,825,800,775,750,725,700,675,650,625,600,575,550,525,500,475,450,425,400,375,350,325,300,275,250,225,200,175,150,125,100,70,50,30,20,10,7,5,3,2,1]

def main():
    source = pathlib.Path(sys.argv[1])
    out = ROOT / 'fixtures'
    out.mkdir(exist_ok=True)
    array = np.full((3,47,3,13,19), np.nan, dtype='<f4')
    provenance = []
    audits = []
    for ti, hour in enumerate([3,6,9]):
        path = source / ('f%d.grib2' % hour)
        seen, skipped = set(), []
        with path.open('rb') as f:
            while True:
                handle = ec.codes_grib_new_from_file(f)
                if handle is None:
                    break
                try:
                    name = ec.codes_get(handle, 'shortName')
                    kind = ec.codes_get(handle, 'typeOfLevel')
                    level = ec.codes_get(handle, 'level')
                    if kind != 'isobaricInhPa' or level not in LEVELS or name not in ['gh','u','v']:
                        skipped.append([name,kind,level])
                        continue
                    assert ec.codes_get(handle, 'dataDate') == 20260910
                    assert ec.codes_get(handle, 'dataTime') == 0
                    assert ec.codes_get(handle, 'endStep') == hour
                    assert ec.codes_get(handle, 'stepUnits') == 1
                    assert ec.codes_get(handle, 'gridType') == 'regular_ll'
                    assert ec.codes_get(handle, 'iDirectionIncrementInDegrees') == .5
                    assert ec.codes_get(handle, 'jDirectionIncrementInDegrees') == .5
                    expected_unit = 'gpm' if name == 'gh' else 'm s**-1'
                    assert ec.codes_get(handle, 'units') == expected_unit
                    key = (level,name)
                    duplicate = key in seen
                    seen.add(key)
                    points = ec.codes_grib_get_data(handle)
                    cells = set()
                    for point in points:
                        y = round((point['lat']-30)*2)
                        x = round((point['lon']-128)*2)
                        assert 0 <= y < 13 and 0 <= x < 19
                        assert abs(point['lat']-(30+y*.5)) < 1e-9
                        assert abs(point['lon']-(128+x*.5)) < 1e-9
                        assert (y,x) not in cells
                        cells.add((y,x))
                        index = (ti,LEVELS.index(level),['gh','u','v'].index(name),y,x)
                        if duplicate:
                            assert array[index] == np.float32(point['value']), ('Conflicting duplicate',key)
                        else:
                            array[index] = point['value']
                    assert len(cells) == 13*19
                    if duplicate:
                        skipped.append([name,kind,level,'identical float32 duplicate'])
                finally:
                    ec.codes_release(handle)
        assert len(seen) == 141, len(seen)
        provenance.append({'file':path.name,'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'bytes':path.stat().st_size,'acceptedMessages':len(seen),'ignoredMessages':skipped})
    assert np.isfinite(array).all()
    assert (np.diff(array[:,:,0],axis=1)>0).all()
    data = array.tobytes()
    (out/'weather.bin').write_bytes(data)
    for ti,li,vi,y,x in [(0,0,0,6,9),(1,23,1,7,10),(2,46,2,4,8)]:
        audits.append({'index':[ti,li,vi,y,x],'value':float(array[ti,li,vi,y,x])})
    manifest = {'schemaVersion':1,'model':'GFS','run':'2026-09-10T00:00:00Z','forecastHours':[3,6,9],
        'pressureLevelsHpa':LEVELS,'variables':['height','wind_u','wind_v'],'units':['gpm','m/s','m/s'],
        'latitude':{'start':30,'step':.5,'count':13},'longitude':{'start':128,'step':.5,'count':19},
        'shape':[3,47,3,13,19],'dtype':'float32-le','file':'weather.bin','bytes':len(data),
        'sha256':hashlib.sha256(data).hexdigest(),'cellChecks':audits,
        'conversion':{'eccodes':ec.__version__,'numpy':np.__version__,'gribFiles':provenance},
        'sources':json.loads((source/'sources.json').read_text())}
    (out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
    print('Validated 3 x 141 messages; fixture bytes:',len(data))

if __name__ == '__main__':
    main()
