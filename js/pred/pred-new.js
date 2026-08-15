/*
 * CUSF Landing Prediction Version 3
 * Mark Jessop 2019
 * vk5qi@rfhead.net
 *
 * http://github.com/jonsowman/cusf-standalone-predictor
 *
 */


function initLaunchCard() {
    // Initialise the time/date on the launch card.

    // var today = new Date();

    // $('#year').val(today.getFullYear());
    // $('#day').val(today.getDate());
    // var month = today.getMonth()+1;
    // $("#month").val(month).change();
    // $('#hour').val(today.getHours());
    // $('#min').val(today.getMinutes());
    // $('#sec').val(today.getSeconds());

    // Use local JST (UTC+9) for display, but keep backend in UTC.
    var todayUtc = moment.utc();
    var todayJst = todayUtc.clone().utcOffset(9 * 60); // JST offset +09:00

    // Always refresh to current JST when page (re)loads unless URL params override later.
    $('#year').val(todayJst.year());
    $('#day').val(todayJst.date());
    var month = todayJst.month() + 1;
    $("#month").val(month).change();
    $('#hour').val(todayJst.hours());
    $('#min').val(todayJst.minutes());
}

function resolveTawhiriApiUrl() {
    var apiSourceEl = $('#api_source');
    var customUrlEl = $('#api_custom_url');
    if (!apiSourceEl.length) {
        return "https://api.v2.sondehub.org/tawhiri";
    }

    var source = apiSourceEl.val() || 'sondehub';
    if (source === 'local') {
        return '/api/v1/';
    }

    if (source === 'custom') {
        var customUrl = (customUrlEl.val() || '').trim();
        if (!customUrl) {
            throwError('カスタムAPI URLを入力してください。');
            return null;
        }
        return customUrl;
    }

    return "https://api.v2.sondehub.org/tawhiri";
}

function createPredictionRequestContext(options) {
    options = options || {};
    var source = options.source || ($('#api_source').val() || 'sondehub');
    var customUrl = options.customUrl;
    if (customUrl === undefined) customUrl = ($('#api_custom_url').val() || '').trim();
    var baseUrl = options.baseUrl || options.resolvedBaseUrl || resolveTawhiriApiUrl();
    if (!baseUrl) return null;
    if (typeof PredictionRunner !== 'undefined') {
        return PredictionRunner.createContext({
            runId: options.runId || '',
            source: source,
            customUrl: customUrl,
            resolvedBaseUrl: baseUrl,
            maxHttpAttempts: options.maxHttpAttempts,
            pauseController: options.pauseController,
            diagnostics: options.diagnostics
        });
    }
    var context = { runId: options.runId || '', source: source, endpointId: source, baseUrl: baseUrl, resolvedBaseUrl: baseUrl, client: null };
    if (typeof PredictionApi !== 'undefined') {
        context.client = PredictionApi.getClient({ source: source, baseUrl: baseUrl, customUrl: customUrl });
    }
    return context;
}

function createFallbackPredictionRequestContext(previousContext, settings) {
    var nextContext = createPredictionRequestContext({
        runId: previousContext && previousContext.runId,
        source: 'sondehub',
        baseUrl: 'https://api.v2.sondehub.org/tawhiri'
    });
    if (!nextContext || !previousContext) return nextContext;

    var ready = previousContext.runRecordReady || Promise.resolve();
    nextContext.runRecordReady = ready;
    if (nextContext.runId && typeof RunRepository !== 'undefined') {
        nextContext.runRecordReady = ready.then(function () {
            return RunRepository.update(nextContext.runId, {
                input: { api: predictionRunInput(settings, nextContext).api },
                provenance: { predictorSource: nextContext.endpointId || nextContext.source || 'sondehub' },
                output: { warnings: ['Local API validation failed; prediction continued with SondeHub.'] }
            });
        }).catch(function (error) {
            if (typeof reportNonFatalError === 'function') reportNonFatalError(error, 'run-record.api-fallback');
            return null;
        });
    }
    return nextContext;
}
function requestTawhiriData(settings, requestContext, options) {
    var context = requestContext || createPredictionRequestContext();
    if (!context) return Promise.reject(new Error('Prediction API is not configured'));
    if (typeof PredictionRunner === 'undefined') return Promise.reject(new Error('PredictionRunner is unavailable'));
    return PredictionRunner.request(settings, context, options || {}).then(function (result) { return result.data; });
}

function predictionRunInput(settings, context) {
    settings = settings || {};
    context = context || {};
    var longitude = Number(settings.launch_longitude);
    if (longitude > 180) longitude -= 360;
    return {
        launch: {
            latitude: settings.launch_latitude,
            longitude: longitude,
            altitudeM: settings.launch_altitude,
            datetimeUtc: settings.launch_datetime,
            label: $('#site option:selected').text() || ''
        },
        flight: {
            ascentRateMps: settings.ascent_rate,
            descentRateMps: settings.descent_rate,
            burstAltitudeM: settings.burst_altitude,
            floatAltitudeM: settings.float_altitude,
            profileId: settings.profile
        },
        api: {
            endpointId: context.endpointId || context.source || '',
            resolvedBaseUrl: context.resolvedBaseUrl || context.baseUrl || '',
            timeoutMs: context.timeoutMs,
            maxHttpAttempts: Number.isFinite(context.maxHttpAttempts) ? context.maxHttpAttempts : null,
            concurrency: context.concurrency,
            minIntervalMs: context.minIntervalMs
        },
        feature: { predictionType: settings.pred_type || 'single' }
    };
}

function startPredictionRunRecord(settings, context, type, title, runId) {
    if (!context || context.suppressRunRecord || typeof RunRecord === 'undefined' || typeof RunRepository === 'undefined') return runId || null;
    var id = runId || context.runId || RunRecord.makeId('run');
    context.runId = id;
    var record = RunRecord.create({
        id: id,
        type: type || 'single',
        status: 'running',
        title: title || '予測',
        input: predictionRunInput(settings, context),
        provenance: {
            predictorSource: context.endpointId || context.source || '',
            landSeaClassifierVersion: typeof LandSea !== 'undefined' && typeof LandSea.getStatus === 'function' ? (LandSea.getStatus().dataVersion || '') : ''
        }
    });
    context.runRecordReady = RunRepository.save(record).catch(function (error) {
        if (typeof reportNonFatalError === 'function') reportNonFatalError(error, 'run-record.start');
        return null;
    });
    return id;
}

function plainTrajectorySeries(predictionResult, runId, variantId, label) {
    if (!predictionResult) return null;
    var path = Array.isArray(predictionResult.flight_path) ? predictionResult.flight_path : [];
    return {
        id: runId + ':' + (variantId || 'main'),
        runId: runId,
        variantId: variantId || null,
        label: label || variantId || '予測',
        color: '',
        visible: variantId ? variantId === 'BASE' : true,
        points: path.map(function (point) {
            return {
                timeUtc: null,
                latitude: Array.isArray(point) ? point[0] : null,
                longitude: Array.isArray(point) ? point[1] : null,
                altitudeM: Array.isArray(point) ? point[2] : null,
                horizontalSpeedMps: null,
                verticalSpeedMps: null,
                phase: null
            };
        })
    };
}

function localLandSeaResult(lat, lon) {
    if (typeof LandSea !== 'undefined' && typeof LandSea.classify === 'function') return LandSea.classify(lat, lon);
    return {
        classification: 'unknown', confidence: 'unknown', source: 'unavailable',
        coastDistanceKm: null, dataVersion: '', reason: 'classifier-unavailable'
    };
}

function landSeaLabel(result) {
    if (!result) return '不明';
    if (result.classification === 'sea') return '海';
    if (result.classification === 'land') return '陸';
    if (result.classification === 'inland_water') return '内水面';
    return '不明';
}

function legacyIsWaterFromLandSea(result) {
    if (!result) return null;
    if (result.classification === 'sea') return true;
    if (result.classification === 'land') return false;
    return null;
}
function plainLandingResult(predictionResult, seriesId) {
    if (!predictionResult || !predictionResult.landing || !predictionResult.landing.latlng) return null;
    var landing = predictionResult.landing;
    var landSeaResult = localLandSeaResult(landing.latlng.lat, landing.latlng.lng);
    return {
        seriesId: seriesId,
        latitude: landing.latlng.lat,
        longitude: landing.latlng.lng,
        timeUtc: landing.datetime && typeof landing.datetime.toISOString === 'function' ? landing.datetime.toISOString() : null,
        nearestSupportPoint: null,
        landSea: landSeaResult
    };
}

function persistPredictionRunBoundary(context, boundary) {
    if (!context || !context.runId || typeof RunRepository === 'undefined') return Promise.resolve(null);
    var progress = Object.assign({}, boundary && boundary.progress || {});
    if (context.diagnostics) {
        progress.httpAttempts = context.diagnostics.httpAttempts;
        progress.cacheHits = context.diagnostics.cacheHits;
        progress.retryCount = context.diagnostics.retryCount;
    }
    var ready = context.runRecordReady || Promise.resolve();
    return ready.then(function () {
        return RunRepository.saveBoundary(context.runId, Object.assign({}, boundary || {}, { progress: progress }));
    }).catch(function (error) {
        if (typeof reportNonFatalError === 'function') reportNonFatalError(error, 'run-record.boundary');
        return null;
    });
}

function saveSinglePredictionResult(context, predictionResult) {
    if (!context || !context.runId) return;
    var series = plainTrajectorySeries(predictionResult, context.runId, null, '予測');
    var landing = plainLandingResult(predictionResult, series ? series.id : context.runId + ':main');
    persistPredictionRunBoundary(context, {
        status: 'completed',
        progress: { completedUnits: 1, totalUnits: 1, currentLabel: '完了' },
        output: {
            trajectories: series ? [series] : [],
            landings: landing ? [landing] : [],
            metrics: {}
        }
    });
}

function buildEhimeRunOutput(runId) {
    var trajectories = [];
    var landings = [];
    var completed = 0;
    var failed = 0;
    Object.keys(ehime_predictions || {}).forEach(function (key) {
        var entry = ehime_predictions[key];
        if (!entry) return;
        if (entry.status === 'error') failed += 1;
        if (entry.status !== 'ok' || !entry.results) return;
        completed += 1;
        var series = plainTrajectorySeries(entry.results, runId, entry.label, entry.label);
        if (series) trajectories.push(series);
        var landing = plainLandingResult(entry.results, series ? series.id : runId + ':' + entry.label);
        if (landing) landings.push(landing);
    });
    return {
        completed: completed,
        failed: failed,
        trajectories: trajectories,
        landings: landings
    };
}

function persistEhimeRunBoundary(status, error) {
    if (!ehime_current || !ehime_current.runId || ehime_current.suppressRunRecord) return Promise.resolve(null);
    var output = buildEhimeRunOutput(ehime_current.runId);
    return persistPredictionRunBoundary(ehime_current.requestContext, {
        status: status,
        progress: {
            completedUnits: output.completed + output.failed,
            totalUnits: ehime_variant_total,
            currentLabel: status === 'running' ? '愛媛13条件を実行中' : '愛媛13条件完了'
        },
        output: {
            trajectories: output.trajectories,
            landings: output.landings,
            metrics: { completedVariants: output.completed, failedVariants: output.failed }
        },
        error: error
    });
}

function initializePredictionBatch(context, total) {
    if (!context) return;
    context.batchProgress = {
        completed: 0,
        total: Math.max(0, Number(total) || 0),
        failed: 0
    };
}

function recordPredictionBatchBoundary(context, success, error) {
    if (!context || !context.batchProgress) return;
    context.batchProgress.completed += 1;
    if (!success) context.batchProgress.failed += 1;
    var done = context.batchProgress.completed >= context.batchProgress.total;
    var status = done
        ? (context.batchProgress.failed === 0 ? 'completed' : (context.batchProgress.failed < context.batchProgress.total ? 'partial' : 'failed'))
        : 'running';
    persistPredictionRunBoundary(context, {
        status: status,
        progress: {
            completedUnits: context.batchProgress.completed,
            totalUnits: context.batchProgress.total,
            currentLabel: done ? '時刻比較完了' : '時刻比較を実行中'
        },
        output: {
            metrics: { failedPredictions: context.batchProgress.failed }
        },
        error: done && status === 'failed' ? error : undefined
    });
}
function getPredictionRequestBaseUrl(requestContext) {
    if (requestContext && requestContext.baseUrl) return requestContext.baseUrl;
    return resolveTawhiriApiUrl() || 'https://api.v2.sondehub.org/tawhiri';
}

function toggleCustomApiInput() {
    var source = $('#api_source').val();
    var input = $('#api_custom_url');
    if (!input.length) {
        return;
    }
    if (source === 'custom') {
        input.show();
    } else {
        input.hide();
    }
}

function requestPredictionWithApiValidation(run_settings, extra_settings, requestedSource, requestContext) {
    // local選択時のみ、2026用プロキシ配信かを確認してから実行する。
    // 条件を満たさない場合はSondeHubへ自動フォールバックする。
    if (requestedSource !== 'local') {
        tawhiriRequest(run_settings, extra_settings, requestContext);
        return;
    }

    $.getJSON('/__server-info')
        .done(function (info) {
            if (info && info.app === 'Falling-position-simulator2026') {
                tawhiriRequest(run_settings, extra_settings, requestContext);
                return;
            }

            $('#api_source').val('sondehub');
            toggleCustomApiInput();
            requestContext = createFallbackPredictionRequestContext(requestContext, run_settings);
            try {
                var u1 = new URL(window.location.href);
                u1.searchParams.set('api_source', 'sondehub');
                u1.searchParams.delete('api_custom_url');
                history.replaceState({}, 'CUSF / SondeHub Predictor', u1.href);
            } catch (_e1) { if (typeof reportNonFatalError === 'function') reportNonFatalError(_e1, 'non-fatal fallback'); }
            appendDebug('Localhost接続を検証できなかったためSondeHubへ切替');
            throwError('Localhost接続には2026のcors-proxy経由が必要です。SondeHubへ自動切替しました。');
            tawhiriRequest(run_settings, extra_settings, requestContext);
        })
        .fail(function () {
            $('#api_source').val('sondehub');
            toggleCustomApiInput();
            requestContext = createFallbackPredictionRequestContext(requestContext, run_settings);
            try {
                var u2 = new URL(window.location.href);
                u2.searchParams.set('api_source', 'sondehub');
                u2.searchParams.delete('api_custom_url');
                history.replaceState({}, 'CUSF / SondeHub Predictor', u2.href);
            } catch (_e2) { if (typeof reportNonFatalError === 'function') reportNonFatalError(_e2, 'non-fatal fallback'); }
            appendDebug('Localhost接続検証に失敗したためSondeHubへ切替');
            throwError('Localhost接続には2026のcors-proxy経由が必要です。SondeHubへ自動切替しました。');
            tawhiriRequest(run_settings, extra_settings, requestContext);
        });
}

function shouldValidateSondeHubTimeWindow(apiSource) {
    // SondeHub公開APIの運用レンジに合わせて時刻制限を適用する。
    // local/customは過去データ再現用途があるため、ここでは制限しない。
    return apiSource === 'sondehub';
}


function runPrediction() {
    // Read the user-supplied parameters and request a prediction.
    $('#error_window').hide();

    if (typeof validateAllFields === 'function' && !validateAllFields()) {
        throwError('入力値に不正があります。赤字の項目を修正してください。');
        if (typeof showToast === 'function') {
            showToast('入力値を確認してください', 'warning', 2200);
        }
        return;
    }
    if (typeof saveLastSettings === 'function') {
        saveLastSettings();
    }

    // Always clear previous prediction artifacts first.
    clearMapItems();
    var run_settings = {};
    var extra_settings = {};
    run_settings.profile = $('#flight_profile').val();
    run_settings.pred_type = $('#prediction_type').val();
    var requestedApiSource = $('#api_source').val() || 'sondehub';
    var ehime_mode = (run_settings.pred_type === 'ehime');
    var fall_mode = (run_settings.pred_type === 'fall');

    // Grab date values
    var year = $('#year').val();
    var month = $('#month').val();
    var day = $('#day').val();
    var hour = $('#hour').val();
    var minute = $('#min').val();

    // 入力は JST (UTC+9) 想定。UTC に変換して保持。
    // Months are zero-indexed in Javascript.
    var launch_time_local = moment.tz ? moment.tz([year, month - 1, day, hour, minute, 0, 0], 'Asia/Tokyo') : moment([year, month - 1, day, hour, minute, 0, 0]).utcOffset(9 * 60);
    var launch_time = launch_time_local.clone().utc();
    run_settings.launch_datetime = launch_time.format();
    extra_settings.launch_moment = launch_time;

    // SondeHub利用時のみ、公開API向けの時刻制限を適用する。
    if (shouldValidateSondeHubTimeWindow(requestedApiSource)) {
        if (launch_time < (moment.utc().subtract(12, 'hours'))) {
            throwError("Launch time too old (outside of model time range).");
            return;
        }
        if (launch_time > (moment.utc().add(7, 'days'))) {
            throwError("Launch time too far into the future (outside of model time range).");
            return;
        }
    }

    // Grab other launch settings.
    run_settings.launch_latitude = parseFloat($('#lat').val());
    run_settings.launch_longitude = parseFloat($('#lon').val());
    // Handle negative longitudes - Tawhiri wants longitudes between 0-360
    if (run_settings.launch_longitude < 0.0) {
        run_settings.launch_longitude += 360.0
    }
    run_settings.launch_altitude = parseFloat($('#initial_alt').val());
    run_settings.ascent_rate = parseFloat($('#ascent').val());

    if (run_settings.profile == "standard_profile") {
        run_settings.burst_altitude = parseFloat($('#burst').val());
        run_settings.descent_rate = parseFloat($('#drag').val());
    } else {
        run_settings.float_altitude = parseFloat($('#burst').val());
        run_settings.stop_datetime = launch_time.add(1, 'days').format();
    }

    // FALL モード: 入力は開始高度(= burst) と下降速度のみ。API に対し極端な高速上昇 + 直後バースト設定を与える。
    if (fall_mode) {
        // ユーザー入力の開始高度
        var start_alt = parseFloat($('#initial_alt').val());
        var descent_rate = parseFloat($('#drag').val());
        if (isNaN(start_alt) || isNaN(descent_rate)) {
            throwError('落下モード: 高度/下降速度が不正');
            return;
        }
        // 最小オーバーヘッド: 1m だけ上昇 (API 仕様的に 0 差より安定)
        var ASCENT_BUFFER = 1; // m
        run_settings.fall_user_start_alt = start_alt; // 後段再調整用に保存
        run_settings.launch_altitude = start_alt;              // 実際の開始高度
        run_settings.burst_altitude = start_alt + ASCENT_BUFFER; // 1m 上昇後すぐ下降
        run_settings.ascent_rate = 1; // 1m / 1 m/s = 約1秒相当
        run_settings.descent_rate = descent_rate;
        run_settings.profile = 'standard_profile'; // 強制
    }

    // 愛媛モード: 表示上の許容範囲やマージン情報を計算（API送信値はそのまま）
    if (ehime_mode) {
        var asc = run_settings.ascent_rate;
        var desc = run_settings.descent_rate;
        if (!isNaN(asc)) {
            $('#ehime_ascent_range').text((asc - 1).toFixed(2) + ' ～ ' + (asc + 1).toFixed(2) + ' m/s');
        } else {
            $('#ehime_ascent_range').text('N/A');
        }
        if (!isNaN(desc)) {
            $('#ehime_descent_range').text((desc - 3).toFixed(2) + ' ～ ' + (desc + 3).toFixed(2) + ' m/s');
        } else {
            $('#ehime_descent_range').text('N/A');
        }
        if (!isNaN(run_settings.burst_altitude)) {
            var b = run_settings.burst_altitude;
            var upper = (b * 1.10).toFixed(0);
            var lower = (b * 0.80).toFixed(0);
            $('#ehime_burst_margin').text(lower + ' m ～ ' + upper + ' m');
        } else {
            $('#ehime_burst_margin').text('N/A');
        }
    }


    // Update the URL with the supplied parameters.
    url = new URL(window.location.href);
    // Should probably clear all these parameters before setting them again?
    if (time_was_now) {
        url.searchParams.set('launch_datetime', 'now');
    } else {
        url.searchParams.set('launch_datetime', run_settings.launch_datetime);
    }
    url.searchParams.set('launch_latitude', run_settings.launch_latitude);
    url.searchParams.set('launch_longitude', run_settings.launch_longitude);
    url.searchParams.set('launch_altitude', run_settings.launch_altitude);
    url.searchParams.set('ascent_rate', run_settings.ascent_rate);
    url.searchParams.set('profile', run_settings.profile);
    url.searchParams.set('prediction_type', run_settings.pred_type);
    if (run_settings.profile == "standard_profile") {
        url.searchParams.set('burst_altitude', run_settings.burst_altitude);
        url.searchParams.set('descent_rate', run_settings.descent_rate);
    } else {
        url.searchParams.set('float_altitude', run_settings.float_altitude);
    }

    var apiSource = $('#api_source').val() || 'sondehub';
    url.searchParams.set('api_source', apiSource);
    if (apiSource === 'custom') {
        var customUrl = ($('#api_custom_url').val() || '').trim();
        if (customUrl) {
            url.searchParams.set('api_custom_url', customUrl);
        }
    } else {
        url.searchParams.delete('api_custom_url');
    }

    // Update browser URL.
    history.replaceState(
        {},
        'CUSF / SondeHub Predictor',
        url.href
    );

    var selectedApiUrl = resolveTawhiriApiUrl();
    if (!selectedApiUrl) {
        return;
    }
    var requestContext = createPredictionRequestContext({ source: requestedApiSource, baseUrl: selectedApiUrl });
    if (!ehime_mode) {
        startPredictionRunRecord(run_settings, requestContext, 'single', fall_mode ? '落下予測' : '通常予測');
    }
    appendDebug('Using API: ' + selectedApiUrl);


    // Run the request
    requestPredictionWithApiValidation(run_settings, extra_settings, requestedApiSource, requestContext);

}

// Prediction type change: toggle Ehime info row
$(document).on('change', '#prediction_type', function () {
    if ($(this).val() === 'ehime') {
        $('#ehime_info_row').show();
        $('#ensemble_stats_panel').show();
        ensureEhimePanelVisible();
        expandEhimePanel && expandEhimePanel();
        refreshEhimePanel();
        // Show mobile nav button if mobile UI loaded
        var ehBtn = document.getElementById('mobile_nav_ehime');
        if (ehBtn) { ehBtn.style.display = 'block'; }
        if (window.__mobileUI) { window.__mobileUI.showEhimePanel && window.__mobileUI.showEhimePanel(); }
        // 自動実行を行わず、ユーザーの「予測を実行」ボタン押下を待つ。
        // 以前の結果が残っていると紛らわしいため表示値をリセット。
        $('#ehime_completed').text('0');
        $('#ehime_total').text('0');
        $('#ehime_mean').text('-');
        $('#ehime_max_dev').text('-');
        $('#ehime_ascent_range').text('-');
        $('#ehime_descent_range').text('-');
        $('#ehime_burst_margin').text('-');
        $('#ehime_dlcsv').hide();
    } else {
        $('#ehime_info_row').hide();
        $('#ehime_dlcsv').hide();
        $('#ensemble_stats_panel').hide();
        // 完全に非表示へ（他モード時は占有しない）
        var panel = $('#ehime_panel');
        if (panel.length) {
            panel.hide();
            panel.removeClass('ehime-collapsed');
            $('#ehime_panel_close').text('折り畳む');
            $('#ehime_panel_toggle').text('«');
        }
    }
    // 落下モード UI 切替
    updateFallModeUI();
});

// Tawhiri API URL. Refer to API docs here: https://tawhiri.readthedocs.io/en/latest/api.html
// Habitat Tawhiri Instance
// Approximately how many hours into the future the model covers.
