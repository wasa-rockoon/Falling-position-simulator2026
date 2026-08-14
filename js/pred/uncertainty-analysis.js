(function (root, $, core) {
    'use strict';

    var JOB_VERSION = 1;
    var jobStore = root.PredictionJobStore ? new root.PredictionJobStore.JobStore('uncertainty-analysis') : null;
    var state = emptyState();
    var availableSites = [];
    var sitesLoaded = false;
    var runningPromise = null;
    var initialized = false;
    var uncertaintyMapLayer = null;
    var uncertaintyEllipseLayer = null;
    var uncertaintyDensityLayer = null;
    var uncertaintyMapRegistered = false;
    var uncertaintyEllipseRegistered = false;
    var uncertaintyDensityRegistered = false;
    var uncertaintyMapEventsBound = false;
    var uncertaintyCanvasRenderer = null;
    var renderedMapSamples = new Set();
    var uncertaintySummaryLayers = [];
    var SITE_COLORS = ['#6d5bd0', '#007aff', '#00a67e', '#d94880', '#9a6700', '#7950f2', '#0b7285', '#c2410c'];

    function emptyState() {
        return {
            version: JOB_VERSION,
            id: null,
            runId: null,
            status: 'idle',
            configuration: null,
            baseSettings: null,
            requestConfig: null,
            siteRuns: [],
            currentSiteIndex: 0,
            attemptedCalls: 0,
            networkCalls: 0,
            cacheHits: 0,
            pauseRequested: false,
            startedAt: null,
            completedAt: null
        };
    }

    function element(id) { return document.getElementById(id); }
    function numberValue(id) { return Number(element(id).value); }

    function formatNumber(value, digits) {
        if (!Number.isFinite(value)) return '-';
        return Number(value).toLocaleString('ja-JP', { minimumFractionDigits: digits, maximumFractionDigits: digits });
    }

    function showError(message) {
        var target = element('uncertainty_error');
        target.textContent = message;
        target.hidden = false;
    }

    function clearError() {
        element('uncertainty_error').hidden = true;
    }

    function currentSite() {
        return {
            id: 'current',
            name: '現在の入力地点',
            latitude: Number($('#lat').val()),
            longitude: Number($('#lon').val()),
            altitude: Number($('#initial_alt').val())
        };
    }


    function setLaunchDateTime(launchDatetime) {
        var parts = core.utcIsoToJstParts(launchDatetime);
        element('uncertainty_launch_date').value = parts.date;
        element('uncertainty_launch_time').value = parts.time;
    }

    function syncLaunchDateTimeFromSettings() {
        var date = [$('#year').val(), String($('#month').val()).padStart(2, '0'), String($('#day').val()).padStart(2, '0')].join('-');
        var time = [String($('#hour').val()).padStart(2, '0'), String($('#min').val()).padStart(2, '0')].join(':');
        var iso = core.jstDateTimeToUtcIso(date, time);
        setLaunchDateTime(iso);
        clearError();
    }
    async function loadSites() {
        var current = currentSite();
        if (!sitesLoaded) {
            var response = await fetch('sites.json', { headers: { Accept: 'application/json' } });
            if (!response.ok) throw new Error('放球地点データを読み込めませんでした (HTTP ' + response.status + ')');
            var data = await response.json();
            availableSites = Object.keys(data).map(function (name, index) {
                return {
                    id: 'site-' + index,
                    name: name,
                    latitude: Number(data[name].latitude),
                    longitude: Number(data[name].longitude),
                    altitude: Number(data[name].altitude)
                };
            });
            sitesLoaded = true;
        }
        availableSites = [current].concat(availableSites.filter(function (site) { return site.id !== 'current'; }));
        renderSiteChoices();
    }

    function renderSiteChoices(selectedIds) {
        var selected = new Set(selectedIds || ['current']);
        var container = element('uncertainty_sites');
        container.replaceChildren();
        availableSites.forEach(function (site) {
            var label = document.createElement('label');
            var input = document.createElement('input');
            input.type = 'checkbox';
            input.value = site.id;
            input.checked = selected.has(site.id);
            input.addEventListener('change', updateEstimate);
            var text = document.createElement('span');
            text.textContent = site.name;
            label.appendChild(input);
            label.appendChild(text);
            container.appendChild(label);
        });
    }

    function selectedSites() {
        var ids = new Set(Array.from(element('uncertainty_sites').querySelectorAll('input:checked')).map(function (input) { return input.value; }));
        return availableSites.filter(function (site) { return ids.has(site.id); });
    }

    function readConfiguration() {
        return {
            method: element('uncertainty_method').value,
            distribution: element('uncertainty_distribution').value,
            ascentCvPct: numberValue('uncertainty_ascent_cv'),
            descentCvPct: numberValue('uncertainty_descent_cv'),
            burstCvPct: numberValue('uncertainty_burst_cv'),
            seed: element('uncertainty_seed').value || 'wasa-2026',
            minSamples: Math.floor(numberValue('uncertainty_min_samples')),
            batchSize: Math.floor(numberValue('uncertainty_batch_size')),
            maxSamples: Math.floor(numberValue('uncertainty_max_samples')),
            callLimit: Math.floor(numberValue('uncertainty_call_limit')),
            probabilityTolerance: numberValue('uncertainty_probability_tolerance') / 100,
            centroidToleranceKm: numberValue('uncertainty_centroid_tolerance'),
            requiredStableBatches: 2,
            selectedSiteIds: selectedSites().map(function (site) { return site.id; })
        };
    }

    function validateConfiguration(config, sites) {
        if (!sites.length) throw new Error('放球地点を1件以上選択してください');
        ['ascentCvPct', 'descentCvPct', 'burstCvPct'].forEach(function (key) {
            if (!Number.isFinite(config[key]) || config[key] < 0 || config[key] > 100) throw new Error('変動係数は0〜100%で指定してください');
        });
        if (!Number.isFinite(config.minSamples) || config.minSamples < 4) throw new Error('最小サンプルは4以上にしてください');
        if (!Number.isFinite(config.batchSize) || config.batchSize < 2) throw new Error('バッチサイズは2以上にしてください');
        if (!Number.isFinite(config.maxSamples) || config.maxSamples < config.minSamples) throw new Error('最大サンプルは最小サンプル以上にしてください');
        if (!Number.isFinite(config.callLimit) || config.callLimit < 1) throw new Error('API呼出上限が不正です');
        var budget = core.planBudget(sites.length, config);
        if (!budget.canReachMinimum) {
            throw new Error('API上限が小さすぎます。最低でも ' + (sites.length * config.minSamples) + ' 回が必要です');
        }
        return budget;
    }

    function estimateSeconds(calls) {
        var source = $('#api_source').val() || 'sondehub';
        var secondsPerCall = source === 'local' ? 0.5 : (source === 'custom' ? 1.0 : 1.5);
        return Math.ceil(calls * secondsPerCall);
    }

    function humanDuration(seconds) {
        if (seconds < 60) return seconds + '秒';
        var minutes = Math.ceil(seconds / 60);
        return minutes < 60 ? minutes + '分' : (Math.floor(minutes / 60) + '時間' + (minutes % 60) + '分');
    }

    function updateEstimate() {
        if (!element('uncertainty_estimate')) return;
        var config = readConfiguration();
        var count = selectedSites().length;
        var budget = core.planBudget(count, config);
        var launchDate = element('uncertainty_launch_date').value || '-';
        var launchTime = element('uncertainty_launch_time').value || '-';
        var message = '解析日時（JST）: ' + launchDate + ' ' + launchTime + '<br>選択 ' + count + '地点 / 最小 ' + budget.minimumCalls + '回 / 最大 ' + budget.maximumCalls + '回';
        if (budget.reducedByLimit) message += '（上限により1地点 ' + budget.perSiteCap + '回へ縮小）';
        message += '<br>HTTP試行上限 ' + config.callLimit + '回 / 最大所要時間の概算: 約' + humanDuration(estimateSeconds(config.callLimit));
        if (!budget.canReachMinimum) message += '<br><strong>API上限を増やすか、地点数を減らしてください。</strong>';
        element('uncertainty_estimate').innerHTML = message;
    }

    function readBaseSettings() {
        if ($('#flight_profile').val() !== 'standard_profile') throw new Error('不確実性解析は標準飛行（上昇→破裂→下降）で使用してください');
        var launchDatetime = core.jstDateTimeToUtcIso(element('uncertainty_launch_date').value, element('uncertainty_launch_time').value);

        var settings = {
            profile: 'standard_profile',
            launch_datetime: launchDatetime,
            launch_latitude: Number($('#lat').val()),
            launch_longitude: Number($('#lon').val()),
            launch_altitude: Number($('#initial_alt').val()),
            ascent_rate: Number($('#ascent').val()),
            descent_rate: Number($('#drag').val()),
            burst_altitude: Number($('#burst').val())
        };
        if (settings.launch_longitude < 0) settings.launch_longitude += 360;
        Object.keys(settings).forEach(function (key) {
            if (key !== 'profile' && key !== 'launch_datetime' && !Number.isFinite(settings[key])) throw new Error('予測条件 ' + key + ' が不正です');
        });
        if (!(settings.ascent_rate > 0 && settings.descent_rate > 0 && settings.burst_altitude > settings.launch_altitude)) {
            throw new Error('上昇速度・下降速度・破裂高度を確認してください');
        }
        return settings;
    }

    function readRequestConfig() {
        var source = $('#api_source').val() || 'sondehub';
        var customUrl = ($('#api_custom_url').val() || '').trim();
        return { source: source, customUrl: customUrl, baseUrl: root.PredictionApi.resolveApiUrl(source, customUrl) };
    }


    function validateLaunchTime(baseSettings, requestConfig) {
        if (!requestConfig || requestConfig.source !== 'sondehub') return;
        var launchTime = Date.parse(baseSettings.launch_datetime);
        var now = Date.now();
        if (launchTime < now - 12 * 60 * 60 * 1000) {
            throw new Error('SondeHubでは12時間より前の解析日時を使用できません。日時を変更するか、ローカルAPIを選択してください');
        }
        if (launchTime > now + 7 * 24 * 60 * 60 * 1000) {
            throw new Error('SondeHubでは7日より先の解析日時を使用できません。日時を変更してください');
        }
    }
    function createSiteRuns(sites, budget) {
        return sites.map(function (site) {
            return {
                site: site,
                cap: budget.perSiteCap,
                cursor: 0,
                status: 'pending',
                reason: '',
                observations: [],
                sequential: null,
                consecutiveErrors: 0
            };
        });
    }

    function runRecordStatus() {
        if (state.status === 'running') return 'running';
        if (state.status === 'pausing') return 'pause_requested';
        if (state.status === 'completed') return 'completed';
        if (state.status === 'idle') return 'draft';
        return 'paused';
    }

    function uncertaintyLandings() {
        var landings = [];
        state.siteRuns.forEach(function (siteRun) {
            siteRun.observations.forEach(function (observation) {
                if (!Number.isFinite(observation.lat) || !Number.isFinite(observation.lng)) return;
                landings.push({
                    seriesId: state.runId + ':' + siteRun.site.id + ':' + observation.index,
                    latitude: observation.lat,
                    longitude: observation.lng,
                    timeUtc: state.baseSettings && state.baseSettings.launch_datetime,
                    nearestSupportPoint: null,
                    landSea: observation.landSea || {
                        classification: observation.isWater === true ? 'sea' : (observation.isWater === false ? 'land' : 'unknown'),
                        confidence: 'unknown', source: 'legacy-local', coastDistanceKm: null, dataVersion: '', reason: 'legacy-observation'
                    }
                });
            });
        });
        return landings;
    }

    function uncertaintyRunOptions(status) {
        var landings = uncertaintyLandings();
        var seaCount = landings.filter(function (landing) { return landing.landSea.classification === 'sea'; }).length;
        var landCount = landings.filter(function (landing) { return landing.landSea.classification === 'land'; }).length;
        var inlandWaterCount = landings.filter(function (landing) { return landing.landSea.classification === 'inland_water'; }).length;
        var known = seaCount + landCount + inlandWaterCount;
        var unknown = landings.length - known;
        var landSeaStatus = root.LandSea && typeof root.LandSea.getStatus === 'function' ? root.LandSea.getStatus() : {};
        var firstSite = state.siteRuns[0] && state.siteRuns[0].site || {};
        return {
            id: state.runId,
            type: 'uncertainty',
            status: status,
            title: '不確実性解析',
            input: {
                launch: {
                    latitude: firstSite.latitude != null ? firstSite.latitude : state.baseSettings && state.baseSettings.launch_latitude,
                    longitude: firstSite.longitude != null ? firstSite.longitude : state.baseSettings && state.baseSettings.launch_longitude,
                    altitudeM: firstSite.altitude != null ? firstSite.altitude : state.baseSettings && state.baseSettings.launch_altitude,
                    datetimeUtc: state.baseSettings && state.baseSettings.launch_datetime,
                    label: state.siteRuns.map(function (run) { return run.site.name; }).join(', ')
                },
                flight: {
                    ascentRateMps: state.baseSettings && state.baseSettings.ascent_rate,
                    descentRateMps: state.baseSettings && state.baseSettings.descent_rate,
                    burstAltitudeM: state.baseSettings && state.baseSettings.burst_altitude,
                    profileId: state.baseSettings && state.baseSettings.profile
                },
                api: {
                    endpointId: state.requestConfig && state.requestConfig.source,
                    resolvedBaseUrl: state.requestConfig && state.requestConfig.baseUrl,
                    maxHttpAttempts: state.configuration && state.configuration.callLimit
                },
                feature: {
                    configuration: state.configuration,
                    requestConfig: state.requestConfig,
                    sites: state.siteRuns.map(function (run) { return run.site; })
                }
            },
            progress: {
                completedUnits: state.attemptedCalls,
                totalUnits: state.configuration && state.configuration.budget ? state.configuration.budget.maximumCalls : 0,
                currentLabel: state.siteRuns[state.currentSiteIndex] ? state.siteRuns[state.currentSiteIndex].site.name : '',
                httpAttempts: state.networkCalls,
                cacheHits: state.cacheHits,
                retryCount: 0,
                requestedAction: state.pauseRequested ? 'pause' : 'none'
            },
            output: {
                trajectories: [],
                landings: landings,
                metrics: {
                    seaRate: known ? seaCount / known * 100 : null,
                    unknownRate: landings.length ? unknown / landings.length * 100 : null,
                    seaCount: seaCount,
                    landCount: landCount,
                    inlandWaterCount: inlandWaterCount,
                    unknownCount: unknown,
                    attemptedCalls: state.attemptedCalls,
                    networkCalls: state.networkCalls
                },
                candidates: state.siteRuns.map(function (run) {
                    return {
                        site: run.site,
                        status: run.status,
                        reason: run.reason,
                        completedSamples: run.cursor,
                        cap: run.cap,
                        sequential: run.sequential
                    };
                }),
                warnings: (state.status === 'error' ? ['consecutive-api-errors'] : []).concat(unknown > 0 ? [unknown + ' sample(s) have unknown land/sea results.'] : []),
                resumeSnapshot: JSON.parse(JSON.stringify(state))
            },
            provenance: {
                predictorSource: state.requestConfig && state.requestConfig.source,
                landSeaClassifierVersion: landSeaStatus.dataVersion || '',
                randomSeed: state.configuration && state.configuration.seed
            }
        };
    }

    async function persistRunRecord() {
        if (!state.runId || !root.RunRepository || !root.RunRecord) return;
        var status = runRecordStatus();
        var options = uncertaintyRunOptions(status);
        var existing = await root.RunRepository.get(state.runId);
        if (!existing) {
            await root.RunRepository.save(root.RunRecord.create(options));
            return;
        }
        await root.RunRepository.update(state.runId, {
            status: status,
            input: options.input,
            progress: options.progress,
            output: options.output,
            provenance: options.provenance
        });
    }

    async function persist() {
        if (jobStore) await jobStore.save(state);
        try {
            await persistRunRecord();
        } catch (error) {
            if (typeof root.reportNonFatalError === 'function') root.reportNonFatalError(error, 'uncertainty.run-record');
        }
    }

    function configureNewAnalysis() {
        var config = readConfiguration();
        var sites = selectedSites();
        var budget = validateConfiguration(config, sites);
        var baseSettings = readBaseSettings();
        var requestConfig = readRequestConfig();
        validateLaunchTime(baseSettings, requestConfig);
        state = emptyState();
        state.id = root.RunRecord ? root.RunRecord.makeId('run') : 'uncertainty-' + Date.now().toString(36);
        state.runId = state.id;
        state.status = 'paused';
        state.configuration = Object.assign({}, config, { budget: budget });
        state.baseSettings = baseSettings;
        state.requestConfig = requestConfig;
        state.siteRuns = createSiteRuns(sites, budget);
        state.startedAt = new Date().toISOString();
        return persist();
    }

    function sampleSettings(run) {
        var base = Object.assign({}, state.baseSettings, {
            launch_latitude: run.site.latitude,
            launch_longitude: run.site.longitude < 0 ? run.site.longitude + 360 : run.site.longitude,
            launch_altitude: run.site.altitude
        });
        return core.createParameterSamples(base, {
            method: state.configuration.method,
            distribution: state.configuration.distribution,
            count: run.cap,
            ascentCvPct: state.configuration.ascentCvPct,
            descentCvPct: state.configuration.descentCvPct,
            burstCvPct: state.configuration.burstCvPct,
            seed: state.configuration.seed + '|' + run.site.id
        });
    }

    function requestParameters(run, sample) {
        return Object.assign({}, state.baseSettings, {
            launch_latitude: run.site.latitude,
            launch_longitude: run.site.longitude < 0 ? run.site.longitude + 360 : run.site.longitude,
            launch_altitude: run.site.altitude,
            ascent_rate: sample.ascent_rate,
            descent_rate: sample.descent_rate,
            burst_altitude: sample.burst_altitude
        });
    }

    function classifyLanding(landing) {
        if (root.LandSea && typeof root.LandSea.classify === 'function') return root.LandSea.classify(landing.lat, landing.lng);
        return {
            classification: 'unknown', confidence: 'unknown', source: 'unavailable',
            coastDistanceKm: null, dataVersion: '', reason: 'classifier-unavailable'
        };
    }

    function legacyIsWater(landSea) {
        if (landSea.classification === 'sea') return true;
        if (landSea.classification === 'land') return false;
        return null;
    }
    function evaluateRun(run) {
        run.sequential = core.evaluateSequentialStop(run.observations, {
            minSamples: state.configuration.minSamples,
            probabilityTolerance: state.configuration.probabilityTolerance,
            centroidToleranceKm: state.configuration.centroidToleranceKm,
            requiredStableBatches: state.configuration.requiredStableBatches
        }, run.sequential);
        if (run.sequential.stop) {
            run.status = 'completed';
            run.reason = 'converged';
        } else if (run.cursor >= run.cap) {
            run.status = 'completed';
            run.reason = 'maximum';
        }
    }

    function resultSummary(run) {
        return run.sequential ? run.sequential.summary : core.summarizeObservations(run.observations);
    }

    function statusLabel(run) {
        if (run.status === 'completed') return run.reason === 'converged' ? '収束・早期終了' : '上限まで完了';
        if (run.status === 'running') return '解析中';
        if (run.status === 'error') return 'APIエラーで中断';
        if (run.status === 'paused') return '中断';
        return '待機';
    }

    function validMapObservation(observation) {
        return observation && Number.isFinite(Number(observation.lat)) && Number.isFinite(Number(observation.lng));
    }

    function appendPopupLine(container, label, value) {
        var line = document.createElement('div');
        var title = document.createElement('strong');
        title.textContent = label + ': ';
        line.appendChild(title);
        line.appendChild(document.createTextNode(value));
        container.appendChild(line);
    }

    function samplePopup(run, observation) {
        var content = document.createElement('div');
        content.className = 'uncertainty-map-popup';
        var heading = document.createElement('strong');
        heading.textContent = run.site.name + ' / サンプル ' + (observation.index + 1);
        content.appendChild(heading);
        var classification = observation.landSea && observation.landSea.classification;
        var classificationLabel = classification === 'sea' ? '海上' : (classification === 'land' ? '陸上' : (classification === 'inland_water' ? '内水面' : '未判定'));
        appendPopupLine(content, '判定', classificationLabel);
        appendPopupLine(content, '上昇', formatNumber(observation.ascentRate, 2) + ' m/s');
        appendPopupLine(content, '下降', formatNumber(observation.descentRate, 2) + ' m/s');
        appendPopupLine(content, '破裂高度', formatNumber(observation.burstAltitude, 0) + ' m');
        appendPopupLine(content, '着地点', formatNumber(observation.lat, 4) + ', ' + formatNumber(observation.lng, 4));
        return content;
    }

    function summaryPopup(run, summary) {
        var content = document.createElement('div');
        content.className = 'uncertainty-map-popup';
        var heading = document.createElement('strong');
        heading.textContent = run.site.name + ' / 不確実性解析';
        content.appendChild(heading);
        appendPopupLine(content, '有効サンプル', String(summary.valid));
        if (summary.seaProbability != null) {
            appendPopupLine(content, '海上率', formatNumber(summary.seaProbability * 100, 1) + '%（95% CI ' +
                formatNumber(summary.seaInterval.low * 100, 1) + '–' + formatNumber(summary.seaInterval.high * 100, 1) + '%）');
        }
        appendPopupLine(content, '分類内訳', '海 ' + summary.sea + ' / 陸 ' + summary.land + ' / 内水面 ' + summary.inlandWater + ' / 不明 ' + summary.unknown);
        appendPopupLine(content, '平均着地点', formatNumber(summary.mean.lat, 4) + ', ' + formatNumber(summary.mean.lng, 4));
        if (summary.ellipse95) {
            appendPopupLine(content, '95%確率楕円', formatNumber(summary.ellipse95.majorKm, 2) + ' × ' +
                formatNumber(summary.ellipse95.minorKm, 2) + ' km（長軸方位 ' + formatNumber(summary.ellipse95.bearingDeg, 0) + '°）');
        }
        appendPopupLine(content, '95%到達距離', formatNumber(summary.radius95Km, 2) + ' km');
        return content;
    }

    function syncMapOption(layer, checked) {
        var id = null;
        if (layer === uncertaintyMapLayer) id = 'uncertainty_show_points';
        else if (layer === uncertaintyEllipseLayer) id = 'uncertainty_show_ellipse';
        else if (layer === uncertaintyDensityLayer) id = 'uncertainty_show_density';
        var input = id ? element(id) : null;
        if (input) input.checked = checked;
    }

    function ensureUncertaintyMapLayer() {
        if (!root.map || !root.L || typeof root.L.featureGroup !== 'function') return null;
        if (!uncertaintyMapLayer) {
            uncertaintyMapLayer = root.L.featureGroup().addTo(root.map);
            uncertaintyEllipseLayer = root.L.featureGroup().addTo(root.map);
            uncertaintyDensityLayer = root.L.featureGroup();
            if (typeof root.L.canvas === 'function') uncertaintyCanvasRenderer = root.L.canvas({ padding: 0.5 });
        }
        if (root.mapLayerControl && typeof root.mapLayerControl.addOverlay === 'function') {
            if (!uncertaintyMapRegistered) {
                root.mapLayerControl.addOverlay(uncertaintyMapLayer, '不確実性: 着地点');
                uncertaintyMapRegistered = true;
            }
            if (!uncertaintyEllipseRegistered) {
                root.mapLayerControl.addOverlay(uncertaintyEllipseLayer, '不確実性: 95%楕円');
                uncertaintyEllipseRegistered = true;
            }
            if (!uncertaintyDensityRegistered) {
                root.mapLayerControl.addOverlay(uncertaintyDensityLayer, '不確実性: 密度等高線');
                uncertaintyDensityRegistered = true;
            }
        }
        if (!uncertaintyMapEventsBound && typeof root.map.on === 'function') {
            root.map.on('overlayadd', function (event) { syncMapOption(event.layer, true); });
            root.map.on('overlayremove', function (event) { syncMapOption(event.layer, false); });
            uncertaintyMapEventsBound = true;
        }
        return uncertaintyMapLayer;
    }

    function setLayerVisibility(layer, visible) {
        if (!layer || !root.map) return;
        if (visible && !root.map.hasLayer(layer)) layer.addTo(root.map);
        if (!visible && root.map.hasLayer(layer)) root.map.removeLayer(layer);
    }

    function applyUncertaintyMapVisibility() {
        ensureUncertaintyMapLayer();
        var pointsInput = element('uncertainty_show_points');
        var ellipseInput = element('uncertainty_show_ellipse');
        var densityInput = element('uncertainty_show_density');
        setLayerVisibility(uncertaintyMapLayer, !pointsInput || pointsInput.checked);
        setLayerVisibility(uncertaintyEllipseLayer, !ellipseInput || ellipseInput.checked);
        setLayerVisibility(uncertaintyDensityLayer, Boolean(densityInput && densityInput.checked));
    }

    function clearUncertaintyMap() {
        [uncertaintyMapLayer, uncertaintyEllipseLayer, uncertaintyDensityLayer].forEach(function (layer) {
            if (layer) layer.clearLayers();
        });
        renderedMapSamples.clear();
        uncertaintySummaryLayers = [];
    }

    function densityStyle(mass) {
        if (mass <= 0.5) return { color: '#d94880', weight: 3.2, dashArray: null };
        if (mass <= 0.8) return { color: '#f59f00', weight: 2.7, dashArray: '9 5' };
        return { color: '#1687d9', weight: 2.3, dashArray: '3 5' };
    }

    function renderUncertaintyMap() {
        var mappedCount = state.siteRuns.reduce(function (total, run) {
            return total + run.observations.filter(validMapObservation).length;
        }, 0);
        if (!mappedCount) return 0;
        var layerGroup = ensureUncertaintyMapLayer();
        if (!layerGroup) return 0;

        uncertaintySummaryLayers.forEach(function (layer) {
            if (layerGroup.hasLayer(layer)) layerGroup.removeLayer(layer);
        });
        uncertaintySummaryLayers = [];
        uncertaintyEllipseLayer.clearLayers();
        uncertaintyDensityLayer.clearLayers();

        state.siteRuns.forEach(function (run, runIndex) {
            run.observations.forEach(function (observation) {
                if (!validMapObservation(observation)) return;
                var key = (state.id || 'restored') + '|' + run.site.id + '|' + observation.index;
                if (renderedMapSamples.has(key)) return;
                var classification = observation.landSea && observation.landSea.classification;
                var outcomeColor = classification === 'sea' ? '#1687d9' : (classification === 'land' ? '#f28c28' : (classification === 'inland_water' ? '#7b61a8' : '#7d8796'));
                var markerOptions = {
                    radius: 3.5,
                    color: '#ffffff',
                    weight: 1,
                    opacity: 0.85,
                    fillColor: outcomeColor,
                    fillOpacity: 0.72
                };
                if (uncertaintyCanvasRenderer) markerOptions.renderer = uncertaintyCanvasRenderer;
                var marker = root.L.circleMarker([Number(observation.lat), Number(observation.lng)], markerOptions);
                marker.bindPopup(samplePopup(run, observation));
                marker.addTo(layerGroup);
                renderedMapSamples.add(key);
            });

            var summary = resultSummary(run);
            if (!summary.mean || !Number.isFinite(summary.mean.lat) || !Number.isFinite(summary.mean.lng)) return;
            var siteColor = SITE_COLORS[runIndex % SITE_COLORS.length];
            var launchMarker = root.L.circleMarker([run.site.latitude, run.site.longitude], {
                radius: 4,
                color: siteColor,
                weight: 2,
                fillColor: siteColor,
                fillOpacity: 0.35,
                dashArray: '3 2'
            }).bindTooltip(run.site.name + ' 放球地点');
            launchMarker.addTo(layerGroup);
            uncertaintySummaryLayers.push(launchMarker);

            if (summary.ellipse95 && Array.isArray(summary.ellipse95.coordinates)) {
                var ellipse = root.L.polygon(summary.ellipse95.coordinates.map(function (coordinate) {
                    return [coordinate.lat, coordinate.lng];
                }), {
                    color: siteColor,
                    weight: 2.4,
                    opacity: 0.95,
                    dashArray: '8 5',
                    fillColor: siteColor,
                    fillOpacity: 0.08
                });
                ellipse.bindPopup(summaryPopup(run, summary));
                ellipse.bindTooltip(run.site.name + ' 95%確率楕円');
                ellipse.addTo(uncertaintyEllipseLayer);
            }

            if (summary.densityContours && Array.isArray(summary.densityContours.levels)) {
                summary.densityContours.levels.forEach(function (level) {
                    if (!Array.isArray(level.segments) || !level.segments.length) return;
                    var style = densityStyle(level.mass);
                    var contour = root.L.polyline(level.segments.map(function (segment) {
                        return segment.map(function (coordinate) { return [coordinate.lat, coordinate.lng]; });
                    }), {
                        color: style.color,
                        weight: style.weight,
                        opacity: 0.92,
                        dashArray: style.dashArray,
                        lineCap: 'round',
                        lineJoin: 'round'
                    });
                    contour.bindTooltip(run.site.name + ' 密度 ' + Math.round(level.mass * 100) + '%');
                    contour.addTo(uncertaintyDensityLayer);
                });
            }

            var meanMarker = root.L.circleMarker([summary.mean.lat, summary.mean.lng], {
                radius: 7,
                color: siteColor,
                weight: 3,
                fillColor: '#ffffff',
                fillOpacity: 0.95
            });
            meanMarker.bindPopup(summaryPopup(run, summary));
            meanMarker.bindTooltip(run.site.name + ' 平均着地点');
            meanMarker.addTo(layerGroup);
            uncertaintySummaryLayers.push(meanMarker);
        });
        applyUncertaintyMapVisibility();
        return mappedCount;
    }

    function boundsForRun(run) {
        var bounds = root.L.latLngBounds([]);
        run.observations.filter(validMapObservation).forEach(function (observation) {
            bounds.extend([Number(observation.lat), Number(observation.lng)]);
        });
        var summary = resultSummary(run);
        if (summary.mean) bounds.extend([summary.mean.lat, summary.mean.lng]);
        if (summary.ellipse95 && Array.isArray(summary.ellipse95.coordinates)) {
            summary.ellipse95.coordinates.forEach(function (coordinate) { bounds.extend([coordinate.lat, coordinate.lng]); });
        }
        return bounds;
    }

    function combinedUncertaintyBounds() {
        var bounds = root.L.latLngBounds([]);
        [uncertaintyMapLayer, uncertaintyEllipseLayer, uncertaintyDensityLayer].forEach(function (layer) {
            if (!layer || !root.map.hasLayer(layer) || typeof layer.getBounds !== 'function') return;
            var layerBounds = layer.getBounds();
            if (layerBounds && layerBounds.isValid()) bounds.extend(layerBounds);
        });
        return bounds;
    }

    function viewUncertaintyMap(siteId) {
        var mappedCount = renderUncertaintyMap();
        var layerGroup = ensureUncertaintyMapLayer();
        if (!mappedCount || !layerGroup) {
            if (root.showToast) root.showToast('地図に表示できる着地点がまだありません', 'warning', 2500);
            return;
        }
        applyUncertaintyMapVisibility();
        var anyVisible = [uncertaintyMapLayer, uncertaintyEllipseLayer, uncertaintyDensityLayer].some(function (layer) {
            return layer && root.map.hasLayer(layer);
        });
        if (!anyVisible) {
            element('uncertainty_show_points').checked = true;
            applyUncertaintyMapVisibility();
        }
        var selectedRun = siteId ? state.siteRuns.find(function (run) { return run.site.id === siteId; }) : null;
        var bounds = selectedRun ? boundsForRun(selectedRun) : combinedUncertaintyBounds();
        if (!bounds || !bounds.isValid()) return;
        element('uncertainty_modal').hidden = true;
        element('open_uncertainty_btn').focus();
        root.setTimeout(function () {
            root.map.invalidateSize();
            root.map.fitBounds(bounds.pad(0.08), { padding: [28, 28], maxZoom: 11 });
        }, 60);
        if (root.showToast) root.showToast('選択した不確実性レイヤーを地図に表示しました', 'info', 3000);
    }
    function renderResults() {
        var body = element('uncertainty_result_body');
        body.replaceChildren();
        state.siteRuns.forEach(function (run) {
            var summary = resultSummary(run);
            var row = document.createElement('tr');
            var hasMapPoints = run.observations.some(validMapObservation);
            row.className = 'uncertainty-result-row';
            row.dataset.status = run.status;
            row.dataset.hasMap = String(hasMapPoints);
            var probability = summary.seaProbability == null ? '-' :
                formatNumber(summary.seaProbability * 100, 1) + '% (' + formatNumber(summary.seaInterval.low * 100, 1) + '–' + formatNumber(summary.seaInterval.high * 100, 1) + '%)' +
                (summary.unknown > 0 ? ' / 不明 ' + summary.unknown : '') + (summary.inlandWater > 0 ? ' / 内水面 ' + summary.inlandWater : '');
            var mean = summary.mean ? formatNumber(summary.mean.lat, 4) + ', ' + formatNumber(summary.mean.lng, 4) : '-';
            var ellipseSize = summary.ellipse95 ? formatNumber(summary.ellipse95.majorKm, 2) + ' × ' + formatNumber(summary.ellipse95.minorKm, 2) + ' km' : '-';
            [run.site.name, run.cursor + ' / ' + run.cap, probability, mean, ellipseSize, statusLabel(run)].forEach(function (value) {
                var cell = document.createElement('td');
                cell.textContent = value;
                row.appendChild(cell);
            });
            if (hasMapPoints) {
                row.tabIndex = 0;
                row.title = 'クリックしてこの地点の不確実性範囲を地図で確認';
                row.addEventListener('click', function () { viewUncertaintyMap(run.site.id); });
                row.addEventListener('keydown', function (event) {
                    if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        viewUncertaintyMap(run.site.id);
                    }
                });
            }
            body.appendChild(row);
        });
        var mappedSamples = renderUncertaintyMap();
        var mapButton = element('uncertainty_map_view');
        mapButton.disabled = mappedSamples === 0;
        mapButton.textContent = mappedSamples ? '地図で確認（' + mappedSamples + '点）' : '地図で確認';
        var maximum = state.configuration && state.configuration.budget ? state.configuration.budget.maximumCalls : 0;
        var percent = maximum ? Math.min(100, state.attemptedCalls / maximum * 100) : 0;
        element('uncertainty_progress_bar').style.width = percent + '%';
        element('uncertainty_progress_text').textContent = 'サンプル ' + state.attemptedCalls + ' / 最大 ' + maximum + '（HTTP試行 ' + state.networkCalls + ' / 上限 ' + (state.configuration ? state.configuration.callLimit : 0) + '、キャッシュ ' + state.cacheHits + '）';
        var label = { idle: '未実行', running: '解析中', pausing: '中断待ち', paused: '中断中', completed: '完了', error: 'エラーで中断' }[state.status] || state.status;
        element('uncertainty_status').textContent = label;
        element('uncertainty_export').disabled = !state.siteRuns.some(function (run) { return run.observations.length > 0; });
        element('uncertainty_pause').disabled = state.status !== 'running' && state.status !== 'pausing';
        element('uncertainty_start').disabled = state.status === 'running' || state.status === 'pausing';
        element('uncertainty_start').textContent = state.status === 'paused' || state.status === 'error' ? '解析再開' : (state.status === 'completed' ? '完了' : '解析開始');
        element('uncertainty_start').disabled = element('uncertainty_start').disabled || state.status === 'completed';
        Array.from(document.querySelectorAll('.uncertainty-config fieldset')).forEach(function (fieldset) {
            fieldset.disabled = state.status !== 'idle';
        });
        element('uncertainty_new').disabled = state.status === 'running' || state.status === 'pausing';
    }

    async function pauseAtBoundary(run) {
        state.status = 'paused';
        state.pauseRequested = false;
        if (run && run.status === 'running') run.status = 'paused';
        await persist();
        renderResults();
        if (root.showToast) root.showToast('現在のAPI呼出完了後に解析を中断しました', 'info', 3500);
    }

    async function executeAnalysis() {
        if (!root.PredictionRunner) throw new Error('PredictionRunner is unavailable');
        var requestContext = root.PredictionRunner.createContext({
            runId: state.runId,
            source: state.requestConfig.source,
            baseUrl: state.requestConfig.baseUrl,
            customUrl: state.requestConfig.customUrl,
            maxHttpAttempts: state.configuration.callLimit
        });
        state.status = 'running';
        state.pauseRequested = false;
        renderResults();
        await persist();
        for (var siteIndex = state.currentSiteIndex; siteIndex < state.siteRuns.length; siteIndex += 1) {
            var run = state.siteRuns[siteIndex];
            state.currentSiteIndex = siteIndex;
            if (run.status === 'completed') continue;
            run.status = 'running';
            var samples = sampleSettings(run);
            while (run.cursor < run.cap) {
                if (state.pauseRequested) {
                    await pauseAtBoundary(run);
                    return;
                }
                var sample = samples[run.cursor];
                var params = requestParameters(run, sample);
                state.attemptedCalls += 1;
                try {
                    var execution = await root.PredictionRunner.run(params, requestContext, {
                        label: 'uncertainty:' + run.site.id + ':' + run.cursor,
                        canAttempt: function () { return state.networkCalls < state.configuration.callLimit; },
                        onAttempt: function () { state.networkCalls += 1; }
                    });
                    var response = execution.response;
                    var landing = { lat: execution.landing.latitude, lng: execution.landing.longitude, altitude: execution.landing.altitudeM, datetime: execution.landing.timeUtc || '' };
                    var landSea = classifyLanding(landing);
                    run.observations.push({
                        index: run.cursor,
                        ascentRate: sample.ascent_rate,
                        descentRate: sample.descent_rate,
                        burstAltitude: sample.burst_altitude,
                        lat: landing.lat,
                        lng: landing.lng,
                        isWater: legacyIsWater(landSea),
                        landSea: landSea,
                        cacheHit: response.cacheHit
                    });
                    if (response.cacheHit) state.cacheHits += 1;

                    run.consecutiveErrors = 0;
                } catch (error) {
                    run.observations.push({ index: run.cursor, error: error && error.message ? error.message : String(error) });
                    run.consecutiveErrors += 1;
                    if (typeof root.reportNonFatalError === 'function') root.reportNonFatalError(error, 'uncertainty.request');
                }
                run.cursor += 1;
                var boundary = run.cursor % state.configuration.batchSize === 0 || run.cursor >= run.cap;
                if (boundary) evaluateRun(run);
                await persist();
                renderResults();
                if (run.consecutiveErrors >= 3) {
                    run.status = 'error';
                    run.reason = 'consecutive-errors';
                    state.status = 'error';
                    await persist();
                    renderResults();
                    showError('同じ地点でAPIエラーが3回連続したため中断しました。API状態を確認して再開してください。');
                    return;
                }
                if (state.pauseRequested) {
                    await pauseAtBoundary(run);
                    return;
                }
                if (run.status === 'completed') break;
            }
            if (run.status !== 'completed') {
                evaluateRun(run);
                if (run.status !== 'completed') {
                    run.status = 'completed';
                    run.reason = 'maximum';
                }
            }
            state.currentSiteIndex = siteIndex + 1;
            await persist();
            renderResults();
        }
        state.status = 'completed';
        state.completedAt = new Date().toISOString();
        await persist();
        renderResults();
        if (root.showToast) root.showToast('不確実性解析が完了しました', 'success', 4000);
    }

    async function startOrResume() {
        if (runningPromise) return;
        clearError();
        try {
            if (state.status === 'idle') await configureNewAnalysis();
            if (state.status === 'completed') return;
            state.siteRuns.forEach(function (run) {
                if (run.status === 'paused' || run.status === 'error') {
                    run.status = 'pending';
                    run.consecutiveErrors = 0;
                }
            });
            runningPromise = executeAnalysis();
            await runningPromise;
        } catch (error) {
            state.status = state.siteRuns.length ? 'error' : 'idle';
            showError(error && error.message ? error.message : String(error));
            if (typeof root.reportNonFatalError === 'function') root.reportNonFatalError(error, 'uncertainty.start');
            renderResults();
        } finally {
            runningPromise = null;
        }
    }

    function requestPause() {
        if (state.status !== 'running') return;
        state.pauseRequested = true;
        state.status = 'pausing';
        renderResults();
    }

    async function newAnalysis() {
        if (state.status === 'running' || state.status === 'pausing') return;
        var previousRunId = state.runId;
        if (previousRunId && root.RunRepository) {
            try {
                var previous = await root.RunRepository.get(previousRunId);
                if (previous && root.RunRecord.activeStatuses.indexOf(previous.status) !== -1) {
                    await root.RunRepository.update(previousRunId, { status: 'cancelled' });
                }
            } catch (error) {
                if (typeof root.reportNonFatalError === 'function') root.reportNonFatalError(error, 'uncertainty.cancel-record');
            }
        }
        state = emptyState();
        clearUncertaintyMap();
        if (jobStore) await jobStore.clear();
        renderSiteChoices(['current']);
        syncLaunchDateTimeFromSettings();
        clearError();
        renderResults();
        updateEstimate();
    }

    function applyConfiguration(config) {
        var mapping = {
            method: 'uncertainty_method', distribution: 'uncertainty_distribution', ascentCvPct: 'uncertainty_ascent_cv',
            descentCvPct: 'uncertainty_descent_cv', burstCvPct: 'uncertainty_burst_cv', seed: 'uncertainty_seed',
            minSamples: 'uncertainty_min_samples', batchSize: 'uncertainty_batch_size', maxSamples: 'uncertainty_max_samples',
            callLimit: 'uncertainty_call_limit', centroidToleranceKm: 'uncertainty_centroid_tolerance'
        };
        Object.keys(mapping).forEach(function (key) { if (config[key] != null) element(mapping[key]).value = config[key]; });
        if (config.probabilityTolerance != null) element('uncertainty_probability_tolerance').value = config.probabilityTolerance * 100;
        renderSiteChoices(config.selectedSiteIds || ['current']);
    }

    async function restore() {
        if (state.status !== 'idle') return;
        var saved = jobStore ? await jobStore.load() : null;
        if ((!saved || saved.version !== JOB_VERSION) && root.RunRepository) {
            var activeRuns = await root.RunRepository.getActive('uncertainty');
            var fallbackRuns = activeRuns.length ? activeRuns : await root.RunRepository.listRuns({ type: 'uncertainty' });
            var latestRun = fallbackRuns[0];
            if (latestRun && latestRun.output && latestRun.output.resumeSnapshot) {
                saved = latestRun.output.resumeSnapshot;
            }
        }
        if (!saved || saved.version !== JOB_VERSION) return;
        clearUncertaintyMap();
        state = Object.assign(emptyState(), saved);
        if (!state.runId) state.runId = state.id || (root.RunRecord ? root.RunRecord.makeId('run') : '');
        if (state.status === 'running' || state.status === 'pausing') state.status = 'paused';
        state.pauseRequested = false;
        if (state.configuration) applyConfiguration(state.configuration);
        if (state.baseSettings && state.baseSettings.launch_datetime) setLaunchDateTime(state.baseSettings.launch_datetime);
        renderResults();
        await persist();
    }

    function downloadCsv() {
        var rows = [['site', 'launch_datetime_utc', 'sample', 'ascent_rate_m_s', 'descent_rate_m_s', 'burst_altitude_m', 'landing_lat', 'landing_lon', 'classification', 'confidence', 'source', 'coast_distance_km', 'data_version', 'is_water_legacy', 'cache_hit', 'error']];
        state.siteRuns.forEach(function (run) {
            run.observations.forEach(function (observation) {
                rows.push([
                    run.site.name, state.baseSettings ? state.baseSettings.launch_datetime : '', observation.index + 1, observation.ascentRate, observation.descentRate, observation.burstAltitude,
                    observation.lat, observation.lng,
                    observation.landSea && observation.landSea.classification || 'unknown',
                    observation.landSea && observation.landSea.confidence || 'unknown',
                    observation.landSea && observation.landSea.source || 'unavailable',
                    observation.landSea && observation.landSea.coastDistanceKm != null ? observation.landSea.coastDistanceKm : '',
                    observation.landSea && observation.landSea.dataVersion || '',
                    observation.isWater == null ? '' : observation.isWater, observation.cacheHit == null ? '' : observation.cacheHit,
                    observation.error || ''
                ]);
            });
        });
        if (!root.ExportService) throw new Error('ExportService is unavailable');
        var csv = rows.map(function (row) { return row.map(root.ExportService.escapeCsv).join(','); }).join('\r\n');
        root.ExportService.download(csv, 'uncertainty_results_' + new Date().toISOString().replace(/[:.]/g, '-') + '.csv', 'text/csv;charset=utf-8');
    }

    async function open() {
        element('uncertainty_modal').hidden = false;
        try {
            if (!element('uncertainty_launch_date').value || !element('uncertainty_launch_time').value) syncLaunchDateTimeFromSettings();
            await loadSites();
            await restore();
            updateEstimate();
            renderResults();
            element('uncertainty_method').focus();
        } catch (error) {
            showError(error && error.message ? error.message : String(error));
        }
    }

    function close() {
        if (state.status === 'running') requestPause();
        element('uncertainty_modal').hidden = true;
        element('open_uncertainty_btn').focus();
    }

    function init() {
        if (initialized) return;
        initialized = true;
        if (root.UncertaintyTemplate) root.UncertaintyTemplate.mount();
        if (!core || !element('uncertainty_modal')) return;
        element('open_uncertainty_btn').addEventListener('click', open);
        element('uncertainty_close').addEventListener('click', close);
        element('uncertainty_backdrop').addEventListener('click', close);
        element('uncertainty_start').addEventListener('click', startOrResume);
        element('uncertainty_pause').addEventListener('click', requestPause);
        element('uncertainty_new').addEventListener('click', newAnalysis);
        element('uncertainty_sync_datetime').addEventListener('click', syncLaunchDateTimeFromSettings);
        element('uncertainty_map_view').addEventListener('click', function () { viewUncertaintyMap(); });
        ['uncertainty_show_points', 'uncertainty_show_ellipse', 'uncertainty_show_density'].forEach(function (id) {
            element(id).addEventListener('change', applyUncertaintyMapVisibility);
        });
        element('uncertainty_export').addEventListener('click', downloadCsv);
        element('uncertainty_select_all').addEventListener('click', function () {
            element('uncertainty_sites').querySelectorAll('input').forEach(function (input) { input.checked = true; });
            updateEstimate();
        });
        element('uncertainty_select_none').addEventListener('click', function () {
            element('uncertainty_sites').querySelectorAll('input').forEach(function (input) { input.checked = input.value === 'current'; });
            updateEstimate();
        });
        element('uncertainty_modal').querySelectorAll('input, select').forEach(function (input) {
            input.addEventListener('input', updateEstimate);
            input.addEventListener('change', updateEstimate);
        });
        document.addEventListener('keydown', function (event) {
            if (event.key === 'Escape' && !element('uncertainty_modal').hidden) close();
        });
        renderResults();
    }

    root.UncertaintyAnalysis = {
        open: open,
        pause: requestPause,
        getState: function () { return state; },
        estimate: updateEstimate,
        viewMap: viewUncertaintyMap,
        clearMap: clearUncertaintyMap
    };
    root.AppShell.registerInitializer('uncertainty-analysis', init, 60);
}(window, window.jQuery, window.UncertaintyCore));
