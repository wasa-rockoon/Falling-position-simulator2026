(function (root, $) {
    'use strict';

    var JOB_TYPE = 'automatic-launch-search';
    var JOB_VERSION = 2;
    var MAX_OFFSHORE_KM = 22.2;
    var WEATHER_SECONDS_PER_CALL = 1.2;
    var PREDICTION_SECONDS_PER_CALL = 1.5;
    var FINE_VARIANT_COUNT = 13;
    var jobStore = root.PredictionJobStore ? new root.PredictionJobStore.JobStore(JOB_TYPE) : null;
    var weatherDayCache = new Map();
    var supportPoints = [];
    var recoveryPoints = [];
    var initialized = false;

    var MODES = {
        fast: {
            label: '高速探索（粗探索で除外）',
            description: '粗探索で陸上・沖合超過の候補を除外してから精密探索します。'
        },
        full: {
            label: '全候補精密探索（粗探索で除外しない）',
            description: '粗探索結果は記録だけに使い、天候条件を通過した全候補を精密探索します。'
        },
        ranked: {
            label: '段階的精密探索（良い候補から実行）',
            description: '粗探索で候補を除外せず、海上・沿岸に近い候補を先に精密探索します。'
        }
    };

    function emptyState() {
        return {
            version: JOB_VERSION,
            phase: 0,
            status: 'idle',
            running: false,
            pauseRequested: false,
            mode: 'fast',
            queue: [],
            p1Passed: [],
            coarseCandidates: [],
            fineCandidates: [],
            results: [],
            matches: {},
            phaseIndex: 0,
            total: 0,
            done: 0,
            configuration: null,
            runSettings: null,
            requestConfig: null,
            requestContext: null
        };
    }

    var state = emptyState();

    function notify(message, type) {
        if (typeof root.showToast === 'function') root.showToast(message, type || 'info', 3200);
        else if (type === 'error' && typeof root.throwError === 'function') root.throwError(message);
        else if (type === 'error' && root.console) root.console.error(message);
    }

    function finiteNumber(value, fallback) {
        var number = Number(value);
        return Number.isFinite(number) ? number : fallback;
    }

    function jstToUtcMoment(dateString, timeString) {
        if (!dateString || !timeString || typeof root.moment === 'undefined') return null;
        var parts = dateString.split('-').map(Number);
        var timeParts = timeString.split(':').map(Number);
        if (parts.length !== 3 || timeParts.length < 2 || parts.some(Number.isNaN) || timeParts.some(Number.isNaN)) return null;
        var local = root.moment.tz
            ? root.moment.tz([parts[0], parts[1] - 1, parts[2], timeParts[0], timeParts[1], 0], 'Asia/Tokyo')
            : root.moment([parts[0], parts[1] - 1, parts[2], timeParts[0], timeParts[1], 0]).utcOffset(9 * 60);
        return local.isValid() ? local.utc() : null;
    }

    function candidateMoment(candidate) {
        return root.moment.utc(candidate.launchUtc);
    }

    function serializeState() {
        var snapshot = Object.assign({}, state);
        delete snapshot.requestContext;
        snapshot.running = false;
        if (snapshot.status === 'running' || snapshot.status === 'pausing') snapshot.status = 'paused';
        return snapshot;
    }

    async function persistState() {
        if (jobStore) await jobStore.save(serializeState());
    }

    async function clearPersistedState() {
        if (jobStore) await jobStore.clear();
    }

    function createRequestContextFromConfig(config) {
        if (!config || typeof root.createPredictionRequestContext !== 'function') return null;
        return root.createPredictionRequestContext({ source: config.source, baseUrl: config.baseUrl, customUrl: config.customUrl });
    }

    function updateStepIndicators(activePhase) {
        [1, 2, 3].forEach(function (phase) {
            var element = document.getElementById('step_indicator_' + phase);
            if (!element) return;
            if (phase < activePhase || activePhase === 4) {
                element.style.color = 'var(--text-secondary)';
                element.style.borderBottom = '3px solid var(--color-accent)';
            } else if (phase === activePhase) {
                element.style.color = 'var(--color-primary)';
                element.style.borderBottom = '3px solid var(--color-primary)';
            } else {
                element.style.color = 'var(--text-secondary)';
                element.style.borderBottom = '3px solid var(--border-color)';
            }
        });
    }

    function updateProgress(statusHtml, done, total, activePhase) {
        $('#auto_progress_text').text(done + ' / ' + total);
        var percent = total > 0 ? Math.round((done / total) * 100) : 0;
        $('#auto_progress_bar').css('width', percent + '%');
        if (statusHtml) $('#auto_estimate_text').html(statusHtml);
        updateStepIndicators(activePhase || 0);
    }

    function selectedSites() {
        var sites = [];
        $('#auto_sites_container input[type=checkbox]:checked').each(function () {
            sites.push({
                name: String($(this).data('name')),
                lat: finiteNumber($(this).data('lat'), NaN),
                lon: finiteNumber($(this).data('lon'), NaN),
                alt: finiteNumber($(this).data('alt'), 0)
            });
        });
        return sites.filter(function (site) { return Number.isFinite(site.lat) && Number.isFinite(site.lon); });
    }

    function populateSites(selectedNames) {
        selectedNames = selectedNames || [];
        var selectedSet = new Set(selectedNames);
        var container = $('#auto_sites_container').empty().append('<div class="auto-muted">読み込み中...</div>');
        return new Promise(function (resolve) {
            $.getJSON('sites.json').done(function (sites) {
                container.empty();
                Object.keys(sites).forEach(function (name) {
                    var site = sites[name];
                    var id = 'auto_site_' + name.replace(/[^a-z0-9_-]/ig, '_');
                    var checkbox = $('<input>').attr({ type: 'checkbox', id: id })
                        .data({ name: name, lat: site.latitude, lon: site.longitude, alt: site.altitude })
                        .prop('checked', selectedSet.has(name));
                    var label = $('<label>').attr('for', id).append(checkbox)
                        .append(document.createTextNode(' ' + name + ' (' + Number(site.latitude).toFixed(3) + ', ' + Number(site.longitude).toFixed(3) + ')'));
                    container.append(label);
                });
                resolve(sites);
            }).fail(function () {
                container.html('<div class="auto-error">地点データの読み込みに失敗しました。</div>');
                resolve({});
            });
        });
    }

    function loadMarinePoints() {
        return new Promise(function (resolve) {
            $.getJSON('ports.json').done(function (data) {
                var rawSupport = Array.isArray(data) ? data : data.supportPoints;
                supportPoints = Array.isArray(rawSupport) ? rawSupport.filter(function (point) {
                    return point && Number.isFinite(Number(point.lat)) && Number.isFinite(Number(point.lon));
                }) : [];
                recoveryPoints = data && Array.isArray(data.recoveryPoints) ? data.recoveryPoints : [];
                resolve();
            }).fail(function () {
                supportPoints = [];
                recoveryPoints = [];
                resolve();
            });
        });
    }

    function buildCandidates(startUtc, endUtc, intervalMinutes, sites) {
        var candidates = [];
        sites.forEach(function (site) {
            var current = startUtc.clone();
            while (current.isSameOrBefore(endUtc)) {
                var launchUtc = current.clone().utc().format();
                candidates.push({
                    id: site.name + '|' + launchUtc,
                    name: site.name,
                    lat: site.lat,
                    lon: site.lon,
                    alt: site.alt,
                    launchUtc: launchUtc,
                    weather: null,
                    coarse: null
                });
                current.add(intervalMinutes, 'minutes');
            }
        });
        return candidates;
    }

    function countWeatherCalls(candidates) {
        return root.AutoSearchCore.countUniqueWeatherCalls(candidates);
    }

    function readEstimateInputs() {
        var startUtc = jstToUtcMoment($('#auto_start_date').val(), $('#auto_start_time').val());
        var endUtc = jstToUtcMoment($('#auto_end_date').val(), $('#auto_end_time').val());
        var interval = Math.max(1, Math.round(finiteNumber($('#auto_interval_min').val(), 15)));
        var sites = selectedSites();
        if (!startUtc || !endUtc || endUtc.isBefore(startUtc)) return { error: '時間範囲が不正です。' };
        var candidates = buildCandidates(startUtc, endUtc, interval, sites);
        var mode = MODES[$('#auto_search_mode').val()] ? $('#auto_search_mode').val() : 'fast';
        return {
            startUtc: startUtc,
            endUtc: endUtc,
            interval: interval,
            sites: sites,
            candidates: candidates,
            mode: mode,
            weatherCalls: countWeatherCalls(candidates),
            coarseCalls: candidates.length,
            fineCalls: candidates.length * FINE_VARIANT_COUNT
        };
    }

    function estimateAutoSearch() {
        var estimate = readEstimateInputs();
        if (estimate.error) {
            $('#auto_estimate_text').text(estimate.error);
            return estimate;
        }
        var totalCalls = estimate.weatherCalls + estimate.coarseCalls + estimate.fineCalls;
        var seconds = (estimate.weatherCalls * WEATHER_SECONDS_PER_CALL) +
            ((estimate.coarseCalls + estimate.fineCalls) * PREDICTION_SECONDS_PER_CALL);
        var limit = Math.max(1, Math.round(finiteNumber($('#auto_max_calls').val(), 500)));
        var warning = totalCalls > limit
            ? '<br><span class="auto-error">設定上限 ' + limit + ' 回を超えています。期間・地点を減らすか上限を変更してください。</span>' : '';
        var publicWarning = $('#api_source').val() === 'sondehub'
            ? '<br><span class="auto-warning">公開APIは同時1件で実行します。大量探索にはLocalhostを推奨します。</span>' : '';
        $('#auto_estimate_text').html(
            '<b>' + MODES[estimate.mode].label + '</b><br>' +
            '候補 ' + estimate.candidates.length + '件 / 最大API呼び出し ' + totalCalls + '回' +
            '（天候 ' + estimate.weatherCalls + ' / 粗探索 ' + estimate.coarseCalls + ' / 精密探索 ' + estimate.fineCalls + '）<br>' +
            '所要時間概算 約' + Math.max(1, Math.ceil(seconds / 60)) + '分。キャッシュ命中時は短縮されます。' + warning + publicWarning
        );
        return Object.assign(estimate, { totalCalls: totalCalls, callLimit: limit });
    }

    function readRunSettings() {
        var profile = $('#flight_profile').val();
        var settings = {
            profile: profile,
            pred_type: $('#prediction_type').val(),
            ascent_rate: finiteNumber($('#ascent').val(), NaN)
        };
        if (profile === 'standard_profile') {
            settings.burst_altitude = finiteNumber($('#burst').val(), NaN);
            settings.descent_rate = finiteNumber($('#drag').val(), NaN);
        } else {
            settings.float_altitude = finiteNumber($('#burst').val(), NaN);
        }
        return settings;
    }

    async function configureSearch() {
        var estimate = estimateAutoSearch();
        if (!estimate || estimate.error) return;
        if (estimate.sites.length === 0) {
            notify('地点を1つ以上選択してください。', 'error');
            return;
        }
        if (estimate.totalCalls > estimate.callLimit) {
            notify('最大API呼び出し回数が設定上限を超えています。', 'error');
            return;
        }
        var context = root.createPredictionRequestContext ? root.createPredictionRequestContext() : null;
        if (!context) return;
        state = emptyState();
        state.phase = 1;
        state.status = 'ready';
        state.mode = estimate.mode;
        state.queue = estimate.candidates;
        state.total = estimate.candidates.length;
        state.configuration = {
            startDate: $('#auto_start_date').val(), startTime: $('#auto_start_time').val(),
            endDate: $('#auto_end_date').val(), endTime: $('#auto_end_time').val(),
            interval: estimate.interval,
            selectedSites: estimate.sites.map(function (site) { return site.name; }),
            seaThreshold: finiteNumber($('#auto_sea_threshold').val(), 75),
            rainThreshold: finiteNumber($('#auto_rain_threshold').val(), 1),
            windThreshold: finiteNumber($('#auto_wind_threshold').val(), 10),
            callLimit: estimate.callLimit
        };
        state.runSettings = readRunSettings();
        state.requestConfig = { source: context.source, baseUrl: context.baseUrl, customUrl: ($('#api_custom_url').val() || '').trim() };
        state.requestContext = context;
        await persistState();
        updateProgress(
            '<b>探索条件を保存しました。</b><br>Phase 1 天候APIは最大 ' + estimate.weatherCalls + '回です。地点×日付で共有するため、時刻ごとには呼びません。',
            0, state.queue.length, 1
        );
        $('#auto_action_btn').text('Phase 1 開始').prop('disabled', false);
    }

    function weatherCacheKey(candidate) {
        return candidate.lat.toFixed(5) + '|' + candidate.lon.toFixed(5) + '|' + candidate.launchUtc.slice(0, 10);
    }

    async function getWeatherDay(candidate) {
        var key = weatherCacheKey(candidate);
        if (weatherDayCache.has(key)) return weatherDayCache.get(key);
        var date = candidate.launchUtc.slice(0, 10);
        var url = new URL('https://api.open-meteo.com/v1/forecast');
        url.searchParams.set('latitude', candidate.lat);
        url.searchParams.set('longitude', candidate.lon);
        url.searchParams.set('hourly', 'precipitation,wind_speed_10m');
        url.searchParams.set('wind_speed_unit', 'ms');
        url.searchParams.set('timezone', 'UTC');
        url.searchParams.set('start_date', date);
        url.searchParams.set('end_date', date);
        var pending = root.fetch(url.toString(), { headers: { Accept: 'application/json' } }).then(function (response) {
            if (!response.ok) throw new Error('Open-Meteo HTTP ' + response.status);
            return response.json();
        });
        weatherDayCache.set(key, pending);
        try {
            return await pending;
        } catch (error) {
            weatherDayCache.delete(key);
            throw error;
        }
    }

    async function evaluateWeather(candidate) {
        try {
            var data = await getWeatherDay(candidate);
            var hour = candidate.launchUtc.slice(0, 13) + ':00';
            var index = data && data.hourly && Array.isArray(data.hourly.time) ? data.hourly.time.indexOf(hour) : -1;
            if (index < 0) return { ok: true, status: 'unknown', reason: 'hour_not_available' };
            var rain = finiteNumber(data.hourly.precipitation[index], 0);
            var wind = finiteNumber(data.hourly.wind_speed_10m[index], 0);
            var rainLimit = state.configuration.rainThreshold;
            var windLimit = state.configuration.windThreshold;
            return {
                ok: root.AutoSearchCore.passesWeather({ status: 'ok', precipitationMm: rain, windSpeedMs: wind }, { rainThreshold: rainLimit, windThreshold: windLimit }),
                status: 'ok',
                precipitationMm: rain,
                windSpeedMs: wind,
                reason: rain > rainLimit ? 'rain' : (wind > windLimit ? 'wind' : 'pass')
            };
        } catch (error) {
            return { ok: true, status: 'unknown', reason: 'request_error', error: error.message };
        }
    }

    async function pauseAtBoundary(message) {
        state.running = false;
        state.status = 'paused';
        state.pauseRequested = false;
        await persistState();
        updateProgress(message || '現在の候補が完了した位置で一時停止しました。', state.done, state.total, state.phase);
        $('#auto_action_btn').text('Phase ' + state.phase + ' 再開').prop('disabled', false);
    }

    async function runPhase1() {
        state.running = true;
        state.status = 'running';
        state.pauseRequested = false;
        state.total = state.queue.length;
        $('#auto_action_btn').text('Phase 1 実行中...').prop('disabled', true);
        for (; state.phaseIndex < state.queue.length; state.phaseIndex += 1) {
            var candidate = state.queue[state.phaseIndex];
            candidate.weather = candidate.weather || await evaluateWeather(candidate);
            if (candidate.weather.ok && !state.p1Passed.some(function (item) { return item.id === candidate.id; })) state.p1Passed.push(candidate);
            state.done = state.phaseIndex + 1;
            await persistState();
            updateProgress('Phase 1: ' + candidate.name + '<br>通過 ' + state.p1Passed.length + ' / 判定 ' + state.done, state.done, state.total, 1);
            if (state.pauseRequested) {
                state.phaseIndex += 1;
                await pauseAtBoundary();
                return;
            }
        }
        state.phase = 2;
        state.phaseIndex = 0;
        state.done = 0;
        state.total = state.p1Passed.length;
        state.running = false;
        state.status = 'ready';
        await persistState();
        updateProgress('<b>Phase 1 完了</b><br>' + state.queue.length + '件中 ' + state.p1Passed.length + '件が天候条件を通過しました。粗探索APIは ' + state.p1Passed.length + '回です。', 0, state.total, 2);
        $('#auto_action_btn').text('Phase 2 開始').prop('disabled', false);
    }

    function predictionParams(candidate) {
        var params = Object.assign({}, state.runSettings);
        params.profile = 'standard_profile';
        params.launch_datetime = candidate.launchUtc;
        params.launch_latitude = Number(candidate.lat);
        params.launch_longitude = Number(candidate.lon);
        if (params.launch_longitude < 0) params.launch_longitude += 360;
        params.launch_altitude = Number(candidate.alt);
        return params;
    }

    async function evaluateCoarse(candidate) {
        try {
            var data = await root.requestTawhiriData(predictionParams(candidate), state.requestContext, { label: 'auto-coarse' });
            if (!data || !data.prediction) return { ok: false, reason: 'empty_prediction' };
            var parsed = root.parsePrediction(data.prediction);
            var landing = parsed.landing.latlng;
            var isLand = root.LandSea ? root.LandSea.isLand(landing.lat, landing.lng) : null;
            var distanceKm = root.LandSea && typeof root.LandSea.distanceToCoastKm === 'function'
                ? root.LandSea.distanceToCoastKm(landing.lat, landing.lng) : 0;
            return {
                ok: isLand === false && distanceKm <= MAX_OFFSHORE_KM,
                reason: isLand === true ? 'land' : (distanceKm > MAX_OFFSHORE_KM ? 'too_far_offshore' : 'pass'),
                landingLat: landing.lat,
                landingLon: landing.lng,
                distanceKm: distanceKm
            };
        } catch (error) {
            return { ok: false, reason: 'request_error', error: error && error.message ? error.message : String(error) };
        }
    }

    function rankedCandidates(candidates) {
        return root.AutoSearchCore.selectFineCandidates(candidates, 'ranked');
    }

    async function runPhase2() {
        state.running = true;
        state.status = 'running';
        state.pauseRequested = false;
        state.total = state.p1Passed.length;
        $('#auto_action_btn').text('Phase 2 実行中...').prop('disabled', true);
        for (; state.phaseIndex < state.p1Passed.length; state.phaseIndex += 1) {
            var candidate = state.p1Passed[state.phaseIndex];
            candidate.coarse = candidate.coarse || await evaluateCoarse(candidate);
            if (!state.coarseCandidates.some(function (item) { return item.id === candidate.id; })) state.coarseCandidates.push(candidate);
            state.done = state.phaseIndex + 1;
            await persistState();
            updateProgress('Phase 2: ' + candidate.name + '<br>粗探索 ' + (candidate.coarse.ok ? '通過' : '参考: ' + candidate.coarse.reason), state.done, state.total, 2);
            if (state.pauseRequested) {
                state.phaseIndex += 1;
                await pauseAtBoundary();
                return;
            }
        }
        state.fineCandidates = root.AutoSearchCore.selectFineCandidates(state.coarseCandidates, state.mode);
        state.phase = 3;
        state.phaseIndex = 0;
        state.done = 0;
        state.total = state.fineCandidates.length;
        state.running = false;
        state.status = 'ready';
        await persistState();
        var filtered = state.coarseCandidates.length - state.fineCandidates.length;
        updateProgress('<b>Phase 2 完了</b><br>精密探索対象 ' + state.fineCandidates.length + '件。' + (state.mode === 'fast' ? '粗探索で ' + filtered + '件を除外しました。' : '粗探索では除外していません。') + '<br>精密APIは最大 ' + (state.fineCandidates.length * FINE_VARIANT_COUNT) + '回です。', 0, state.total, 3);
        $('#auto_action_btn').text('Phase 3 開始').prop('disabled', false);
    }

    function summarizeFineResult(threshold) {
        var snapshot = root.buildEhimeHistorySnapshot();
        var result = { ok: false, seaPct: 0, maxOffshore: 0, centroidLat: null, centroidLon: null, detected: 0 };
        if (!snapshot) return result;
        var landCount = snapshot.landCount || 0;
        var waterCount = snapshot.waterCount || 0;
        var detected = landCount + waterCount;
        result.detected = detected;
        result.seaPct = detected > 0 ? Math.round((waterCount / detected) * 100) : 0;
        var latSum = 0;
        var lonSum = 0;
        var pointCount = 0;
        (snapshot.rows || []).forEach(function (point) {
            var lat = Number(point.lat);
            var lon = Number(point.lng);
            if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
            latSum += lat;
            lonSum += lon;
            pointCount += 1;
            if (root.LandSea && root.LandSea.isLand(lat, lon) === false && typeof root.LandSea.distanceToCoastKm === 'function') {
                var distance = root.LandSea.distanceToCoastKm(lat, lon);
                if (Number.isFinite(distance) && distance !== 999) result.maxOffshore = Math.max(result.maxOffshore, distance);
            }
        });
        if (pointCount > 0) {
            result.centroidLat = latSum / pointCount;
            result.centroidLon = lonSum / pointCount;
        }
        result.ok = root.AutoSearchCore.passesSeaThreshold(result.seaPct, threshold);
        return result;
    }

    function runFine(candidate, threshold) {
        return new Promise(function (resolve) {
            var expectedRunId = null;
            var timeout = root.setTimeout(function () {
                $(document).off('ehime_run_complete', handler);
                resolve({ ok: false, seaPct: 0, reason: 'timeout' });
            }, 20 * 60 * 1000);
            function handler(_event, detail) {
                if (expectedRunId && detail && detail.runId && detail.runId !== expectedRunId) return;
                root.clearTimeout(timeout);
                if (detail && detail.success === false) {
                    $(document).off('ehime_run_complete', handler);
                    resolve({ ok: false, seaPct: 0, reason: detail.interrupted ? 'interrupted' : 'all_variants_failed' });
                    return;
                }
                $(document).off('ehime_run_complete', handler);
                resolve(summarizeFineResult(threshold));
            }
            $(document).on('ehime_run_complete', handler);
            try {
                expectedRunId = root.run13VariantEnsemble(predictionParams(candidate), state.requestConfig.baseUrl);
            } catch (error) {
                root.clearTimeout(timeout);
                $(document).off('ehime_run_complete', handler);
                resolve({ ok: false, seaPct: 0, reason: 'request_error', error: error.message });
            }
        });
    }

    function nearestSupport(lat, lon) {
        var nearest = { name: '不明', distanceKm: null, hasOperationalHistory: false };
        if (!Number.isFinite(lat) || !Number.isFinite(lon) || !root.LandSea || typeof root.LandSea.haversineDistKm !== 'function') return nearest;
        supportPoints.forEach(function (point) {
            var distance = root.LandSea.haversineDistKm(lat, lon, Number(point.lat), Number(point.lon));
            if (nearest.distanceKm === null || distance < nearest.distanceKm) {
                nearest = { name: point.name, distanceKm: distance, hasOperationalHistory: Boolean(point.hasOperationalHistory) };
            }
        });
        return nearest;
    }

    async function runPhase3() {
        state.running = true;
        state.status = 'running';
        state.pauseRequested = false;
        state.total = state.fineCandidates.length;
        $('#auto_action_btn').text('Phase 3 実行中...').prop('disabled', true);
        var threshold = state.configuration.seaThreshold;
        for (; state.phaseIndex < state.fineCandidates.length; state.phaseIndex += 1) {
            var candidate = state.fineCandidates[state.phaseIndex];
            var fine = await runFine(candidate, threshold);
            candidate.fine = fine;
            if (fine.ok && !state.results.some(function (result) { return result.id === candidate.id; })) {
                var support = nearestSupport(fine.centroidLat, fine.centroidLon);
                state.results.push({
                    id: candidate.id,
                    timeJst: candidateMoment(candidate).utcOffset(9 * 60).format('YYYY-MM-DD HH:mm'),
                    site: candidate.name,
                    ascentRate: state.runSettings.ascent_rate,
                    descentRate: state.runSettings.descent_rate,
                    burstAltitude: state.runSettings.burst_altitude || state.runSettings.float_altitude,
                    seaPct: fine.seaPct,
                    maxOffshoreKm: fine.maxOffshore,
                    supportName: support.name,
                    supportDistanceKm: support.distanceKm,
                    supportHasHistory: support.hasOperationalHistory,
                    precipitationMm: candidate.weather && candidate.weather.precipitationMm,
                    windSpeedMs: candidate.weather && candidate.weather.windSpeedMs,
                    coarseReason: candidate.coarse && candidate.coarse.reason,
                    mode: state.mode
                });
                if (!state.matches[candidate.name]) state.matches[candidate.name] = [];
                state.matches[candidate.name].push(candidate.launchUtc);
                renderResults();
            }
            state.done = state.phaseIndex + 1;
            await persistState();
            updateProgress('Phase 3: ' + candidate.name + '<br>海落ち率 ' + fine.seaPct + '% ' + (fine.ok ? '— 条件クリア' : '— 下限未満'), state.done, state.total, 3);
            if (state.pauseRequested) {
                state.phaseIndex += 1;
                await pauseAtBoundary();
                return;
            }
        }
        state.phase = 4;
        state.running = false;
        state.status = 'completed';
        state.done = state.total;
        await persistState();
        updateProgress('<b>全Phase完了</b><br>条件を満たした候補は ' + state.results.length + '件です。', state.total, state.total, 4);
        $('#auto_action_btn').text('完了').prop('disabled', true);
        renderResults();
        if (state.results.length > 0) downloadResultsCsv();
    }

    async function runCurrentPhase() {
        if (state.running) return;
        state.requestContext = state.requestContext || createRequestContextFromConfig(state.requestConfig);
        if (!state.requestContext && state.phase >= 2) {
            notify('保存されたAPI設定を復元できません。', 'error');
            return;
        }
        if (state.phase === 1) await runPhase1();
        else if (state.phase === 2) await runPhase2();
        else if (state.phase === 3) await runPhase3();
    }

    function requestPause() {
        if (state.phase === 0 || state.phase === 4) return;
        state.pauseRequested = true;
        state.status = state.running ? 'pausing' : 'paused';
        $('#auto_action_btn').text(state.running ? '現在の候補完了後に停止します' : 'Phase ' + state.phase + ' 再開').prop('disabled', state.running);
        updateProgress('一時停止を予約しました。現在の候補は最後まで完了させ、次の候補へ進みません。', state.done, state.total, state.phase);
        if (!state.running) persistState();
    }

    function escapeCsv(value) {
        var text = String(value === null || value === undefined ? '' : value);
        return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
    }

    function downloadResultsCsv() {
        if (state.results.length === 0) return;
        var headers = ['日時(JST)', '地点', '探索モード', '上昇速度(m/s)', '下降速度(m/s)', '破裂高度(m)', '降水量(mm)', '地上風速(m/s)', '粗探索結果', '海落ち率(%)', '最大沖合距離(km)', '最寄り回収協力先', '協力先距離(km)', '回収実績あり'];
        var lines = [headers.map(escapeCsv).join(',')];
        state.results.forEach(function (row) {
            lines.push([
                row.timeJst, row.site, MODES[row.mode] ? MODES[row.mode].label : row.mode,
                row.ascentRate, row.descentRate, row.burstAltitude, row.precipitationMm, row.windSpeedMs,
                row.coarseReason, row.seaPct,
                Number.isFinite(row.maxOffshoreKm) ? row.maxOffshoreKm.toFixed(1) : '',
                row.supportName,
                Number.isFinite(row.supportDistanceKm) ? row.supportDistanceKm.toFixed(1) : '',
                row.supportHasHistory ? 'あり' : 'なし'
            ].map(escapeCsv).join(','));
        });
        var blob = new Blob(['\uFEFF' + lines.join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' });
        var url = URL.createObjectURL(blob);
        var link = document.createElement('a');
        link.href = url;
        link.download = 'auto_search_results.csv';
        document.body.appendChild(link);
        link.click();
        link.remove();
        root.setTimeout(function () { URL.revokeObjectURL(url); }, 0);
    }

    function renderResults() {
        var container = $('#auto_results_list').empty();
        $('#auto_results_count').text(state.results.length + '件');
        if (state.results.length === 0) {
            $('#auto_results').hide();
            return;
        }
        $('#auto_results').show();
        state.results.forEach(function (result) {
            $('<div class="auto-result-row">').text(
                result.timeJst + ' / ' + result.site + ' / 海落ち ' + result.seaPct + '% / ' +
                result.supportName + (Number.isFinite(result.supportDistanceKm) ? ' ' + result.supportDistanceKm.toFixed(1) + ' km' : '')
            ).attr('title', result.site + ' ' + result.timeJst).appendTo(container);
        });
    }

    function applyConfiguration(configuration) {
        if (!configuration) return;
        $('#auto_start_date').val(configuration.startDate);
        $('#auto_start_time').val(configuration.startTime);
        $('#auto_end_date').val(configuration.endDate);
        $('#auto_end_time').val(configuration.endTime);
        $('#auto_interval_min').val(configuration.interval);
        $('#auto_sea_threshold').val(configuration.seaThreshold);
        $('#auto_rain_threshold').val(configuration.rainThreshold);
        $('#auto_wind_threshold').val(configuration.windThreshold);
        $('#auto_max_calls').val(configuration.callLimit);
        $('#auto_search_mode').val(state.mode);
    }

    async function restoreSavedState(snapshot) {
        state = Object.assign(emptyState(), snapshot);
        state.running = false;
        state.pauseRequested = false;
        if (state.status !== 'completed') state.status = 'paused';
        state.requestContext = createRequestContextFromConfig(state.requestConfig);
        applyConfiguration(state.configuration);
        await populateSites(state.configuration ? state.configuration.selectedSites : []);
        renderResults();
        updateProgress(
            state.status === 'completed'
                ? '<b>前回の探索は完了しています。</b><br>結果 ' + state.results.length + '件を復元しました。'
                : '<b>前回の探索を復元しました。</b><br>Phase ' + state.phase + ' の ' + state.phaseIndex + '件目から再開できます。',
            state.done, state.total, state.status === 'completed' ? 4 : state.phase
        );
        $('#auto_action_btn').text(state.status === 'completed' ? '完了' : 'Phase ' + state.phase + ' 再開').prop('disabled', state.status === 'completed');
    }

    async function showModal() {
        $('#auto_search_modal').show().attr('aria-hidden', 'false');
        setTimeout(function () { $('#auto_search_mode').trigger('focus'); }, 0);
        await loadMarinePoints();
        if (state.phase > 0 && state.status !== 'idle') {
            renderResults();
            return;
        }
        var saved = jobStore ? await jobStore.load() : null;
        if (saved && saved.version === JOB_VERSION) {
            await restoreSavedState(saved);
            return;
        }
        var nowJst = root.moment.utc().utcOffset(9 * 60);
        $('#auto_start_date').val(nowJst.format('YYYY-MM-DD'));
        $('#auto_start_time').val(nowJst.format('HH:mm'));
        $('#auto_end_date').val(nowJst.clone().add(12, 'hours').format('YYYY-MM-DD'));
        $('#auto_end_time').val(nowJst.clone().add(12, 'hours').format('HH:mm'));
        $('#auto_interval_min').val(15);
        $('#auto_sea_threshold').val(75);
        $('#auto_max_calls').val($('#api_source').val() === 'sondehub' ? 300 : 2000);
        state = emptyState();
        await populateSites([]);
        updateProgress('条件を設定すると、API呼び出し回数と所要時間の概算を表示します。', 0, 0, 0);
        $('#auto_action_btn').text('条件確定・見積り').prop('disabled', false);
        estimateAutoSearch();
    }

    async function resetSearch() {
        state = emptyState();
        weatherDayCache.clear();
        await clearPersistedState();
        $('#auto_results').hide();
        await showModal();
    }

    function hideModal() {
        $('#auto_search_modal').hide().attr('aria-hidden', 'true');
        $('#run_auto_search_btn').trigger('focus');
    }

    function initAutoSearchUi() {
        if (initialized) return;
        initialized = true;
        $(document).on('keydown.autoSearch', function (event) {
            if (event.key === 'Escape' && $('#auto_search_modal').is(':visible')) hideModal();
        });
        $(document).on('click', '#auto_action_btn', function () {
            if (state.phase === 0) configureSearch();
            else runCurrentPhase();
        });
        $(document).on('click', '#auto_cancel_btn', requestPause);
        $(document).on('click', '#auto_close_btn, #auto_close_x', function () {
            if (state.running) requestPause();
            hideModal();
        });
        $(document).on('click', '#auto_select_all', function () {
            $('#auto_sites_container input[type=checkbox]').prop('checked', true);
            estimateAutoSearch();
        });
        $(document).on('click', '#auto_select_none', function () {
            $('#auto_sites_container input[type=checkbox]').prop('checked', false);
            estimateAutoSearch();
        });
        $(document).on('click', '#auto_new_search_btn', resetSearch);
        $(document).on('click', '#auto_download_btn', downloadResultsCsv);
        $(document).on('change input', '#auto_start_date, #auto_start_time, #auto_end_date, #auto_end_time, #auto_interval_min, #auto_sites_container input[type=checkbox], #prediction_type, #api_source, #auto_search_mode, #auto_max_calls', estimateAutoSearch);
    }

    root.AppShell.registerInitializer('automatic-search', initAutoSearchUi, 40);

    root.showAutoSearchModal = showModal;
    root.hideAutoSearchModal = hideModal;
    root.cancelAutoSearch = requestPause;
    root.downloadAutoResultsCSV = downloadResultsCsv;
    root.__autoSearch = {
        getState: function () { return state; },
        estimate: estimateAutoSearch,
        reset: resetSearch,
        modes: MODES,
        recoveryPoints: function () { return recoveryPoints.slice(); }
    };
}(window, window.jQuery));
