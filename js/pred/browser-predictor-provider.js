/* Fixed-fixture browser provider. No prediction HTTP API; packages may be explicitly stored in IndexedDB. */
(function(root,factory) {
    var scriptUrl = root.document && root.document.currentScript && root.document.currentScript.src;
    var packageApi = root.WeatherPackage;
    var storage = root.AppStorage;
    if (typeof module === 'object' && module.exports) packageApi = packageApi || require('./weather-package.js');
    if (typeof module === 'object' && module.exports) storage = storage || require('../core/app-storage.js');
    var api=factory(root,scriptUrl,packageApi,storage);
    if(typeof module==='object' && module.exports) module.exports=api;
    else root.BrowserPredictor=api;
}(typeof globalThis!=='undefined'?globalThis:this,function(root,scriptUrl,WeatherPackage,AppStorage) {
    'use strict';
    var ID='browser-fixture', singleton;
    var STANDARD_ONLY='ブラウザ計算は標準フライト（上昇→破裂→下降）のみ対応しています。';
    function error(message,code) {
        var e=new Error(message);e.userMessage=message;e.code=code||'BROWSER_PREDICTION_FAILED';return e;
    }
    var BUILTIN_COVERAGE = {
        start:'2026-09-10T03:00:00Z', end:'2026-09-10T09:00:00Z',
        weather:{south:30,north:36,west:128,east:137},
        terrain:{south:32,north:35,west:131,east:135}
    };
    function parameters(params,options,coverage) {
        coverage = coverage || BUILTIN_COVERAGE;
        if(!params || (params.pred_type!=='single' && params.pred_type!=='ehime') || params.profile!=='standard_profile') throw error(STANDARD_ONLY);
        var mapping={launchLatitude:'launch_latitude',launchLongitude:'launch_longitude',launchAltitude:'launch_altitude',ascentRate:'ascent_rate',descentRate:'descent_rate',burstAltitude:'burst_altitude'};
        var c={id:'browser-fixture-single',launchDatetime:params.launch_datetime,timestepSeconds:60,terminationTolerance:.01,maxStepsPerStage:1000};
        Object.keys(mapping).forEach(function(key) {
            var value=params[mapping[key]];
            if(value===null||value===undefined||value===''||!Number.isFinite(Number(value))) throw error('予測条件の数値を確認してください。');
            c[key]=Number(value);
        });
        c.launchLongitude=((c.launchLongitude%360)+360)%360;
        var t=Date.parse(c.launchDatetime);
        if(!Number.isFinite(t)||t<Date.parse(coverage.start)||t>=Date.parse(coverage.end)) throw error('固定気象データの日時範囲外です。表示されている対応時刻内で、着地まで収まる条件を指定してください。');
        if(c.launchLatitude<coverage.terrain.south||c.launchLatitude>coverage.terrain.north||c.launchLongitude<coverage.terrain.west||c.launchLongitude>coverage.terrain.east) throw error('固定地表標高の範囲外です。表示されている標高範囲内で指定してください。');
        if(c.launchLatitude<coverage.weather.south||c.launchLatitude>=coverage.weather.north||c.launchLongitude<coverage.weather.west||c.launchLongitude>=coverage.weather.east) throw error('固定気象データの地域範囲外です。北端・東端は補間のため利用できません。');
        if(c.ascentRate<=0||c.descentRate<=0||c.launchAltitude<0||c.burstAltitude<=c.launchAltitude) throw error('上昇・下降速度は正の値、破裂高度は放球高度より高くしてください。');
        return c;
    }
    function create(options) {
        options=options||{};
        var base=options.baseUrl || new URL('../../poc/browser-predictor/',scriptUrl||root.location.href).href;
        var fetcher=options.fetchImpl||root.fetch.bind(root);
        var makeWorker=options.workerFactory||function(url){return new root.Worker(url,{type:'module'});};
        var assetsPromise,readyPromise,slots=[],sequence=0,busy=false,queuedPredictions=0,activePredictions=0,predictionQueue=[],dispatching=false,dispatchTimer=null, imported=null;
        var packageStore=AppStorage && AppStorage.createStore ? AppStorage.createStore('weatherPackages') : null;
        var client={timeoutMs:30000,cacheTtlMs:0,provenance:null};
        async function get(name,json) {
            var controller=new root.AbortController();
            var timer=root.setTimeout(function(){controller.abort();},client.timeoutMs);
            try {
                var response=await fetcher(new URL(name,base).href,{signal:controller.signal});
                if(!response.ok) throw error('固定データを読み込めません。ページをオンラインで開き直してください。');
                return await (json?response.json():response.arrayBuffer());
            } finally {root.clearTimeout(timer);}
        }
        async function hash(buffer,expected) {
            var digest=await root.crypto.subtle.digest('SHA-256',buffer);
            var actual=Array.from(new Uint8Array(digest)).map(function(b){return b.toString(16).padStart(2,'0');}).join('');
            if(actual!==expected) throw error('固定データの検証に失敗しました。ページを更新してください。');
        }
        function assets() {
            if(!assetsPromise) assetsPromise=Promise.all([
                get('fixtures/manifest.json',true),get('fixtures/terrain.json',true),
                get('fixtures/weather.bin',false),get('fixtures/terrain.bin',false)
            ]).then(async function(a) {
                await hash(a[2],a[0].sha256);await hash(a[3],a[1].sha256);
                return {manifest:a[0],terrainMeta:a[1],weatherBuffer:a[2],terrainBuffer:a[3]};
            }).catch(function(e){assetsPromise=null;throw e;});
            return assetsPromise;
        }
        function occupied(){return busy||queuedPredictions||activePredictions;}
        function reset() {
            slots.forEach(function(slot){slot.worker.terminate();});
            slots=[];readyPromise=null;
        }
        function removeSlot(slot) {
            var index=slots.indexOf(slot);
            if(index>=0) slots.splice(index,1);
            slot.dead=true;
            slot.worker.terminate();
        }
        function call(slot,type,values,signal) {
            return new Promise(function(resolve,reject) {
                if(signal&&signal.aborted) {reject(error('ブラウザ計算を中断しました。','ABORTED'));return;}
                var id=++sequence;
                function finish(failure,value) {
                    if(!slot.pending||slot.pending.id!==id)return;
                    root.clearTimeout(timer);
                    if(signal) signal.removeEventListener('abort',abort);
                    slot.pending=null;
                    if(failure) reject(failure);else resolve(value);
                }
                function abort(){removeSlot(slot);finish(error('ブラウザ計算を中断しました。','ABORTED'));}
                var timer=root.setTimeout(function(){removeSlot(slot);finish(error('ブラウザ計算が時間内に完了しませんでした。'));},client.timeoutMs);
                if(signal) signal.addEventListener('abort',abort,{once:true});
                slot.pending={id:id,finish:finish};
                try {slot.worker.postMessage(Object.assign({id:id,type:type},values));}
                catch(e){removeSlot(slot);finish(e);}
            });
        }
        async function addSlot(a,signal) {
            var slot={worker:makeWorker(new URL('browser-provider.worker.js',base).href),pending:null,running:false,dead:false};
            slots.push(slot);
            slot.worker.onmessage=function(event) {
                if(!slot.pending||event.data.id!==slot.pending.id) return;
                if(event.data.type==='error') slot.pending.finish(error(event.data.error));
                else slot.pending.finish(null,event.data);
            };
            slot.worker.onerror=function() {
                var p=slot.pending;removeSlot(slot);
                if(p) p.finish(error('ブラウザ計算の起動に失敗しました。ページを更新してください。'));
            };
            try {await call(slot,'load',a,signal);return slot;}
            catch(e){removeSlot(slot);throw e;}
        }
        function poolLimit(a) {
            if(Number.isFinite(options.workerCount))return Math.max(1,Math.min(4,Math.floor(options.workerCount)));
            var nav=root.navigator||{},bytes=a.weatherBuffer.byteLength+a.terrainBuffer.byteLength;
            var mobile=/Android|iPhone|iPad|iPod|Mobile/i.test(String(nav.userAgent||''));
            var cores=Math.max(1,Number(nav.hardwareConcurrency)||2),memory=Number(nav.deviceMemory)||4;
            if(mobile||cores<4||memory<4||bytes>24*1024*1024)return 1;
            if(cores>=8&&memory>=8&&bytes<=8*1024*1024)return 4;
            return 2;
        }
        async function ensureSlots(count,signal) {
            var a=await assets();
            var target=Math.min(count,poolLimit(a));
            while(slots.length<target)await addSlot(a,signal);
            return a;
        }
        async function ready(signal) {
            if(slots.length)return assets();
            if(!readyPromise)readyPromise=ensureSlots(1,signal).then(function(a){
                client.provenance={predictorSource:ID,engineVersion:'tawhiri-0.2.0-js-phase0-v1',gfsRun:a.manifest.run,
                    weatherSha256:a.manifest.sha256,terrainSha256:a.terrainMeta.sha256,fixedFixture:!imported,packageSha256:a.packageSha256||null};
                return a;
            }).catch(function(e){readyPromise=null;throw e;});
            return readyPromise;
        }
        function desiredPoolSize() {
            var workload=queuedPredictions+activePredictions;
            return workload>=8?4:(workload>=2?2:1);
        }
        function scheduleDispatch() {
            if(dispatching||dispatchTimer!==null)return;
            dispatchTimer=root.setTimeout(function(){dispatchTimer=null;dispatchPredictions();},0);
        }
        async function dispatchPredictions() {
            if(dispatching)return;
            dispatching=true;
            try {
                await ready();
                await ensureSlots(desiredPoolSize());
                var free;
                while(predictionQueue.length&&(free=slots.find(function(slot){return !slot.running&&!slot.dead;}))) {
                    var job=predictionQueue.shift();
                    queuedPredictions-=1;
                    if(job.signal&&job.signal.aborted){job.reject(error('ブラウザ計算を中断しました。','ABORTED'));continue;}
                    free.running=true;activePredictions+=1;
                    (function(slot,current){
                        call(slot,'predict',{testCase:current.testCase},current.signal).then(current.resolve,current.reject).finally(function(){
                            slot.running=false;activePredictions-=1;dispatchPredictions();
                        });
                    }(free,job));
                }
            } catch(e) {
                var jobs=predictionQueue.splice(0);queuedPredictions=0;
                jobs.forEach(function(job){job.reject(e);});
            } finally {
                dispatching=false;
                if(predictionQueue.length&&slots.some(function(slot){return !slot.running&&!slot.dead;}))scheduleDispatch();
            }
        }
        function enqueuePrediction(testCase,signal) {
            return new Promise(function(resolve,reject) {
                if(signal&&signal.aborted){reject(error('ブラウザ計算を中断しました。','ABORTED'));return;}
                var job={testCase:testCase,signal:signal,resolve:resolve,reject:reject};
                predictionQueue.push(job);queuedPredictions+=1;
                if(signal)signal.addEventListener('abort',function queuedAbort(){
                    var index=predictionQueue.indexOf(job);
                    if(index<0)return;
                    predictionQueue.splice(index,1);queuedPredictions-=1;
                    reject(error('ブラウザ計算を中断しました。','ABORTED'));
                },{once:true});
                scheduleDispatch();
            });
        }
        client.request=async function(params,requestOptions) {
            var c=parameters(params,requestOptions,imported ? imported.coverage : BUILTIN_COVERAGE);
            var signal=requestOptions&&requestOptions.signal;
            await ready(signal);
            var response=await enqueuePrediction(c,signal);
            var data=response.data;
            data.request=Object.assign({},params,{dataset:client.provenance.gfsRun});
            data.metadata.provenance=Object.assign({},client.provenance);
            return {data:data,cacheHit:false,attempts:0,computationCount:1,provenance:client.provenance};
        };
        client.groundAltitude=async function(latitude,longitude){
            if (!Number.isFinite(latitude)||!Number.isFinite(longitude)) throw error('緯度・経度を入力してください。');
            if (occupied()) throw error('計算または読込の完了を待ってください。');
            busy=true;
            try { await ready(); return (await call(slots[0],'terrain',{latitude:latitude,longitude:longitude})).altitude; }
            finally {busy=false;}
        };
        client.sample=async function(){
            if (!imported) return get('fixtures/case.json',true);
            if (!imported.sampleCase) throw error('このパッケージにはサンプル条件がありません。対応範囲内の条件を手入力してください。');
            return JSON.parse(JSON.stringify(imported.sampleCase));
        };
        client.importPackage=async function(file){
            if (occupied()) throw error('計算または読込が完了してからデータを切り替えてください。');
            if (!file || !Number.isFinite(file.size) || file.size > WeatherPackage.maxBytes) throw error('パッケージの上限は64MiBです。');
            busy=true;
            try {
                // Decode completely before replacing the active data or Worker.
                var a=await WeatherPackage.decode(await file.arrayBuffer());
                reset();
                imported=a;
                assetsPromise=Promise.resolve(a);
                client.provenance=null;
                return client.describe();
            } finally {busy=false;}
        };
        function packageRecord(a, buffer, title) {
            return {
                schemaVersion: 1,
                title: String(title || ('GFS ' + a.manifest.run)).slice(0, 120),
                savedAt: new Date().toISOString(),
                bytes: buffer.byteLength,
                run: a.manifest.run,
                coverage: a.coverage,
                packageSha256: a.packageSha256,
                data: buffer
            };
        }
        client.saveActivePackage=async function(title){
            if (!packageStore) throw error('このブラウザではパッケージ保存を利用できません。');
            if (occupied()) throw error('計算または読込の完了を待ってください。');
            busy=true;
            try {
                var active=await assets();
                var bytes=await WeatherPackage.encode(Object.assign({},active,{sampleCase:imported ? imported.sampleCase : await client.sample()}));
                var a=await WeatherPackage.decode(bytes);
                await packageStore.set(a.packageSha256,packageRecord(a,bytes,title));
                return client.listSavedPackages();
            } finally {busy=false;}
        };
        client.listSavedPackages=async function(){
            if (!packageStore) return [];
            var items=await packageStore.list();
            return items.map(function(item){
                var value=item.value || {};
                return {id:item.key,title:value.title || '名称なし',savedAt:value.savedAt || '',bytes:Number(value.bytes) || 0,
                    run:value.run || '',coverage:value.coverage || null,packageSha256:value.packageSha256 || item.key};
            }).filter(function(item){return /^[a-f0-9]{64}$/.test(item.id);})
              .sort(function(a,b){return String(b.savedAt).localeCompare(String(a.savedAt));});
        };
        client.loadSavedPackage=async function(id){
            if (!packageStore) throw error('このブラウザではパッケージ保存を利用できません。');
            if (!/^[a-f0-9]{64}$/.test(String(id || ''))) throw error('保存済みパッケージを選択してください。');
            if (occupied()) throw error('計算または読込が完了してからデータを切り替えてください。');
            busy=true;
            try {
                var record=await packageStore.get(id);
                if (!record || !(record.data instanceof ArrayBuffer)) throw error('保存済みパッケージが見つかりません。');
                var a=await WeatherPackage.decode(record.data);
                if (a.packageSha256 !== id) throw error('保存済みパッケージの検証に失敗しました。');
                reset(); imported=a; assetsPromise=Promise.resolve(a); client.provenance=null;
                return client.describe();
            } finally {busy=false;}
        };
        client.deleteSavedPackage=async function(id){
            if (!packageStore) throw error('このブラウザではパッケージ保存を利用できません。');
            if (!/^[a-f0-9]{64}$/.test(String(id || ''))) throw error('削除する保存済みパッケージを選択してください。');
            await packageStore.delete(id);
            return client.listSavedPackages();
        };
        client.useBuiltin=function(){
            if (occupied()) throw error('計算または読込が完了してからデータを切り替えてください。');
            reset(); imported=null; assetsPromise=null; client.provenance=null;
            return client.describe();
        };
        client.describe=function(){
            return JSON.parse(JSON.stringify({
                imported:Boolean(imported),
                run:imported ? imported.manifest.run : '2026-09-10T00:00:00Z',
                coverage:imported ? imported.coverage : BUILTIN_COVERAGE,
                packageSha256:imported ? imported.packageSha256 : null,
                hasSample:!imported || Boolean(imported.sampleCase),
                terrainAttribution:imported && imported.terrainMeta.source && typeof imported.terrainMeta.source.attribution === 'string'
                    ? imported.terrainMeta.source.attribution.slice(0,500) : null
            }));
        };
        client.exportPackage=async function(){
            if (occupied()) throw error('計算または読込の完了を待ってください。');
            busy=true;
            try {
                var a=await assets();
                return await WeatherPackage.encode(Object.assign({},a,{sampleCase:imported ? imported.sampleCase : await client.sample()}));
            } finally {busy=false;}
        };
        return client;
    }
    return {id:ID,onlySingleMessage:STANDARD_ONLY,parameters:parameters,create:create,getClient:function(){return singleton||(singleton=create());}};
}));
