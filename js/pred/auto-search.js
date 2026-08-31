(function (root, $) {
    'use strict';

    var JOB_TYPE = 'automatic-launch-search';
    var JOB_VERSION = 2;
    var MAX_OFFSHORE_KM = 22.2;
    var PREDICTION_SECONDS_PER_CALL = 1.5;
    var FINE_VARIANT_COUNT = 13;
    var DEFAULT_MAX_RETRIES = 2;
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
            runId: null,
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
            requestContext: null,
            httpDiagnostics: { httpAttempts: 0, cacheHits: 0, retryCount: 0, failures: 0, lastLabel: '', lastError: null }
        };
    }

    var state = emptyState();
    var activeRunPromise = null;
    var activeAbortController = null;
    var cancelRequested = false;

    function activeSignal() {
        return activeAbortController ? activeAbortController.signal : null;
    }

    function executionCancelled() {
        var signal = activeSignal();
        return cancelRequested || Boolean(signal && signal.aborted);
    }

    function cancelActiveRequests() {
        cancelRequested = true;
        if (activeAbortController) activeAbortController.abort();
    }

    function setNewSearchRunning(running) {
        $('#auto_new_search_btn').text(running ? '中止して新規探索' : '新規探索').prop('disabled', false);
    }

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

    function runStatus() {
        if (state.status === 'running') return 'running';
        if (state.status === 'pausing') return 'pause_requested';
        if (state.status === 'completed') return 'completed';
        if (state.status === 'partial') return 'paused';
        if (state.status === 'error') return 'failed';
        if (state.status === 'idle') return 'draft';
        return 'paused';
    }

    function autoRunOptions(status) {
        var first = state.queue && state.queue[0] || {};
        var landSeaStatus = root.LandSea && typeof root.LandSea.getStatus === 'function' ? root.LandSea.getStatus() : {};
        var reviewCandidates = (state.fineCandidates || []).filter(function (candidate) { return candidate.fine && candidate.fine.requiresReview; }).length;
        return {
            id: state.runId,
            type: 'auto_search',
            status: status,
            title: '放球自動探索',
            input: {
                launch: {
                    latitude: first.lat,
                    longitude: first.lon,
                    altitudeM: first.alt,
                    datetimeUtc: first.launchUtc || null,
                    label: state.configuration && state.configuration.selectedSites ? state.configuration.selectedSites.join(', ') : ''
                },
                flight: {
                    ascentRateMps: state.runSettings && state.runSettings.ascent_rate,
                    descentRateMps: state.runSettings && state.runSettings.descent_rate,
                    burstAltitudeM: state.runSettings && state.runSettings.burst_altitude,
                    floatAltitudeM: state.runSettings && state.runSettings.float_altitude,
                    profileId: state.runSettings && state.runSettings.profile
                },
                api: {
                    endpointId: state.requestConfig && state.requestConfig.source,
                    resolvedBaseUrl: state.requestConfig && state.requestConfig.baseUrl,
                    maxHttpAttempts: state.configuration && state.configuration.callLimit
                },
                feature: {
                    mode: state.mode,
                    phase: state.phase,
                    configuration: state.configuration,
                    requestConfig: state.requestConfig
                }
            },
            progress: {
                completedUnits: state.done,
                totalUnits: state.total,
                currentLabel: 'Phase ' + state.phase,
                httpAttempts: state.httpDiagnostics.httpAttempts,
                cacheHits: state.httpDiagnostics.cacheHits,
                retryCount: state.httpDiagnostics.retryCount,
                requestedAction: state.pauseRequested ? 'pause' : 'none'
            },
            output: {
                trajectories: [],
                landings: [],
                metrics: {
                    matchedCandidates: state.results.length,
                    coarseCandidates: state.coarseCandidates.length,
                    fineCandidates: state.fineCandidates.length,
                    seaThreshold: state.configuration && state.configuration.seaThreshold,
                    reviewCandidates: reviewCandidates
                },
                candidates: state.results,
                warnings: reviewCandidates > 0 ? [reviewCandidates + ' candidate(s) contain unknown land/sea results.'] : [],
                resumeSnapshot: serializeState()
            },
            provenance: {
                predictorSource: state.requestConfig && state.requestConfig.source,
                landSeaClassifierVersion: landSeaStatus.dataVersion || ''
            }
        };
    }

    async function persistRunRecord() {
        if (!state.runId || !root.RunRepository || !root.RunRecord) return;
        var status = runStatus();
        var existing = await root.RunRepository.get(state.runId);
        if (!existing) {
            await root.RunRepository.save(root.RunRecord.create(autoRunOptions(status)));
            return;
        }
        var options = autoRunOptions(status);
        await root.RunRepository.update(state.runId, {
            status: status,
            input: options.input,
            progress: options.progress,
            output: options.output,
            provenance: options.provenance
        });
    }

    async function persistState() {
        if (jobStore) await jobStore.save(serializeState());
        try {
            await persistRunRecord();
        } catch (error) {
            if (typeof root.reportNonFatalError === 'function') root.reportNonFatalError(error, 'auto-search.run-record');
        }
    }

    async function clearPersistedState(previousRunId) {
        if (jobStore) await jobStore.clear();
        if (previousRunId && root.RunRepository) {
            try {
                var record = await root.RunRepository.get(previousRunId);
                if (record && root.RunRecord.activeStatuses.indexOf(record.status) !== -1) {
                    await root.RunRepository.update(previousRunId, { status: 'cancelled' });
                }
            } catch (error) {
                if (typeof root.reportNonFatalError === 'function') root.reportNonFatalError(error, 'auto-search.cancel-record');
            }
        }
    }

    function createRequestContextFromConfig(config, runId, maxHttpAttempts, diagnostics) {
        if (!config || typeof root.createPredictionRequestContext !== 'function') return null;
        return root.createPredictionRequestContext({
            runId: runId || '',
            source: config.source,
            baseUrl: config.baseUrl,
            customUrl: config.customUrl,
            maxHttpAttempts: maxHttpAttempts,
            diagnostics: diagnostics
        });
    }

    function normalizeHttpDiagnostics(value) {
        return root.PredictionWorkload ? root.PredictionWorkload.normalizeDiagnostics(value) : Object.assign({
            httpAttempts: 0, cacheHits: 0, retryCount: 0, failures: 0, lastLabel: '', lastError: null
        }, value || {});
    }

    function attemptBudgetExhausted() {
        var limit = state.configuration ? state.configuration.callLimit : 0;
        return root.PredictionWorkload
            ? root.PredictionWorkload.isAttemptBudgetExhausted(state.httpDiagnostics, limit)
            : state.httpDiagnostics.httpAttempts >= limit;
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
        var requestProgress = state.configuration ? ' · HTTP ' + state.httpDiagnostics.httpAttempts + ' / ' + state.configuration.callLimit + '（再試行 ' + state.httpDiagnostics.retryCount + '、キャッシュ ' + state.httpDiagnostics.cacheHits + '）' : '';
        $('#auto_progress_text').text(done + ' / ' + total + requestProgress);
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
        var current = startUtc.clone();
        while (current.isSameOrBefore(endUtc)) {
            var launchUtc = current.clone().utc().format();
            sites.forEach(function (site) {
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
            });
            current.add(intervalMinutes, 'minutes');
        }
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
        var source = $('#api_source').val() || 'sondehub';
        var policy = root.PredictionApi && root.PredictionApi.policies ? root.PredictionApi.policies[source] : null;
        var maxRetries = policy ? policy.maxRetries : DEFAULT_MAX_RETRIES;
        var attempts = root.PredictionWorkload
            ? root.PredictionWorkload.estimateAttempts(totalCalls, maxRetries, 0)
            : { worstCaseHttpAttempts: totalCalls * (maxRetries + 1) };
        var limit = Math.max(1, Math.round(finiteNumber($('#auto_max_calls').val(), 500)));
        var secondsPerAttempt = source === 'local' ? 0.5 : (source === 'custom' ? 1.0 : PREDICTION_SECONDS_PER_CALL);
        var seconds = Math.min(limit, attempts.worstCaseHttpAttempts) * secondsPerAttempt;
        var warning = totalCalls > limit
            ? '<br><span class="auto-warning">キャッシュが無い場合は上限到達時点で一部完了として保存します。期間・地点または上限を調整できます。</span>' : '';
        var retryWarning = attempts.worstCaseHttpAttempts > limit
            ? '<br><span class="auto-warning">429・5xx・タイムアウトの再試行を含む最悪時は ' + attempts.worstCaseHttpAttempts + '試行です。</span>' : '';
        var advice = root.PredictionWorkload ? root.PredictionWorkload.apiAdvice(source, limit) : { isPublic: source === 'sondehub', aboveRecommended: false };
        var publicWarning = advice.isPublic
            ? '<br><span class="auto-warning">公開APIは同時1件で実行します。' + (advice.aboveRecommended ? '推奨目安300試行を超えています。' : '') + '数千件規模はLocalhostを推奨します。</span>' : '';
        $('#auto_estimate_text').html(
            '<b>' + MODES[estimate.mode].label + '</b><br>' +
            '候補 ' + estimate.candidates.length + '件 / 論理API要求 ' + totalCalls + '回' +
            '（天候 ' + estimate.weatherCalls + ' / 粗探索 ' + estimate.coarseCalls + ' / 精密探索 ' + estimate.fineCalls + '）<br>' +
            'HTTP試行上限 ' + limit + '回 / 再試行込み最悪 ' + attempts.worstCaseHttpAttempts + '回<br>' +
            '上限までの所要時間概算 約' + Math.max(1, Math.ceil(seconds / 60)) + '分。事前キャッシュ命中は未判定（0件として計算）、命中時は短縮されます。' + warning + retryWarning + publicWarning
        );
        return Object.assign(estimate, {
            totalCalls: totalCalls,
            callLimit: limit,
            maxRetries: maxRetries,
            worstCaseHttpAttempts: attempts.worstCaseHttpAttempts
        });
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

        var context = root.createPredictionRequestContext ? root.createPredictionRequestContext() : null;
        if (!context) return;
        state = emptyState();
        state.runId = root.RunRecord ? root.RunRecord.makeId('run') : 'auto-' + Date.now().toString(36);
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
            callLimit: estimate.callLimit,
            logicalCalls: estimate.totalCalls,
            worstCaseHttpAttempts: estimate.worstCaseHttpAttempts
        };
        state.runSettings = readRunSettings();
        state.requestConfig = { source: context.source, baseUrl: context.baseUrl, customUrl: ($('#api_custom_url').val() || '').trim() };
        state.httpDiagnostics = normalizeHttpDiagnostics();
        state.requestContext = createRequestContextFromConfig(state.requestConfig, state.runId, estimate.callLimit, state.httpDiagnostics);
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
        if (!root.PredictionApi) throw new Error('PredictionApi is unavailable');
        var date = candidate.launchUtc.slice(0, 10);
        var params = {
            latitude: candidate.lat,
            longitude: candidate.lon,
            hourly: 'precipitation,wind_speed_10m',
            wind_speed_unit: 'ms',
            timezone: 'UTC',
            start_date: date,
            end_date: date
        };
        var client = root.PredictionApi.getClient({
            source: 'custom',
            baseUrl: 'https://api.open-meteo.com/v1/forecast',
            policy: { concurrency: 1, minIntervalMs: 500, timeoutMs: 30000, maxRetries: DEFAULT_MAX_RETRIES }
        });
        var diagnostics = state.httpDiagnostics;
        diagnostics.lastLabel = 'weather:' + key;
        var pending = client.request(params, {
            signal: activeSignal(),
            label: diagnostics.lastLabel,
            canAttempt: function () { return !attemptBudgetExhausted(); },
            onAttempt: function (attempt) {
                diagnostics.httpAttempts += 1;
                if (attempt > 1) diagnostics.retryCount += 1;
            }
        }).then(function (response) {
            if (response.cacheHit) diagnostics.cacheHits += 1;
            return response.data;
        }).catch(function (error) {
            diagnostics.failures += 1;
            diagnostics.lastError = { message: error && error.message ? error.message : String(error), label: diagnostics.lastLabel };
            throw error;
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

    async function partialAtBoundary(message) {
        state.running = false;
        state.status = 'partial';
        state.pauseRequested = false;
        await persistState();
        updateProgress(message || 'HTTP試行上限に到達したため、現在の候補までを一部完了として保存しました。', state.done, state.total, state.phase);
        $('#auto_action_btn').text('API上限を増やして再開').prop('disabled', false);
        notify('API試行上限に到達しました。結果は自動保存されています。', 'warning');
    }

    async function runPhase1() {
        state.running = true;
        state.status = 'running';
        state.pauseRequested = false;
        state.total = state.queue.length;
        $('#auto_action_btn').text('Phase 1 実行中...').prop('disabled', true);
        for (; state.phaseIndex < state.queue.length; state.phaseIndex += 1) {
            if (attemptBudgetExhausted()) {
                await partialAtBoundary();
                return;
            }
            var candidate = state.queue[state.phaseIndex];
            candidate.weather = candidate.weather || await evaluateWeather(candidate);
            if (executionCancelled()) return;
            if (candidate.weather.ok && !state.p1Passed.some(function (item) { return item.id === candidate.id; })) state.p1Passed.push(candidate);
            state.done = state.phaseIndex + 1;
            await persistState();
            updateProgress('Phase 1: ' + candidate.name + '<br>通過 ' + state.p1Passed.length + ' / 判定 ' + state.done, state.done, state.total, 1);
            if (state.pauseRequested) {
                state.phaseIndex += 1;
                await pauseAtBoundary();
                return;
            }
            if (attemptBudgetExhausted()) {
                state.phaseIndex += 1;
                await partialAtBoundary();
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
            if (!root.PredictionRunner) throw new Error('PredictionRunner is unavailable');
            var execution = await root.PredictionRunner.run(predictionParams(candidate), state.requestContext, { label: 'auto-coarse', signal: activeSignal() });
            var landing = execution.landing;
            var landSea = root.LandSea && typeof root.LandSea.classify === 'function'
                ? root.LandSea.classify(landing.latitude, landing.longitude)
                : { classification: 'unknown', coastDistanceKm: null, reason: 'classifier-unavailable' };
            var distanceKm = Number(landSea.coastDistanceKm);
            var hasDistance = Number.isFinite(distanceKm);
            var isSea = landSea.classification === 'sea';
            var reason = 'pass';
            if (landSea.classification === 'land') reason = 'land';
            else if (landSea.classification === 'inland_water') reason = 'inland_water';
            else if (landSea.classification === 'unknown' || !hasDistance) reason = 'unknown';
            else if (distanceKm > MAX_OFFSHORE_KM) reason = 'too_far_offshore';
            return {
                ok: isSea && hasDistance && distanceKm <= MAX_OFFSHORE_KM,
                reason: reason,
                landingLat: landing.latitude,
                landingLon: landing.longitude,
                distanceKm: hasDistance ? distanceKm : null,
                landSea: landSea
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
            if (attemptBudgetExhausted()) {
                await partialAtBoundary();
                return;
            }
            var candidate = state.p1Passed[state.phaseIndex];
            candidate.coarse = candidate.coarse || await evaluateCoarse(candidate);
            if (executionCancelled()) return;
            if (!state.coarseCandidates.some(function (item) { return item.id === candidate.id; })) state.coarseCandidates.push(candidate);
            state.done = state.phaseIndex + 1;
            await persistState();
            updateProgress('Phase 2: ' + candidate.name + '<br>粗探索 ' + (candidate.coarse.ok ? '通過' : '参考: ' + candidate.coarse.reason), state.done, state.total, 2);
            if (state.pauseRequested) {
                state.phaseIndex += 1;
                await pauseAtBoundary();
                return;
            }
            if (attemptBudgetExhausted()) {
                state.phaseIndex += 1;
                await partialAtBoundary();
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
        var result = {
            ok: false, thresholdPassed: false, requiresReview: false, reason: 'no-results',
            seaPct: 0, maxOffshore: 0, centroidLat: null, centroidLon: null,
            detected: 0, seaCount: 0, landCount: 0, inlandWaterCount: 0, unknownCount: 0
        };
        if (!snapshot) return result;
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
            var landSea = point.landSea;
            if (!landSea || !landSea.classification) {
                landSea = root.LandSea && typeof root.LandSea.classify === 'function'
                    ? root.LandSea.classify(lat, lon)
                    : { classification: point.isWater === true ? 'sea' : (point.isWater === false ? 'land' : 'unknown') };
            }
            if (landSea.classification === 'sea') {
                result.seaCount += 1;
                var distance = Number(landSea.coastDistanceKm);
                if (Number.isFinite(distance)) result.maxOffshore = Math.max(result.maxOffshore, distance);
            } else if (landSea.classification === 'land') result.landCount += 1;
            else if (landSea.classification === 'inland_water') result.inlandWaterCount += 1;
            else result.unknownCount += 1;
        });
        var seaCondition = root.AutoSearchCore.evaluateSeaCondition({
            sea: result.seaCount, land: result.landCount,
            inlandWater: result.inlandWaterCount, unknown: result.unknownCount
        }, threshold);
        result.detected = seaCondition.classified;
        result.seaPct = Math.round(seaCondition.seaPercent);
        result.requiresReview = seaCondition.requiresReview;
        if (pointCount > 0) {
            result.centroidLat = latSum / pointCount;
            result.centroidLon = lonSum / pointCount;
        }
        result.thresholdPassed = seaCondition.thresholdPassed;
        result.ok = seaCondition.pass;
        result.reason = result.requiresReview ? 'unknown_land_sea' : (result.thresholdPassed ? 'pass' : 'below_threshold');
        return result;
    }
    function runFine(candidate, threshold) {
        return new Promise(function (resolve) {
            var expectedRunId = null;
            var signal = activeSignal();
            var settled = false;
            var timeout = root.setTimeout(function () {
                finish({ ok: false, seaPct: 0, reason: 'timeout' });
            }, 20 * 60 * 1000);
            function finish(result) {
                if (settled) return;
                settled = true;
                root.clearTimeout(timeout);
                $(document).off('ehime_run_complete', handler);
                if (signal) signal.removeEventListener('abort', onAbort);
                resolve(result);
            }
            function onAbort() {
                finish({ ok: false, seaPct: 0, reason: 'cancelled' });
            }
            function handler(_event, detail) {
                if (expectedRunId && detail && detail.runId && detail.runId !== expectedRunId) return;
                if (detail && detail.success === false) {
                    finish({ ok: false, seaPct: 0, reason: detail.interrupted ? 'interrupted' : 'all_variants_failed' });
                    return;
                }
                finish(summarizeFineResult(threshold));
            }
            $(document).on('ehime_run_complete', handler);
            if (signal) {
                if (signal.aborted) {
                    onAbort();
                    return;
                }
                signal.addEventListener('abort', onAbort, { once: true });
            }
            try {
                expectedRunId = root.run13VariantEnsemble(predictionParams(candidate), state.requestConfig.baseUrl, state.requestContext, { suppressRunRecord: true, signal: signal });
            } catch (error) {
                finish({ ok: false, seaPct: 0, reason: 'request_error', error: error.message });
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
            if (attemptBudgetExhausted()) {
                await partialAtBoundary();
                return;
            }
            var candidate = state.fineCandidates[state.phaseIndex];
            var fine = await runFine(candidate, threshold);
            if (executionCancelled()) return;
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
                    seaCount: fine.seaCount,
                    landCount: fine.landCount,
                    inlandWaterCount: fine.inlandWaterCount,
                    unknownCount: fine.unknownCount,
                    requiresReview: fine.requiresReview,
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
            var fineStatusText = fine.requiresReview ? '— 海陸不明を含むため要確認' : (fine.ok ? '— 条件クリア' : '— 下限未満');
            updateProgress('Phase 3: ' + candidate.name + '<br>海落ち率 ' + fine.seaPct + '% ' + fineStatusText, state.done, state.total, 3);
            if (state.pauseRequested) {
                state.phaseIndex += 1;
                await pauseAtBoundary();
                return;
            }
            if (attemptBudgetExhausted()) {
                state.phaseIndex += 1;
                await partialAtBoundary();
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
        if (state.status === 'partial') {
            var increasedLimit = Math.max(1, Math.round(finiteNumber($('#auto_max_calls').val(), 0)));
            if (increasedLimit <= state.httpDiagnostics.httpAttempts) {
                notify('再開するには、API試行上限を現在の試行数 ' + state.httpDiagnostics.httpAttempts + ' 回より大きくしてください。', 'warning');
                return;
            }
            state.configuration.callLimit = increasedLimit;
            state.status = 'paused';
            state.requestContext = null;
        }
        state.requestContext = state.requestContext || createRequestContextFromConfig(
            state.requestConfig,
            state.runId,
            state.configuration && state.configuration.callLimit,
            state.httpDiagnostics
        );
        if (!state.requestContext && state.phase >= 2) {
            notify('保存されたAPI設定を復元できません。', 'error');
            return;
        }
        cancelRequested = false;
        var controller = typeof root.AbortController === 'function' ? new root.AbortController() : null;
        activeAbortController = controller;
        try {
            if (state.phase === 1) await runPhase1();
            else if (state.phase === 2) await runPhase2();
            else if (state.phase === 3) await runPhase3();
        } finally {
            if (activeAbortController === controller) activeAbortController = null;
        }
    }

    function requestPause() {
        if (state.phase === 0 || state.phase === 4) return;
        state.pauseRequested = true;
        state.status = state.running ? 'pausing' : 'paused';
        $('#auto_action_btn').text(state.running ? '現在の候補完了後に停止します' : 'Phase ' + state.phase + ' 再開').prop('disabled', state.running);
        updateProgress('一時停止を予約しました。現在の候補は最後まで完了させ、次の候補へ進みません。', state.done, state.total, state.phase);
        if (!state.running) persistState();
    }

    function downloadResultsCsv() {
        if (state.results.length === 0) return;
        if (!root.ExportService || typeof root.ExportService.autoSearchCsv !== 'function') throw new Error('ExportService is unavailable');
        root.ExportService.download(root.ExportService.autoSearchCsv(state.results) + '\r\n', 'auto_search_results.csv', 'text/csv;charset=utf-8');
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
        state.httpDiagnostics = normalizeHttpDiagnostics(snapshot && (snapshot.httpDiagnostics || (snapshot.requestContext && snapshot.requestContext.diagnostics)));
        state.running = false;
        state.pauseRequested = false;
        if (state.status !== 'completed' && state.status !== 'partial') state.status = 'paused';
        if (!state.runId) state.runId = root.RunRecord ? root.RunRecord.makeId('run') : '';
        state.requestContext = createRequestContextFromConfig(state.requestConfig, state.runId, state.configuration && state.configuration.callLimit, state.httpDiagnostics);
        applyConfiguration(state.configuration);
        await populateSites(state.configuration ? state.configuration.selectedSites : []);
        renderResults();
        updateProgress(
            state.status === 'completed'
                ? '<b>前回の探索は完了しています。</b><br>結果 ' + state.results.length + '件を復元しました。'
                : '<b>前回の探索を復元しました。</b><br>Phase ' + state.phase + ' の ' + state.phaseIndex + '件目から再開できます。',
            state.done, state.total, state.status === 'completed' ? 4 : state.phase
        );
        $('#auto_action_btn').text(state.status === 'completed' ? '完了' : (state.status === 'partial' ? 'API上限を増やして再開' : 'Phase ' + state.phase + ' 再開')).prop('disabled', state.status === 'completed');
    }

    async function showModal(options) {
        options = options || {};
        $('#auto_search_modal').show().attr('aria-hidden', 'false');
        setTimeout(function () { $('#auto_search_mode').trigger('focus'); }, 0);
        await loadMarinePoints();
        if (state.phase > 0 && state.status !== 'idle') {
            await populateSites(state.configuration ? state.configuration.selectedSites : []);
            renderResults();
            return;
        }
        var saved = !options.skipRestore && jobStore ? await jobStore.load() : null;
        if (!options.skipRestore && (!saved || saved.version !== JOB_VERSION) && root.RunRepository) {
            var activeRuns = await root.RunRepository.getActive('auto_search');
            var fallbackRuns = activeRuns.length ? activeRuns : await root.RunRepository.listRuns({ type: 'auto_search' });
            var latestRun = fallbackRuns[0];
            if (latestRun && latestRun.output && latestRun.output.resumeSnapshot) {
                saved = latestRun.output.resumeSnapshot;
            }
        }
        if (saved && saved.version === JOB_VERSION) {
            await restoreSavedState(saved);
            await persistState();
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

    function presetAvailable(label) {
        if (state.phase === 0 || state.status === 'idle') return true;
        notify('保存済みの探索があります。「新規探索」を押してから' + label + 'を選んでください。', 'warning');
        return false;
    }

    async function showAllSitesPreset() {
        await showModal();
        if (!presetAvailable('全地点探索')) return;
        $('#auto_search_mode').val('full');
        $('#auto_sites_container input[type=checkbox]').prop('checked', true);
        estimateAutoSearch();
        notify('全地点・全候補精密探索プリセットを設定しました。見積りを確認して開始してください。', 'info');
    }

    async function showWeatherComparisonPreset() {
        await showModal();
        if (!presetAvailable('時間帯比較')) return;
        var date = [$('#year').val(), String($('#month').val()).padStart(2, '0'), String($('#day').val()).padStart(2, '0')].join('-');
        var time = [String($('#hour').val()).padStart(2, '0'), String($('#min').val()).padStart(2, '0')].join(':');
        var startUtc = jstToUtcMoment(date, time) || root.moment.utc();
        var startJst = startUtc.clone().utcOffset(9 * 60);
        var endJst = startJst.clone().add(6, 'hours');
        $('#auto_start_date').val(startJst.format('YYYY-MM-DD'));
        $('#auto_start_time').val(startJst.format('HH:mm'));
        $('#auto_end_date').val(endJst.format('YYYY-MM-DD'));
        $('#auto_end_time').val(endJst.format('HH:mm'));
        $('#auto_interval_min').val(15);
        $('#auto_search_mode').val('fast');
        var selectedName = $('#site option:selected').text();
        var choices = $('#auto_sites_container input[type=checkbox]');
        choices.prop('checked', false);
        var matching = choices.filter(function () { return String($(this).data('name')) === selectedName; });
        (matching.length ? matching : choices.first()).prop('checked', true);
        estimateAutoSearch();
        notify('現在地点・6時間・15分間隔の気象比較プリセットを設定しました。', 'info');
    }
    async function resetSearch() {
        var previousRunId = state.runId;
        if (state.running || activeRunPromise) {
            $('#auto_new_search_btn').text('中止中...').prop('disabled', true);
            cancelActiveRequests();
            if (activeRunPromise) {
                try { await activeRunPromise; }
                catch (error) {
                    if (typeof root.reportNonFatalError === 'function') root.reportNonFatalError(error, 'auto-search.cancel-active');
                }
            }
        }
        state = emptyState();
        cancelRequested = false;
        weatherDayCache.clear();
        await clearPersistedState(previousRunId);
        $('#auto_results').hide();
        setNewSearchRunning(false);
        await showModal({ skipRestore: true });
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
        $(document).on('click', '#auto_action_btn', async function () {
            if (state.phase === 0) {
                configureSearch();
                return;
            }
            if (activeRunPromise) return;
            setNewSearchRunning(true);
            var promise = runCurrentPhase();
            activeRunPromise = promise;
            try { await promise; }
            catch (error) {
                if (!executionCancelled() && typeof root.reportNonFatalError === 'function') root.reportNonFatalError(error, 'auto-search.run');
            } finally {
                if (activeRunPromise === promise) activeRunPromise = null;
                if (!cancelRequested) setNewSearchRunning(false);
            }
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

    root.showAllSitesAutoSearchPreset = showAllSitesPreset;
    root.showAutoSearchWeatherPreset = showWeatherComparisonPreset;    root.showAutoSearchModal = showModal;
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
