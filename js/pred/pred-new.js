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

function requestPredictionWithApiValidation(run_settings, extra_settings, requestedSource) {
    // local選択時のみ、2026用プロキシ配信かを確認してから実行する。
    // 条件を満たさない場合はSondeHubへ自動フォールバックする。
    if (requestedSource !== 'local') {
        tawhiriRequest(run_settings, extra_settings);
        return;
    }

    $.getJSON('/__server-info')
        .done(function (info) {
            if (info && info.app === 'Falling-position-simulator2026') {
                tawhiriRequest(run_settings, extra_settings);
                return;
            }

            $('#api_source').val('sondehub');
            toggleCustomApiInput();
            tawhiri_api = 'https://api.v2.sondehub.org/tawhiri';
            try {
                var u1 = new URL(window.location.href);
                u1.searchParams.set('api_source', 'sondehub');
                u1.searchParams.delete('api_custom_url');
                history.replaceState({}, 'CUSF / SondeHub Predictor', u1.href);
            } catch (_e1) { }
            appendDebug('Localhost接続を検証できなかったためSondeHubへ切替');
            throwError('Localhost接続には2026のcors-proxy経由が必要です。SondeHubへ自動切替しました。');
            tawhiriRequest(run_settings, extra_settings);
        })
        .fail(function () {
            $('#api_source').val('sondehub');
            toggleCustomApiInput();
            tawhiri_api = 'https://api.v2.sondehub.org/tawhiri';
            try {
                var u2 = new URL(window.location.href);
                u2.searchParams.set('api_source', 'sondehub');
                u2.searchParams.delete('api_custom_url');
                history.replaceState({}, 'CUSF / SondeHub Predictor', u2.href);
            } catch (_e2) { }
            appendDebug('Localhost接続検証に失敗したためSondeHubへ切替');
            throwError('Localhost接続には2026のcors-proxy経由が必要です。SondeHubへ自動切替しました。');
            tawhiriRequest(run_settings, extra_settings);
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
    tawhiri_api = selectedApiUrl;
    appendDebug('Using API: ' + tawhiri_api);


    // Run the request
    requestPredictionWithApiValidation(run_settings, extra_settings, requestedApiSource);

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
//var tawhiri_api = "https://predict.cusf.co.uk/api/v1/";
// Sondehub Tawhiri Instance
var tawhiri_api = "https://api.v2.sondehub.org/tawhiri";
// Approximately how many hours into the future the model covers.
var MAX_PRED_HOURS = 169;
// Ehime mode storage
var ehime_current = null;
var ehime_predictions = {}; // variant_id -> {settings, status, results, marker}
var ehime_variant_total = 0;
var EHIME_HISTORY_KEY = 'ehime_history_runs_v1';
var EHIME_HISTORY_LIMIT = 10;
var ehime_history_saved_for_run = false;
var ehime_mean_marker = null;
var ehime_dispersion_circle = null;
var currentEhimeReplayHistoryId = null;
var ehime_burst_circle = null;
var EHIME_HISTORY_LAYER_PREFIX = 'ehime_history_layer_';
var EHIME_HISTORY_REPLAY_LAYER_ID = 'ehime_history_replay_layer';
var ehime_history_layers = {};
// (Removed visual summary overlays as per request)
var ehime_mean_marker = null; // kept for compatibility but unused
var ehime_dispersion_circle = null; // unused
var ehime_burst_circle = null; // unused

function toEhimeFiniteNumber(value) {
    var num = parseFloat(value);
    return isFinite(num) ? num : null;
}

function getEhimeHistoryLayerKey(historyId) {
    return EHIME_HISTORY_LAYER_PREFIX + String(historyId);
}

function getEhimeHistoryRecordId(item, fallbackIndex) {
    if (item && item.savedAt) return String(item.savedAt);
    if (item && item.id) return String(item.id);
    return String(typeof fallbackIndex === 'number' ? fallbackIndex : '');
}

function getEhimeHistoryActiveIndex() {
    var list = loadEhimeHistoryCache();
    if (list.length === 0) return -1;
    if (currentEhimeReplayHistoryId) {
        for (var i = 0; i < list.length; i++) {
            if (String(getEhimeHistoryRecordId(list[i], i)) === String(currentEhimeReplayHistoryId)) {
                return i;
            }
        }
    }
    return 0;
}

function syncEhimeHistoryNavButtons() {
    var list = loadEhimeHistoryCache();
    var index = getEhimeHistoryActiveIndex();
    var hasHistory = list.length > 0 && index >= 0;
    $('#ehime_history_prev_btn').prop('disabled', !hasHistory || index >= list.length - 1);
    $('#ehime_history_next_btn').prop('disabled', !hasHistory || index <= 0);
    $('#ehime_history_position').text(hasHistory ? ((index + 1) + ' / ' + list.length) : '-');
}

function getEhimeHistoryOverlayColor(historyId) {
    var palette = ['#8e24aa', '#1e88e5', '#43a047', '#fb8c00', '#e53935', '#00897b', '#6d4c41', '#3949ab', '#7cb342', '#f4511e'];
    var str = String(historyId || '0');
    var hash = 0;
    for (var i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i);
        hash |= 0;
    }
    return palette[Math.abs(hash) % palette.length];
}

function isEhimeHistoryLayerActive(historyId) {
    return !!ehime_history_layers[getEhimeHistoryLayerKey(historyId)];
}

function removeEhimeHistoryLayer(historyId) {
    var key = getEhimeHistoryLayerKey(historyId);
    var entry = ehime_history_layers[key];
    if (!entry) return;
    if (entry.layer && typeof entry.layer.remove === 'function') {
        entry.layer.remove();
    }
    delete ehime_history_layers[key];
}

function clearEhimeHistoryLayers() {
    Object.keys(ehime_history_layers).forEach(function (key) {
        var entry = ehime_history_layers[key];
        if (entry && entry.layer && typeof entry.layer.remove === 'function') {
            entry.layer.remove();
        }
        delete ehime_history_layers[key];
    });
    currentEhimeReplayHistoryId = null;
    renderEhimeHistoryPanel();
}

function buildEhimeVariantDiffLabel(baseSettings, rowSettings, label) {
    if (label === 'BASE') return '-';
    if (!baseSettings || !rowSettings) return '';

    var parts = [];
    if (toEhimeFiniteNumber(rowSettings.ascent_rate) !== toEhimeFiniteNumber(baseSettings.ascent_rate)) {
        parts.push('A' + (toEhimeFiniteNumber(rowSettings.ascent_rate) > toEhimeFiniteNumber(baseSettings.ascent_rate) ? '+' : '-'));
    }
    if (toEhimeFiniteNumber(rowSettings.descent_rate) !== toEhimeFiniteNumber(baseSettings.descent_rate)) {
        parts.push('D' + (toEhimeFiniteNumber(rowSettings.descent_rate) > toEhimeFiniteNumber(baseSettings.descent_rate) ? '+' : '-'));
    }
    if (toEhimeFiniteNumber(rowSettings.burst_altitude) !== toEhimeFiniteNumber(baseSettings.burst_altitude)) {
        var baseBurst = toEhimeFiniteNumber(baseSettings.burst_altitude) || 0;
        var rowBurst = toEhimeFiniteNumber(rowSettings.burst_altitude) || 0;
        var ratio = baseBurst > 0 ? (rowBurst / baseBurst) : 0;
        parts.push('B' + (ratio > 1 ? '+' : '-'));
    }
    return parts.join(' ');
}

function formatEhimeHistoryDate(value, pattern) {
    try {
        var m = moment(value);
        if (!m.isValid()) return '-';
        return m.utcOffset(9 * 60).format(pattern || 'YYYY-MM-DD HH:mm');
    } catch (_e) {
        return '-';
    }
}

function buildEhimeHistoryOverlayLayer(item, historyId) {
    var rows = Array.isArray(item && item.rows) ? item.rows : [];
    if (rows.length === 0) return null;

    var color = getThemeColor('--color-danger', '#ff3b30');
    if (typeof historyId !== 'undefined') {
        color = getEhimeHistoryOverlayColor(historyId);
    }

    var layer = L.layerGroup();
    var markers = [];
    rows.forEach(function (row, idx) {
        var lat = toEhimeFiniteNumber(row.lat);
        var lng = toEhimeFiniteNumber(row.lng);
        if (lat === null || lng === null) return;

        var flightPath = Array.isArray(row.flightPath) ? row.flightPath : [];
        if (flightPath.length > 1) {
            var polylinePoints = flightPath.map(function (point) {
                if (Array.isArray(point) && point.length >= 2) {
                    return [point[0], point[1]];
                }
                return null;
            }).filter(function (point) { return !!point; });
            if (polylinePoints.length > 1) {
                L.polyline(polylinePoints, {
                    color: color,
                    weight: 2,
                    opacity: 0.45,
                    interactive: false
                }).addTo(layer);
            }
        }

        var marker = L.circleMarker([lat, lng], {
            radius: row.label === 'BASE' ? 6 : 4,
            color: color,
            fillColor: color,
            fillOpacity: 0.85,
            weight: 1,
            opacity: 0.95
        });
        var historyRowIndex = toEhimeFiniteNumber(row.index);
        if (historyRowIndex === null) historyRowIndex = idx;
        marker._ehimeHistoryRowIndex = historyRowIndex;
        var flightText = row.flightTimeMin != null ? row.flightTimeMin + '分' : '-';
        var popupHtml = '<b>' + escapeEhimeHistoryText(row.label || 'VAR') + '</b><br>'
            + escapeEhimeHistoryText(row.description || '-') + '<br>'
            + '上昇: ' + escapeEhimeHistoryText(row.ascentRate != null ? row.ascentRate.toFixed(1) : '-') + ' m/s<br>'
            + '下降: ' + escapeEhimeHistoryText(row.descentRate != null ? row.descentRate.toFixed(1) : '-') + ' m/s<br>'
            + '破裂: ' + escapeEhimeHistoryText(row.burstAltitude != null ? row.burstAltitude.toFixed(0) : '-') + ' m<br>'
            + '飛行: ' + escapeEhimeHistoryText(flightText) + '<br>'
            + '着地: ' + lat.toFixed(4) + ', ' + lng.toFixed(4);
        marker.bindPopup(popupHtml);
        markers.push(marker);
        layer.addLayer(marker);
    });
    layer._ehimeHistoryMarkers = markers;

    return layer;
}

function showEhimeHistoryLayer(item, historyId) {
    var key = getEhimeHistoryLayerKey(historyId);
    removeEhimeHistoryLayer(historyId);

    var layer = buildEhimeHistoryOverlayLayer(item, historyId);
    if (!layer) return null;

    layer.addTo(map);
    ehime_history_layers[key] = {
        layer: layer,
        item: item,
        markers: layer._ehimeHistoryMarkers || []
    };
    return layer;
}

function getEhimeHistoryMarkerForRow(historyId, rowIndex) {
    var entry = ehime_history_layers[getEhimeHistoryLayerKey(historyId)];
    if (!entry || !Array.isArray(entry.markers)) return null;
    for (var i = 0; i < entry.markers.length; i++) {
        var marker = entry.markers[i];
        if (!marker) continue;
        if (String(marker._ehimeHistoryRowIndex) === String(rowIndex)) {
            return marker;
        }
    }
    return null;
}

function getEhimeHistoryLayerStatusText(historyId) {
    return isEhimeHistoryLayerActive(historyId) ? '重ね表示を隠す' : '重ね表示';
}

function toggleEhimeHistoryOverlay(historyId, itemIfMissing) {
    var list = loadEhimeHistoryCache();
    var item = itemIfMissing || null;
    if (!item) {
        for (var i = 0; i < list.length; i++) {
            if (String(getEhimeHistoryRecordId(list[i], i)) === String(historyId)) {
                item = list[i];
                break;
            }
        }
    }
    if (!item) return;

    if (isEhimeHistoryLayerActive(historyId)) {
        removeEhimeHistoryLayer(historyId);
        renderEhimeHistoryPanel();
        if (typeof showToast === 'function') {
            showToast('重ね表示を非表示にしました', 'info', 1600);
        }
        return false; // Deactivated
    }

    if (!showEhimeHistoryLayer(item, historyId)) {
        if (typeof showToast === 'function') {
            showToast('重ね表示できる履歴データがありません', 'warning', 2200);
        }
        return null; // Error
    }

    renderEhimeHistoryPanel();
    if (typeof showToast === 'function') {
        showToast('重ね表示しました', 'info', 1600);
    }
    return true; // Activated
}

function loadEhimeHistoryCache() {
    try {
        var raw = localStorage.getItem(EHIME_HISTORY_KEY);
        var parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
    } catch (_e) {
        return [];
    }
}

function saveEhimeHistoryCache(items) {
    try {
        localStorage.setItem(EHIME_HISTORY_KEY, JSON.stringify(items || []));
    } catch (_e) { }
}

function buildEhimeHistorySnapshot() {
    var keys = Object.keys(ehime_predictions || {});
    var rows = [];
    var baseSettings = null;

    keys.forEach(function (k) {
        var p = ehime_predictions[k];
        if (!p || p.status !== 'ok' || !p.results || !p.results.landing) return;
        var idx = parseInt(k.split('_')[1], 10);
        var launchMoment = p.results.launch && p.results.launch.datetime ? p.results.launch.datetime : null;
        var burstMoment = p.results.burst && p.results.burst.datetime ? p.results.burst.datetime : null;
        var landingMoment = p.results.landing && p.results.landing.datetime ? p.results.landing.datetime : null;
        var launchLat = p.results.launch && p.results.launch.latlng ? p.results.launch.latlng.lat : null;
        var launchLng = p.results.launch && p.results.launch.latlng ? p.results.launch.latlng.lng : null;
        var launchAlt = p.results.launch && p.results.launch.latlng ? p.results.launch.latlng.alt : null;
        var burstLat = p.results.burst && p.results.burst.latlng ? p.results.burst.latlng.lat : null;
        var burstLng = p.results.burst && p.results.burst.latlng ? p.results.burst.latlng.lng : null;
        var burstAlt = p.results.burst && p.results.burst.latlng ? p.results.burst.latlng.alt : null;
        var ascentRate = p.settings && typeof p.settings.ascent_rate === 'number' ? p.settings.ascent_rate : null;
        var descentRate = p.settings && typeof p.settings.descent_rate === 'number' ? p.settings.descent_rate : null;
        var burstAltitude = p.settings && typeof p.settings.burst_altitude === 'number' ? p.settings.burst_altitude : null;
        if (!baseSettings && p.label === 'BASE' && p.settings) {
            baseSettings = {
                ascent_rate: ascentRate,
                descent_rate: descentRate,
                burst_altitude: burstAltitude,
                launch_latitude: p.settings.launch_latitude,
                launch_longitude: p.settings.launch_longitude,
                initial_alt: p.settings.initial_alt,
                profile: p.settings.profile,
                pred_type: p.settings.pred_type,
                launch_site_name: $('#site option:selected').text() || '-',
                api_source: $('#api_source').val() || '',
                api_custom_url: $('#api_custom_url').val() || '',
                launch_datetime: launchMoment ? launchMoment.clone().toISOString() : null
            };
        }
        rows.push({
            index: isNaN(idx) ? rows.length : idx,
            label: p.label || '-',
            description: p.label === 'BASE' ? '-' : buildEhimeVariantDiffLabel(baseSettings, p.settings, p.label),
            lat: p.results.landing.latlng.lat,
            lng: p.results.landing.latlng.lng,
            ascentRate: ascentRate,
            descentRate: descentRate,
            burstAltitude: burstAltitude,
            flightTimeSec: launchMoment && landingMoment ? landingMoment.diff(launchMoment, 'seconds') : null,
            flightTimeMin: launchMoment && landingMoment ? Math.floor(landingMoment.diff(launchMoment, 'seconds') / 60) : null,
            launchDatetime: launchMoment ? launchMoment.clone().toISOString() : null,
            burstDatetime: burstMoment ? burstMoment.clone().toISOString() : null,
            landingDatetime: landingMoment ? landingMoment.clone().toISOString() : null,
            launchLat: launchLat,
            launchLng: launchLng,
            launchAlt: launchAlt,
            burstLat: burstLat,
            burstLng: burstLng,
            burstAlt: burstAlt,
            isWater: p.landsea === '海' ? true : (p.landsea === '陸' ? false : null),
            landsea: p.landsea || '-',
            flightPath: Array.isArray(p.results.flight_path) ? p.results.flight_path : []
        });
    });

    rows.sort(function (a, b) { return a.index - b.index; });
    if (rows.length === 0) return null;

    var sumLat = 0;
    var sumLng = 0;
    rows.forEach(function (r) { sumLat += r.lat; sumLng += r.lng; });
    var meanLat = sumLat / rows.length;
    var meanLng = sumLng / rows.length;
    var maxDev = 0;
    rows.forEach(function (r) {
        var distKm = parseFloat(distHaversine({ lat: meanLat, lng: meanLng }, { lat: r.lat, lng: r.lng }, 2));
        if (isFinite(distKm) && distKm > maxDev) {
            maxDev = distKm;
        }
    });

    var baseEntry = null;
    keys.forEach(function (k) {
        var p = ehime_predictions[k];
        if (baseEntry || !p || p.label !== 'BASE' || !p.results || !p.results.launch) return;
        baseEntry = p;
    });

    var launchJst = baseEntry && baseEntry.results && baseEntry.results.launch && baseEntry.results.launch.datetime
        ? baseEntry.results.launch.datetime.clone().utcOffset(9 * 60).format('YYYY-MM-DD HH:mm')
        : moment().utcOffset(9 * 60).format('YYYY-MM-DD HH:mm');

    var landCount = 0;
    var waterCount = 0;
    rows.forEach(function (row) {
        if (row.isWater === false) landCount += 1;
        if (row.isWater === true) waterCount += 1;
    });

    return {
        savedAt: moment().toISOString(),
        launchJst: launchJst,
        siteName: $('#site option:selected').text() || '-',
        count: rows.length,
        meanLat: meanLat,
        meanLng: meanLng,
        maxDev: maxDev,
        landCount: landCount,
        waterCount: waterCount,
        baseSettings: baseSettings,
        rows: rows
    };
}

function saveEhimeHistorySnapshot() {
    var snapshot = buildEhimeHistorySnapshot();
    if (!snapshot) return;

    var list = loadEhimeHistoryCache();
    list.unshift(snapshot);
    if (list.length > EHIME_HISTORY_LIMIT) {
        list = list.slice(0, EHIME_HISTORY_LIMIT);
    }
    saveEhimeHistoryCache(list);
}

function escapeEhimeHistoryText(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function buildEhimeHistoryReplayRowsHtml(item) {
    var rows = Array.isArray(item && item.rows) ? item.rows : [];
    if (rows.length === 0) {
        return '<tr><td colspan="11" style="font-size:11px; color:var(--text-secondary);">履歴データに着地点がありません</td></tr>';
    }

    var html = [];
    rows.forEach(function (row, idx) {
        var lat = toEhimeFiniteNumber(row.lat);
        var lng = toEhimeFiniteNumber(row.lng);
        var color = '#cccccc';
        if (typeof evaluate_cmap === 'function' && typeof ConvertRGBtoHex === 'function' && rows.length > 0) {
            color = ConvertRGBtoHex(evaluate_cmap((idx + 1) / (rows.length + 1), 'turbo'));
        }
        var ascent = toEhimeFiniteNumber(row.ascentRate);
        var descent = toEhimeFiniteNumber(row.descentRate);
        var burst = toEhimeFiniteNumber(row.burstAltitude);
        var flightMin = toEhimeFiniteNumber(row.flightTimeMin);
        var landsea = row.landsea || (row.isWater === true ? '海' : (row.isWater === false ? '陸' : '-'));
        var description = row.description || '-';
        var landseaClass = row.isWater === true ? 'ehime-landsea-sea' : (row.isWater === false ? 'ehime-landsea-land' : 'ehime-landsea-unknown');
        var historyRowIndex = row.index != null ? row.index : idx;
        html.push(
            '<tr class="ehime-history-row" data-history-row-index="' + historyRowIndex + '" data-history-lat="' + (lat !== null ? lat : '') + '" data-history-lng="' + (lng !== null ? lng : '') + '" data-variant-index="' + (row.index || idx) + '">' +
            '<td>' + (idx + 1) + '</td>' +
            '<td><span class="ehime-color-swatch" style="background:' + color + '"></span></td>' +
            '<td>' + escapeEhimeHistoryText(row.label || ('VAR-' + (idx + 1))) + '</td>' +
            '<td>' + escapeEhimeHistoryText(description) + '</td>' +
            '<td>' + (lat !== null ? lat.toFixed(4) : '-') + '</td>' +
            '<td>' + (lng !== null ? lng.toFixed(4) : '-') + '</td>' +
            '<td>' + (ascent !== null ? ascent.toFixed(1) : '-') + '</td>' +
            '<td>' + (descent !== null ? descent.toFixed(1) : '-') + '</td>' +
            '<td>' + (burst !== null ? burst.toFixed(0) : '-') + '</td>' +
            '<td>' + (flightMin !== null ? flightMin.toFixed(0) : '-') + '</td>' +
            '<td><span class="ehime-landsea-text ' + landseaClass + '">' + escapeEhimeHistoryText(landsea) + '</span></td>' +
            '</tr>'
        );
    });

    return html.join('');
}

function renderEhimeHistoryToResultPanels(item) {
    var rowsHtml = buildEhimeHistoryReplayRowsHtml(item);
    $('#ehime_results_body').html(rowsHtml);
    $('#ehime_variants_table tbody').html(rowsHtml);

    var count = item && item.count ? item.count : (Array.isArray(item && item.rows) ? item.rows.length : 0);
    var meanText = (typeof item.meanLat === 'number' && typeof item.meanLng === 'number')
        ? (item.meanLat.toFixed(4) + ', ' + item.meanLng.toFixed(4))
        : '-';
    var landCount = toEhimeFiniteNumber(item && item.landCount);
    var waterCount = toEhimeFiniteNumber(item && item.waterCount);
    var hasLandWater = landCount !== null || waterCount !== null;

    $('#ehime_completed').text(count);
    $('#ehime_total').text(count);
    $('#ehime_mean').text(meanText);
    $('#ehime_max_dev').text(item && typeof item.maxDev === 'number' ? item.maxDev.toFixed(2) : '-');
    $('#ehime_panel_completed').text(count);
    $('#ehime_panel_total').text(count);
    $('#ehime_panel_mean').text(meanText);
    $('#ehime_panel_maxdev').text(item && typeof item.maxDev === 'number' ? item.maxDev.toFixed(2) : '-');
    $('#ensemble_completed').text(count);
    $('#ensemble_total').text(count);
    $('#ensemble_mean_pos').text(meanText);
    $('#ensemble_max_dev').text(item && typeof item.maxDev === 'number' ? item.maxDev.toFixed(2) : '-');

    if (hasLandWater) {
        var totalDetermined = landCount + waterCount;
        $('#ensemble_land_pct').text(totalDetermined > 0 ? Math.round((landCount / totalDetermined) * 100) + '%' : '-');
        $('#ensemble_sea_pct').text(totalDetermined > 0 ? Math.round((waterCount / totalDetermined) * 100) + '%' : '-');
    }

    var landingPoints = Array.isArray(item && item.rows) ? item.rows.map(function (row) {
        return {
            lat: toEhimeFiniteNumber(row.lat),
            lng: toEhimeFiniteNumber(row.lng),
            label: row.label || '-',
            isWater: row.isWater
        };
    }).filter(function (row) {
        return row.lat !== null && row.lng !== null;
    }) : [];

    if (landingPoints.length > 0) {
        if (typeof updateEnsembleWaterStats === 'function') {
            updateEnsembleWaterStats(landingPoints, count);
        }
        if (typeof compute13VarStatistics === 'function') {
            compute13VarStatistics(landingPoints);
        }
    }

    currentEhimeReplayHistoryId = getEhimeHistoryRecordId(item);
}

// Global registry for Ehime snapshots to support popup buttons
window.ehime_snaps = window.ehime_snaps || {};

function ehimePopupReplay(snapId) {
    var snap = window.ehime_snaps[snapId];
    if (!snap) return;
    $('#prediction_type').val('ehime').trigger('change');
    if (typeof restoreEhimeHistoryAsCurrentRun === 'function') {
        restoreEhimeHistoryAsCurrentRun(snap);
        if (typeof showToast === 'function') showToast('履歴を再表示しました', 'info', 1800);
    }
}

function ehimePopupToggleOverlay(snapId, btn) {
    var snap = window.ehime_snaps[snapId];
    if (!snap) return;
    var hid = typeof getEhimeHistoryRecordId === 'function' ? getEhimeHistoryRecordId(snap) : null;
    if (!hid) return;
    var res = toggleEhimeHistoryOverlay(hid, snap);
    if (res !== null && btn) {
        btn.textContent = res ? '重ね表示を隠す' : '重ね表示';
    }
}

function renderEhimeHistoryPanel() {
    var containers = $('#ehime_history_panel_result, #ehime_history_panel');
    if (containers.length === 0) return;

    var list = loadEhimeHistoryCache();
    if (list.length === 0) {
        containers.html('<p style="font-size:11px; color:var(--text-secondary); padding:4px;">実行履歴なし</p>');
        return;
    }

    var html = [];
    html.push('<div class="ehime-history-toolbar" style="display:flex; justify-content:flex-end; margin-bottom:6px;">');
    html.push('<button type="button" class="btn-preset" style="height:22px; font-size:10px; padding:0 8px;" onclick="clearEhimeHistoryLayers()">重ね表示を全てクリア</button>');
    html.push('</div>');
    list.forEach(function (item, idx) {
        var mean = (typeof item.meanLat === 'number' && typeof item.meanLng === 'number')
            ? (item.meanLat.toFixed(4) + ', ' + item.meanLng.toFixed(4))
            : '-';
        var total = (typeof item.count === 'number') ? item.count : (Array.isArray(item.rows) ? item.rows.length : 0);
        var landPct = '-';
        var seaPct = '-';
        if (typeof item.landCount === 'number' && typeof item.waterCount === 'number') {
            var det = item.landCount + item.waterCount;
            if (det > 0) {
                landPct = Math.round((item.landCount / det) * 100) + '%';
                seaPct = Math.round((item.waterCount / det) * 100) + '%';
            } else { landPct = '0%'; seaPct = '0%'; }
        }
        var historyId = getEhimeHistoryRecordId(item, idx);
        var activeText = getEhimeHistoryLayerStatusText(historyId);
        html.push(
            '<div class="ehime-history-item" style="border:1px solid var(--border-color); border-radius:6px; padding:6px; margin:6px 0;">'
            + '<div style="font-size:11px; font-weight:600; color:var(--text-primary);">'
            + (idx + 1) + '. ' + (item.launchJst || '-') + ' JST / ' + (item.siteName || '-')
            + '</div>'
            + '<div style="font-size:10px; color:var(--text-secondary); margin-top:2px;">'
            + '件数: ' + total + ' / 平均着地点: ' + mean + ' / 陸着率: ' + landPct + ' / 海着率: ' + seaPct
            + '</div>'
            + '<div class="ehime-history-actions" style="margin-top:4px; display:flex; gap:6px; flex-wrap:wrap;">'
            + '<button type="button" class="btn-preset ehime-history-replay" data-history-index="' + idx + '" style="height:22px; font-size:10px; padding:0 8px;">再表示</button>'
            + '<button type="button" class="btn-preset ehime-history-pan" data-history-index="' + idx + '" style="height:22px; font-size:10px; padding:0 8px;">地図へ移動</button>'
            + '<button type="button" class="btn-preset ehime-history-overlay" data-history-index="' + idx + '" style="height:22px; font-size:10px; padding:0 8px;">' + activeText + '</button>'
            + '</div>'
            + '</div>'
        );
    });
    containers.html(html.join(''));
    syncEhimeHistoryNavButtons();
}

function replayEhimeHistory(index, mapOnly) {
    var list = loadEhimeHistoryCache();
    var item = list[index];
    if (!item) return;

    $('#prediction_type').val('ehime').trigger('change');
    if (!restoreEhimeHistoryAsCurrentRun(item)) return;

    if (typeof showToast === 'function' && !mapOnly) {
        showToast('履歴を再表示しました', 'info', 1800);
    }
}

function replayEhimeHistoryStep(index, step) {
    var list = loadEhimeHistoryCache();
    var targetIndex = index + step;
    if (targetIndex < 0) targetIndex = 0;
    if (targetIndex >= list.length) targetIndex = list.length - 1;
    if (targetIndex < 0 || !list[targetIndex]) return;
    replayEhimeHistory(targetIndex, false);
}

function buildEhimeReplaySettings(baseSettings, row) {
    var settings = baseSettings ? JSON.parse(JSON.stringify(baseSettings)) : {};
    settings.pred_type = 'ehime';
    if (row && row.ascentRate !== null) settings.ascent_rate = row.ascentRate;
    if (row && row.descentRate !== null) settings.descent_rate = row.descentRate;
    if (row && row.burstAltitude !== null) settings.burst_altitude = row.burstAltitude;
    if (row && row.launchLat !== null) settings.launch_latitude = row.launchLat;
    if (row && row.launchLng !== null) settings.launch_longitude = row.launchLng;
    if (row && row.launchDatetime) settings.launch_datetime = row.launchDatetime;
    return settings;
}

function buildEhimeReplayResults(row) {
    if (!row) return null;

    var launchLat = toEhimeFiniteNumber(row.launchLat);
    var launchLng = toEhimeFiniteNumber(row.launchLng);
    var burstLat = toEhimeFiniteNumber(row.burstLat);
    var burstLng = toEhimeFiniteNumber(row.burstLng);
    var burstAlt = toEhimeFiniteNumber(row.burstAlt);
    var landingLat = toEhimeFiniteNumber(row.lat);
    var landingLng = toEhimeFiniteNumber(row.lng);
    var launchAlt = toEhimeFiniteNumber(row.launchAlt);
    var flightPath = Array.isArray(row.flightPath) ? row.flightPath : [];
    var launchDatetime = row.launchDatetime ? moment(row.launchDatetime) : null;
    var burstDatetime = row.burstDatetime ? moment(row.burstDatetime) : null;
    var landingDatetime = row.landingDatetime ? moment(row.landingDatetime) : null;

    return {
        flight_path: flightPath,
        flight_time: toEhimeFiniteNumber(row.flightTimeSec),
        launch: {
            latlng: L.latLng([
                launchLat !== null ? launchLat : landingLat,
                launchLng !== null ? launchLng : landingLng,
                launchAlt !== null ? launchAlt : 0
            ]),
            datetime: launchDatetime && launchDatetime.isValid() ? launchDatetime : moment()
        },
        burst: {
            latlng: L.latLng([
                burstLat !== null ? burstLat : landingLat,
                burstLng !== null ? burstLng : landingLng,
                burstAlt !== null ? burstAlt : 0
            ]),
            datetime: burstDatetime && burstDatetime.isValid()
                ? burstDatetime
                : (launchDatetime && launchDatetime.isValid() ? launchDatetime.clone() : moment())
        },
        landing: {
            latlng: L.latLng([landingLat, landingLng, 0]),
            datetime: landingDatetime && landingDatetime.isValid()
                ? landingDatetime
                : (launchDatetime && launchDatetime.isValid() ? launchDatetime.clone() : moment())
        },
        profile: row.profile || 'standard_profile'
    };
}

function restoreEhimeHistoryAsCurrentRun(item) {
    var rows = Array.isArray(item && item.rows) ? item.rows.slice() : [];
    rows.sort(function (a, b) { return (a.index || 0) - (b.index || 0); });
    if (rows.length === 0) return false;

    var baseSettings = item && item.baseSettings ? JSON.parse(JSON.stringify(item.baseSettings)) : {};
    baseSettings.pred_type = 'ehime';
    baseSettings.launch_site_name = item.siteName || baseSettings.launch_site_name || '-';

    var baseRow = null;
    for (var i = 0; i < rows.length; i++) {
        if (rows[i].label === 'BASE') {
            baseRow = rows[i];
            break;
        }
    }
    if (!baseRow) { baseRow = rows[0]; }

    clearEhimeHistoryLayers();
    clearMapItems();
    ehime_predictions = {};
    ehime_variant_total = rows.length;
    ehime_history_saved_for_run = true;
    ehime_current = { base: baseSettings, result: null };

    rows.forEach(function (row) {
        var variantIndex = toEhimeFiniteNumber(row.index);
        if (variantIndex === null) variantIndex = 0;
        var variantId = 'ehime_' + variantIndex;
        ehime_predictions[variantId] = {
            label: row.label || ('VAR-' + variantIndex),
            status: 'ok',
            settings: buildEhimeReplaySettings(baseSettings, row),
            results: buildEhimeReplayResults(row),
            landsea: row.landsea || '-',
            marker: null
        };
    });

    if (baseRow) {
        var baseVariantIndex = toEhimeFiniteNumber(baseRow.index);
        if (baseVariantIndex === null) baseVariantIndex = 0;
        var baseVariantId = 'ehime_' + baseVariantIndex;
        var baseEntry = ehime_predictions[baseVariantId];
        if (baseEntry && baseEntry.results) {
            ehime_current.result = baseEntry.results;
            plotStandardPrediction(baseEntry.results, baseEntry.settings || baseSettings);
        }
    }

    Object.keys(ehime_predictions).sort(function (a, b) {
        return parseInt(a.split('_')[1], 10) - parseInt(b.split('_')[1], 10);
    }).forEach(function (variantId) {
        var entry = ehime_predictions[variantId];
        if (!entry || !entry.results) return;
        plotEhimeLandingMarker(variantId, parseInt(variantId.split('_')[1], 10));
    });

    updateEhimeSummaryFromStore();
    refreshEhimePanel();
    currentEhimeReplayHistoryId = getEhimeHistoryRecordId(item);
    syncEhimeHistoryNavButtons();

    if (typeof item.meanLat === 'number' && typeof item.meanLng === 'number' && map && typeof map.setView === 'function') {
        map.setView([item.meanLat, item.meanLng], Math.max(map.getZoom(), 9));
    }

    // Restore ensemble land/sea percentages if available in snapshot
    if (item && (typeof item.landCount === 'number' || typeof item.waterCount === 'number')) {
        var l = toEhimeFiniteNumber(item.landCount) || 0;
        var w = toEhimeFiniteNumber(item.waterCount) || 0;
        var det = l + w;
        if (det > 0) {
            $('#ensemble_land_pct').text(Math.round((l / det) * 100) + '%');
            $('#ensemble_sea_pct').text(Math.round((w / det) * 100) + '%');
        } else {
            $('#ensemble_land_pct').text('0%'); $('#ensemble_sea_pct').text('0%');
        }
    }

    return true;
}

function clearEhimeHistoryCache() {
    clearEhimeHistoryLayers();
    saveEhimeHistoryCache([]);
    renderEhimeHistoryPanel();
}

function finalizeEhimeRunIfCompleted() {
    if (ehime_history_saved_for_run) return;
    if (!ehime_variant_total) return;

    var keys = Object.keys(ehime_predictions || {});
    if (keys.length === 0) return;

    var pending = keys.some(function (k) {
        return ehime_predictions[k] && ehime_predictions[k].status === 'pending';
    });
    if (pending) return;

    var anySuccess = keys.some(function (k) {
        return ehime_predictions[k] && ehime_predictions[k].status === 'ok';
    });

    if (anySuccess) {
        saveEhimeHistorySnapshot();
        renderEhimeHistoryPanel();
    }
    ehime_history_saved_for_run = true;
    $(document).trigger('ehime_run_complete');
}

$(function () { renderEhimeHistoryPanel(); });
$(document).on('click', '#ehime_history_prev_btn', function () {
    var index = getEhimeHistoryActiveIndex();
    if (index < 0) return;
    replayEhimeHistoryStep(index, 1);
});
$(document).on('click', '#ehime_history_next_btn', function () {
    var index = getEhimeHistoryActiveIndex();
    if (index < 0) return;
    replayEhimeHistoryStep(index, -1);
});
$(document).on('click', '.ehime-history-replay', function () {
    var idx = parseInt($(this).data('history-index'), 10);
    if (isNaN(idx)) return;
    replayEhimeHistory(idx, false);
});
$(document).on('click', '.ehime-history-pan', function () {
    var idx = parseInt($(this).data('history-index'), 10);
    if (isNaN(idx)) return;
    replayEhimeHistory(idx, true);
});
$(document).on('click', '.ehime-history-overlay', function () {
    var idx = parseInt($(this).data('history-index'), 10);
    if (isNaN(idx)) return;
    var list = loadEhimeHistoryCache();
    if (!list[idx]) return;
    toggleEhimeHistoryOverlay(getEhimeHistoryRecordId(list[idx], idx));
});
// Ehime panel DOM helper
function ensureEhimePanelVisible() {
    if ($('#prediction_type').val() === 'ehime') {
        $('#ehime_panel').show();
    }
}

function updateFallModeUI() {
    var fall = ($('#prediction_type').val() === 'fall');
    var disableIds = ['#ascent', '#burst', '#flight_profile'];
    disableIds.forEach(function (id) {
        var el = $(id);
        if (fall) {
            el.prop('disabled', true);
            el.css({ opacity: 0.5, cursor: 'not-allowed' });
        } else {
            el.prop('disabled', false);
            el.css({ opacity: 1, cursor: 'text' });
        }
    });
}

$(function () {
    $('#prediction_type').on('change', updateFallModeUI);
    updateFallModeUI();
});

// --- 南レク一括計算 (Nanreku Batch Simulation) ---
var batchNanrekuSitesData = [];
var currentBatchIndex = 0;

function runBatchSimulation() {
    if ($('#prediction_type').val() !== 'ehime') {
        $('#prediction_type').val('ehime').trigger('change');
    }

    $.getJSON("sites.json", function(sites) {
        batchNanrekuSitesData = [];
        currentBatchIndex = 0;

        $.each(sites, function(sitename, site) {
            // All sites from sites.json
            batchNanrekuSitesData.push({
                name: sitename,
                lat: site.latitude,
                lon: site.longitude,
                alt: site.altitude
            });
        });

        if (batchNanrekuSitesData.length === 0) {
            if (typeof showToast === 'function') showToast('打ち上げ場所が見つかりません。', 'warning');
            return;
        }

        if (typeof showToast === 'function') {
            showToast('一括計算を開始します (' + batchNanrekuSitesData.length + '件)', 'info', 2000);
        }
        runNextBatchSite();
    });
}

function runNextBatchSite() {
    if (currentBatchIndex >= batchNanrekuSitesData.length) {
        if (typeof showToast === 'function') showToast('南レク一括計算が完了しました！', 'info', 5000);
        batchNanrekuSitesData = []; // Reset batch state
        return;
    }

    var site = batchNanrekuSitesData[currentBatchIndex];
    
    // Set site in UI if present
    var $siteOpt = $('#site option[value="' + site.name + '"]');
    if ($siteOpt.length > 0) {
        $('#site').val(site.name);
    } else {
        $('#site').val('Other');
    }

    // Populate inputs
    $("#lat").val(site.lat);
    $("#lon").val(site.lon);
    $("#initial_alt").val(site.alt);
    if ($('#req_name').length) $("#req_name").val(site.name);
    
    // Clear existing map items visually before next run
    if (typeof clearMapItems === 'function') clearMapItems();
    
    // Trigger the prediction
    if (typeof runPrediction === 'function') {
        runPrediction();
    }
}

// Listen for completion of Ehime prediction to continue batch
$(document).on('ehime_run_complete', function() {
    if (batchNanrekuSitesData && batchNanrekuSitesData.length > 0 && currentBatchIndex < batchNanrekuSitesData.length) {
        currentBatchIndex++;
        // Short delay so UI can breathe and save process completes
        setTimeout(runNextBatchSite, 1000);
    }
});

function hideEhimePanel() {
    // Switch to collapsed state rather than full hide
    var panel = $('#ehime_panel');
    if (!panel.length) return;
    if (!panel.hasClass('ehime-collapsed')) {
        panel.addClass('ehime-collapsed');
        $('#ehime_panel_close').text('展開');
        $('#ehime_panel_toggle').text('»');
        $('#ehime_panel_toggle').show();
    }
}
$(document).on('click', '#ehime_panel_close', function () { hideEhimePanel(); });
// Toggle button inside panel when collapsed
$(document).on('click', '#ehime_panel_toggle', function () {
    var panel = $('#ehime_panel');
    if (panel.hasClass('ehime-collapsed')) {
        panel.removeClass('ehime-collapsed');
        $('#ehime_panel_close').text('折り畳む');
        $('#ehime_panel_toggle').text('«');
    } else {
        hideEhimePanel();
    }
});
// If user re-selects Ehime mode, ensure expanded
function expandEhimePanel() {
    var panel = $('#ehime_panel');
    panel.show();
    if (panel.hasClass('ehime-collapsed')) {
        panel.removeClass('ehime-collapsed');
        $('#ehime_panel_close').text('折り畳む');
        $('#ehime_panel_toggle').text('«');
    }
}

// 落下モード UI 制御: 参照しない入力を無効化・視覚的無効化
function updateFallModeUI() {
    var fall = ($('#prediction_type').val() === 'fall');
    var disableIds = ['#ascent', '#burst', '#flight_profile'];
    if (fall) {
        // 強制プロファイル
        $('#flight_profile').val('standard_profile');
        disableIds.forEach(function (id) { $(id).prop('disabled', true).addClass('fall-disabled'); });
        $('#burst-calc-show').hide();
        var cell = $('#initial_alt').closest('tr').find('td:first');
        if (!cell.data('orig')) { cell.data('orig', cell.text()); }
        if (cell.text().indexOf('落下開始高度') === -1) { cell.text(cell.data('orig') + ' (落下開始高度)'); }
    } else {
        disableIds.forEach(function (id) { $(id).prop('disabled', false).removeClass('fall-disabled'); });
        $('#burst-calc-show').show();
        var cell = $('#initial_alt').closest('tr').find('td:first');
        if (cell.data('orig')) { cell.text(cell.data('orig')); }
    }
}

// 初期呼び出し (DOM ready タイミングで pred.js などから呼ばれない場合対策)
$(function () { updateFallModeUI(); });
$(function () {
    toggleCustomApiInput();
    $(document).on('change', '#api_source', function () {
        toggleCustomApiInput();
    });
});

function buildEhimeVariantRow(idx, variant_id, entry, variant_index) {
    var base = ehime_current && ehime_current.base ? ehime_current.base : null;
    var diff_parts = [];
    if (base && entry && entry.settings) {
        if (entry.settings.ascent_rate !== base.ascent_rate) { diff_parts.push('A' + (entry.settings.ascent_rate > base.ascent_rate ? '+' : '-')); }
        if (entry.settings.descent_rate !== base.descent_rate) { diff_parts.push('D' + (entry.settings.descent_rate > base.descent_rate ? '+' : '-')); }
        if (entry.settings.burst_altitude !== base.burst_altitude) {
            var ratio = entry.settings.burst_altitude / base.burst_altitude;
            diff_parts.push('B' + (ratio > 1 ? '+' : '-'));
        }
    }
    if (entry.label === 'BASE') { diff_parts = ['-']; }
    var color = '#cccccc';
    if (typeof variant_index !== 'undefined' && ehime_variant_total > 0) {
        color = ConvertRGBtoHex(evaluate_cmap((variant_index + 1) / (ehime_variant_total + 1), 'turbo'));
    }
    var statusClass = 'ehime-status-' + entry.status;
    var lat = '-', lon = '-', ascent = '-', descent = '-', burst = '-', flight = '-';
    var landsea = '-';
    if (entry.results && entry.results.landing) {
        lat = entry.results.landing.latlng.lat.toFixed(4);
        lon = entry.results.landing.latlng.lng.toFixed(4);
        try {
            var ll = entry.results.landing.latlng;
            var flag = (typeof LandSea !== 'undefined') ? LandSea.isLand(ll.lat, ll.lng) : null;
            if (flag === null) { landsea = '判定中'; }
            else landsea = flag ? '陸' : '海';
            entry.landsea = landsea;
        } catch (e) { landsea = '?'; }
    }
    if (entry.settings) {
        if (entry.settings.ascent_rate != null) ascent = entry.settings.ascent_rate.toFixed(2);
        if (entry.settings.descent_rate != null) descent = entry.settings.descent_rate.toFixed(2);
        if (entry.settings.burst_altitude != null) burst = entry.settings.burst_altitude.toFixed(0);
    }
    if (entry.results && entry.results.launch && entry.results.landing) {
        var dur = (entry.results.landing.datetime.unix() - entry.results.launch.datetime.unix()) / 60.0;
        if (!isNaN(dur)) flight = dur.toFixed(0);
    }
    var trClass = (entry.label === 'BASE') ? 'ehime-row-base' : '';
    var seaCellClass = statusClass + (landsea === '海' ? ' ehime-landsea-sea' : '');
    return '<tr data-vid="' + variant_id + '" class="' + trClass + '">'
        + '<td>' + (idx + 1) + '</td>'
        + '<td><span class="ehime-color-swatch" style="background:' + color + '"></span></td>'
        + '<td>' + entry.label + '</td>'
        + '<td>' + diff_parts.join(' ') + '</td>'
        + '<td>' + lat + '</td>'
        + '<td>' + lon + '</td>'
        + '<td>' + ascent + '</td>'
        + '<td>' + descent + '</td>'
        + '<td>' + burst + '</td>'
        + '<td>' + flight + '</td>'
        + '<td class="' + seaCellClass + '">' + landsea + '</td>'
        + '</tr>';
}

function refreshEhimePanel() {
    if ($('#prediction_type').val() !== 'ehime') return;
    ensureEhimePanelVisible();
    $('#ensemble_stats_panel').show();
    var tbody = [];
    var keys = Object.keys(ehime_predictions);
    keys.sort(function (a, b) {
        var ia = parseInt(a.split('_')[1]);
        var ib = parseInt(b.split('_')[1]);
        return ia - ib;
    });
    keys.forEach(function (k) {
        var entry = ehime_predictions[k];
        tbody.push(buildEhimeVariantRow(parseInt(k.split('_')[1]), k, entry, parseInt(k.split('_')[1])));
    });
    var tbodyHtml = tbody.join('');
    $('#ehime_variants_table tbody').html(tbodyHtml);
    $('#ehime_results_body').html(tbodyHtml);
    // Summary
    var completed = Object.values(ehime_predictions).filter(p => p.status === 'ok');
    $('#ehime_panel_completed').text(completed.length);
    $('#ehime_panel_total').text(ehime_variant_total);
    $('#ensemble_completed').text(completed.length);
    $('#ensemble_total').text(ehime_variant_total);

    var landCount = 0;
    var waterCount = 0;

    if (completed.length > 0) {
        var sumLat = 0, sumLon = 0;
        completed.forEach(p => {
            sumLat += p.results.landing.latlng.lat;
            sumLon += p.results.landing.latlng.lng;
            // 陸海判定
            if (typeof LandSea !== 'undefined') {
                if (LandSea.isLand(p.results.landing.latlng.lat, p.results.landing.latlng.lng)) {
                    landCount++;
                } else {
                    waterCount++;
                }
            }
        });
        var meanLat = (sumLat / completed.length).toFixed(4);
        var meanLon = (sumLon / completed.length).toFixed(4);
        $('#ehime_panel_mean').text(meanLat + ", " + meanLon);
        // max dev already computed in updateEhimeSummaryFromStore; reuse element text
        $('#ehime_panel_maxdev').text($('#ehime_max_dev').text());
        $('#ensemble_mean_pos').text(meanLat + ", " + meanLon);
        $('#ensemble_max_dev').text($('#ehime_max_dev').text());

        var totalDet = landCount + waterCount;
        if (totalDet > 0) {
            $('#ensemble_land_pct').text(Math.round((landCount / totalDet) * 100) + '%');
            $('#ensemble_sea_pct').text(Math.round((waterCount / totalDet) * 100) + '%');
        } else {
            $('#ensemble_land_pct').text('-');
            $('#ensemble_sea_pct').text('-');
        }
    } else {
        $('#ehime_panel_mean').text('-');
        $('#ehime_panel_maxdev').text('-');
        $('#ensemble_mean_pos').text('-');
        $('#ensemble_max_dev').text('-');
        $('#ensemble_land_pct').text('-');
        $('#ensemble_sea_pct').text('-');
    }
    // Build mobile card list
    var mobileWrap = document.getElementById('ehime_variants_mobile');
    if (mobileWrap) {
        var isMobileCards = window.matchMedia && matchMedia('(max-width:600px)').matches;
        if (isMobileCards) {
            var cards = [];
            keys.forEach(function (k) {
                var entry = ehime_predictions[k];
                var idx = parseInt(k.split('_')[1]);
                var color = '#ccc';
                if (ehime_variant_total > 0) {
                    color = ConvertRGBtoHex(evaluate_cmap((idx + 1) / (ehime_variant_total + 1), 'turbo'));
                }
                var baseClass = entry.label === 'BASE' ? ' base' : ' ';
                var statusClass = ' ' + (entry.status === 'pending' ? 'pending' : (entry.status === 'error' ? 'error' : 'ok'));
                var lat = '-', lon = '-', landsea = '-';
                var flight = '-', ascent = '-', descent = '-', burst = '-';
                if (entry.results && entry.results.landing) {
                    lat = entry.results.landing.latlng.lat.toFixed(4);
                    lon = entry.results.landing.latlng.lng.toFixed(4);
                }
                if (entry.landsea) { landsea = entry.landsea; }
                if (entry.settings) {
                    if (entry.settings.ascent_rate != null) ascent = entry.settings.ascent_rate.toFixed(2);
                    if (entry.settings.descent_rate != null) descent = entry.settings.descent_rate.toFixed(2);
                    if (entry.settings.burst_altitude != null) burst = entry.settings.burst_altitude.toFixed(0);
                }
                if (entry.results && entry.results.launch && entry.results.landing) {
                    var dur = (entry.results.landing.datetime.unix() - entry.results.launch.datetime.unix()) / 60.0;
                    if (!isNaN(dur)) flight = dur.toFixed(0);
                }
                // Diff markers
                var diff = [];
                if (ehime_current && ehime_current.base) {
                    var base = ehime_current.base;
                    if (entry.settings) {
                        if (entry.settings.ascent_rate !== base.ascent_rate) diff.push('A' + (entry.settings.ascent_rate > base.ascent_rate ? '+' : '-'));
                        if (entry.settings.descent_rate !== base.descent_rate) diff.push('D' + (entry.settings.descent_rate > base.descent_rate ? '+' : '-'));
                        if (entry.settings.burst_altitude !== base.burst_altitude) {
                            var ratio = entry.settings.burst_altitude / base.burst_altitude; diff.push('B' + (ratio > 1 ? '+' : '-'));
                        }
                    }
                }
                if (entry.label === 'BASE') { diff = ['-']; }
                var landseaClass = landsea === '海' ? ' landsea-sea' : '';
                var html = '<div class="ehime-card' + baseClass + statusClass + '" data-vid="' + k + '">'
                    + '<div><span class="swatch" style="background:' + color + '"></span><span class="label">' + entry.label + '</span> <span style="font-size:10px;">[' + diff.join(' ') + ']</span></div>'
                    + '<div class="meta">'
                    + '<span>上昇:' + ascent + '</span>'
                    + '<span>下降:' + descent + '</span>'
                    + '<span>破裂:' + burst + '</span>'
                    + '<span>飛行:' + flight + 'm</span>'
                    + '<span>着地:' + lat + ',' + lon + '</span>'
                    + '<span class="' + landseaClass + '">' + landsea + '</span>'
                    + '</div>'
                    + '</div>';
                cards.push(html);
            });
            mobileWrap.innerHTML = cards.join('');
            // Click: pan to marker
            mobileWrap.querySelectorAll('.ehime-card').forEach(function (card) {
                card.addEventListener('click', function () {
                    var vid = this.getAttribute('data-vid');
                    if (ehime_predictions[vid] && ehime_predictions[vid].marker) {
                        var m = ehime_predictions[vid].marker;
                        map.setView(m.getLatLng(), Math.max(map.getZoom(), 9));
                        if (m.openPopup) m.openPopup();
                    }
                });
            });
        }
    }
}

// Row click: pan/zoom to marker & open popup
$(document).on('click', '#ehime_variants_table tbody tr, #ehime_results_body tr', function () {
    var vid = $(this).data('vid');
    var vIndex = $(this).data('variant-index');
    var historyRowIndex = parseInt($(this).data('history-row-index'), 10);

    if (!vid && !isNaN(parseInt(vIndex, 10))) {
        vid = 'ehime_' + parseInt(vIndex, 10);
    }

    if (currentEhimeReplayHistoryId && !isNaN(historyRowIndex)) {
        var historyMarker = getEhimeHistoryMarkerForRow(currentEhimeReplayHistoryId, historyRowIndex);
        if (historyMarker && map) {
            map.setView(historyMarker.getLatLng(), Math.max(map.getZoom(), 9));
            if (historyMarker.openPopup) historyMarker.openPopup();
            return;
        }
    }

    if (vid && ehime_predictions[vid] && ehime_predictions[vid].marker) {
        var m = ehime_predictions[vid].marker;
        map.setView(m.getLatLng(), Math.max(map.getZoom(), 9));
        if (m.openPopup) m.openPopup();
        return;
    }

    var idx = parseInt(vIndex, 10);
    if (!isNaN(idx) && typeof _launchWindowVariantMarkers !== 'undefined' && _launchWindowVariantMarkers[idx]) {
        var lwm = _launchWindowVariantMarkers[idx];
        map.setView(lwm.getLatLng(), Math.max(map.getZoom(), 9));
        if (lwm.openPopup) lwm.openPopup();
        return;
    }

    var historyLat = parseFloat($(this).data('history-lat'));
    var historyLng = parseFloat($(this).data('history-lng'));
    if (!isNaN(historyLat) && !isNaN(historyLng) && map && typeof map.setView === 'function') {
        map.setView([historyLat, historyLng], Math.max(map.getZoom(), 9));
    }
});

// Generate CSV for Ehime variant landing points (called on demand)
function buildEhimeLandingCSV() {
    if (typeof ehime_predictions === 'undefined') return '';
    var completed = Object.values(ehime_predictions).filter(p => p.status === 'ok' && p.results && p.results.landing);
    if (completed.length === 0) return '';
    var header = [
        'label', 'landing_lat', 'landing_lon', 'ascent_rate', 'descent_rate', 'burst_altitude', 'launch_time_JST', 'landing_time_JST', 'flight_time_min'
    ];
    var rows = [header.join(',')];
    completed.forEach(function (p) {
        var lat = p.results.landing.latlng.lat;
        var lon = p.results.landing.latlng.lng;
        var ascent = (p.settings && p.settings.ascent_rate != null) ? p.settings.ascent_rate : '';
        var descent = (p.settings && p.settings.descent_rate != null) ? p.settings.descent_rate : '';
        var burst = (p.settings && p.settings.burst_altitude != null) ? p.settings.burst_altitude : '';
        var launchTime = p.results.launch && p.results.launch.datetime ? p.results.launch.datetime.clone().utcOffset(9 * 60).format('YYYY-MM-DD HH:mm') : '';
        var landingTime = p.results.landing && p.results.landing.datetime ? p.results.landing.datetime.clone().utcOffset(9 * 60).format('YYYY-MM-DD HH:mm') : '';
        var flightMinutes = '';
        if (p.results.launch && p.results.landing && p.results.launch.datetime && p.results.landing.datetime) {
            flightMinutes = (p.results.landing.datetime.diff(p.results.launch.datetime, 'minutes')).toFixed(0);
        }
        var cols = [p.label, lat.toFixed(5), lon.toFixed(5), ascent, descent, burst, launchTime, landingTime, flightMinutes];
        // Escape any commas (shouldn't be present) & quote if needed
        cols = cols.map(function (c) {
            if (typeof c === 'string' && c.indexOf(',') !== -1) { return '"' + c.replace(/"/g, '""') + '"'; }
            return c;
        });
        rows.push(cols.join(','));
    });
    return rows.join('\n');
}

function updateEhimeCSVLink() {
    var link = $('#ehime_dlcsv');
    if (link.length === 0) return; // Not present
    // Only show if prediction_type is ehime
    if ($('#prediction_type').val() !== 'ehime') { link.hide(); return; }
    var hasData = Object.values(ehime_predictions).some(p => p.status === 'ok');
    if (hasData) {
        link.show();
    } else {
        link.hide();
    }
}

// Click handler to trigger CSV build & download (use the clicked link for user-gesture reliability)
$(document).on('click', '#ehime_dlcsv', function (e) {
    var csv = buildEhimeLandingCSV();
    if (!csv) {
        e.preventDefault();
        alert('まだ着地点データがありません。予測完了後に再度お試しください。');
        return;
    }
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    // Build filename (例: Ehime_着地点一覧_20250907_1530JST_34.123N_132.456E.csv)
    var baseEntry = null;
    try { baseEntry = Object.values(ehime_predictions).find(p => p.label === 'BASE' && p.results && p.results.launch && p.results.launch.datetime); } catch (_e) { }
    var launchMoment = baseEntry ? baseEntry.results.launch.datetime.clone() : moment();
    launchMoment.utcOffset(9 * 60);
    var ts = launchMoment.format('YYYYMMDD_HHmm');
    var latlonPart = '';
    try {
        if (baseEntry && baseEntry.results.launch && baseEntry.results.launch.latlng) {
            var ll = baseEntry.results.launch.latlng;
            var latAbs = Math.abs(ll.lat).toFixed(3);
            var lonAbs = Math.abs(ll.lng).toFixed(3);
            var latHem = ll.lat >= 0 ? 'N' : 'S';
            var lonHem = ll.lng >= 0 ? 'E' : 'W';
            latlonPart = '_' + latAbs + latHem + '_' + lonAbs + lonHem;
        }
    } catch (_e) { }
    var ascPart = '', descPart = '';
    try {
        if (baseEntry && baseEntry.settings) {
            var ascVal = Number(baseEntry.settings.ascent_rate);
            var descVal = Number(baseEntry.settings.descent_rate);
            if (!isNaN(ascVal)) ascPart = '_ASC' + ascVal.toFixed(2);
            if (!isNaN(descVal)) descPart = '_DES' + descVal.toFixed(2);
        }
    } catch (_e) { }
    var filename = 'Ehime_着地点一覧_' + ts + 'JST' + ascPart + descPart + latlonPart + '.csv';
    // Set attributes on the actual clicked link and allow default navigation
    try {
        this.href = url;
        this.setAttribute('download', filename);
        // Cleanup later to avoid revoking before the browser starts the download
        var linkEl = this;
        setTimeout(function () {
            try { URL.revokeObjectURL(url); } catch (_e) { }
            // Remove attributes to keep DOM clean and avoid stale href on next click
            try { linkEl.removeAttribute('href'); linkEl.removeAttribute('download'); } catch (__e) { }
        }, 10000);
    } catch (err) {
        // Fallback: prevent default and open a temporary link
        e.preventDefault();
        var a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 10000);
    }
});

function tawhiriRequest(settings, extra_settings) {
    // Request a prediction via the Tawhiri API.
    // Settings must be as per the API docs above.

    if (settings.pred_type == 'single') {
        hourly_mode = false;
        $.get(tawhiri_api, settings)
            .done(function (data) {
                processTawhiriResults(data, settings);
            })
            .fail(function (data) {
                var prediction_error = "Prediction failed. Tawhiri may be under heavy load, please try again. ";
                if (data.hasOwnProperty("responseJSON")) {
                    prediction_error += data.responseJSON.error.description;
                }

                throwError(prediction_error);
            })
            .always(function (data) {
                //throwError("test.");
                //console.log(data);
            });
    } else if (settings.pred_type == 'fall') {
        // シングルだが後処理で下降部分のみ抽出
        hourly_mode = false;
        $.get(tawhiri_api, settings)
            .done(function (data) {
                processTawhiriResults(data, settings, true); // fall flag
            })
            .fail(function (data) {
                var prediction_error = '落下モード予測失敗。再試行してください。';
                if (data.hasOwnProperty('responseJSON')) {
                    prediction_error += data.responseJSON.error.description;
                }
                throwError(prediction_error);
            });
    } else if (settings.pred_type == 'ehime') {
        // Custom multi-variant prediction set for Ehime mode
        if (settings.profile != 'standard_profile') {
            throwError('愛媛モードは標準フライトプロファイルのみ対応');
            return;
        }
        runEhimePredictions(settings, extra_settings);
    } else {
        // For Multiple predictions, we do things a bit differently.
        hourly_mode = true;
        // First up clear off anything on the map.
        clearMapItems();

        // Also clean up any hourly prediction data.
        hourly_predictions = {};

        var current_hour = 0;
        var time_step = 24;

        if (settings.pred_type == 'daily') {
            time_step = 24;
        } else if (settings.pred_type == '1_hour') {
            time_step = 1;
        } else if (settings.pred_type == '3_hour') {
            time_step = 3;
        } else if (settings.pred_type == '6_hour') {
            time_step = 6;
        } else if (settings.pred_type == '12_hour') {
            time_step = 12;
        } else {
            throwError("Invalid time step.");
            return;
        }

        if (settings.profile != "standard_profile") {
            throwError("Hourly/Daily predictions are only available for the standard flight profile.");
            return;
        }

        // Loop to advance time until end of prediction window
        while (current_hour < MAX_PRED_HOURS) {
            // Update launch time
            var current_moment = moment(extra_settings.launch_moment).add(current_hour, 'hours');

            // Setup entries in the hourly prediction data store.
            hourly_predictions[current_hour] = {};
            hourly_predictions[current_hour]['layers'] = {};
            hourly_predictions[current_hour]['settings'] = { ...settings };
            hourly_predictions[current_hour]['settings']['launch_datetime'] = current_moment.format();

            // Copy our current settings for passing into the requst.
            var current_settings = { ...hourly_predictions[current_hour]['settings'] };

            $.get({
                url: tawhiri_api,
                data: current_settings,
                current_hour: current_hour
            })
                .done(function (data) {
                    processHourlyTawhiriResults(data, current_settings, this.current_hour);
                })
                .fail(function (data) {
                    var prediction_error = "Prediction failed. Tawhiri may be under heavy load, please try again. ";
                    if (data.hasOwnProperty("responseJSON")) {
                        prediction_error += data.responseJSON.error.description;
                    }

                    // Silently handle failed predictions, which are most likely
                    // because the prediction time was too far into the future.
                    delete hourly_predictions[this.current_hour]
                    //throwError(prediction_error);
                })
                .always(function (data) {
                    //throwError("test.");
                    //console.log(data);
                });

            current_hour += time_step;

        }

        // Generate prediction number and information to pass onwards to plotting
        // Run async get call, pass in prediction details.

        // Need new processing functions to plot just the landing spot, and then somehow a line between them?


    }
}

// Generate and run multiple variant predictions for Ehime mode
function runEhimePredictions(base_settings, extra_settings) {
    // Clear previous map items & state
    clearMapItems();
    ehime_predictions = {};
    ehime_history_saved_for_run = false;
    ehime_current = { base: base_settings };

    var asc_base = base_settings.ascent_rate;
    var desc_base = base_settings.descent_rate;
    var burst_base = base_settings.burst_altitude; // only standard_profile
    // Calculate variant values
    var asc_min = asc_base - 1.0;
    var asc_max = asc_base + 1.0;
    var desc_min = desc_base - 3.0;
    var desc_max = desc_base + 3.0;
    var burst_low = burst_base * 0.8;
    var burst_high = burst_base * 1.10;

    // Build variant list (13 variants: base + singles + paired extremes)
    var variants = [];
    function addVariant(a, d, b, label) {
        variants.push({ ascent_rate: a, descent_rate: d, burst_altitude: b, label: label });
    }
    addVariant(asc_base, desc_base, burst_base, 'BASE');
    addVariant(asc_min, desc_base, burst_base, 'ASC-');
    addVariant(asc_max, desc_base, burst_base, 'ASC+');
    addVariant(asc_base, desc_min, burst_base, 'DES-');
    addVariant(asc_base, desc_max, burst_base, 'DES+');
    addVariant(asc_base, desc_base, burst_low, 'BURST-');
    addVariant(asc_base, desc_base, burst_high, 'BURST+');
    addVariant(asc_min, desc_min, burst_base, 'A-D-');
    addVariant(asc_max, desc_max, burst_base, 'A+D+');
    addVariant(asc_min, desc_base, burst_low, 'A-B-');
    addVariant(asc_max, desc_base, burst_high, 'A+B+');
    addVariant(asc_base, desc_min, burst_low, 'D-B-');
    addVariant(asc_base, desc_max, burst_high, 'D+B+');

    ehime_variant_total = variants.length;
    $('#ehime_total').text(ehime_variant_total);
    $('#ehime_completed').text(0);
    $('#ehime_mean').text('-');
    $('#ehime_max_dev').text('-');

    // Launch all requests
    variants.forEach(function (v, idx) {
        var v_settings = { ...base_settings };
        v_settings.ascent_rate = v.ascent_rate;
        v_settings.descent_rate = v.descent_rate;
        v_settings.burst_altitude = v.burst_altitude;
        // Unique label for marker & internal key
        var variant_id = 'ehime_' + idx;
        ehime_predictions[variant_id] = { settings: v_settings, status: 'pending', label: v.label };
        $.get(tawhiri_api, v_settings)
            .done(function (data) {
                processEhimeResult(data, v_settings, variant_id, idx);
            })
            .fail(function (data) {
                ehime_predictions[variant_id].status = 'error';
                // Continue; do not throw global error.
                updateEhimeSummaryFromStore();
                finalizeEhimeRunIfCompleted();
            });
    });
    updateEhimeCSVLink(); // ensure link hidden until data arrives
    expandEhimePanel();
    refreshEhimePanel();
}

function run13VariantEnsemble(base_settings, api_url) {
    if (!base_settings) return;

    var settings = Object.assign({}, base_settings);
    settings.pred_type = 'ehime';

    var previousApi = tawhiri_api;
    if (api_url) {
        tawhiri_api = api_url;
    }

    try {
        if ($('#prediction_type').val() !== 'ehime') {
            $('#prediction_type').val('ehime').trigger('change');
        }
        runEhimePredictions(settings, {});
    } finally {
        tawhiri_api = previousApi;
    }
}

function processEhimeResult(data, settings, variant_id, variant_index) {
    if (data.hasOwnProperty('error')) {
        ehime_predictions[variant_id].status = 'error';
        updateEhimeSummaryFromStore();
        return;
    }
    var prediction_results = parsePrediction(data.prediction);
    ehime_predictions[variant_id].status = 'ok';
    ehime_predictions[variant_id].results = prediction_results;

    // Plot base path for BASE only once
    if (ehime_predictions[variant_id].label === 'BASE') {
        // Pass settings so popups can show conditions
        plotStandardPrediction(prediction_results, settings);
        try {
            if (typeof updateAltitudeChart === 'function') {
                updateAltitudeChart(data.prediction);
            }
            if (typeof updateWindChart === 'function') {
                updateWindChart(data.prediction);
            }
            updatePredictionDerivedMetrics(data.prediction);
        } catch (_e0) { }
        // Set standard CSV/KML links to BASE flight path (same as single mode)
        try {
            var _base_url = tawhiri_api + "?" + $.param(settings);
            var _csv_url = _base_url + "&format=csv";
            var _kml_url = _base_url + "&format=kml";
            $("#dlcsv").attr("href", _csv_url).removeAttr('download');
            $("#dlkml").attr("href", _kml_url).removeAttr('download');
        } catch (_e) { }
        // Update run time/model if available
        try {
            if (data && data.metadata && data.request) {
                var run_time = moment.utc(data.metadata.complete_datetime).clone().utcOffset(9 * 60).format('YYYY-MM-DD HH:mm');
                var dataset = moment.utc(data.request.dataset).format("YYYYMMDD-HH");
                $("#run_time").html(run_time);
                $("#dataset").html(dataset);
            }
        } catch (__e) { }
    }

    // Plot landing marker for each variant
    plotEhimeLandingMarker(variant_id, variant_index);
    updateEhimeSummaryFromStore();
    updateEhimeCSVLink();
    refreshEhimePanel();
    refreshEhimePanel();
    // After BASE result arrives, refresh popups so non-BASE markers can show BASE coordinates
    try {
        if (ehime_predictions[variant_id] && ehime_predictions[variant_id].label === 'BASE' && typeof updateAllPopups === 'function') {
            updateAllPopups();
        }
    } catch (_e) { }
    finalizeEhimeRunIfCompleted();
}

function plotEhimeLandingMarker(variant_id, variant_index) {
    var entry = ehime_predictions[variant_id];
    if (!entry.results) return;
    var landing = entry.results.landing;
    var launch = entry.results.launch;
    var color = ConvertRGBtoHex(evaluate_cmap((variant_index + 1) / (ehime_variant_total + 1), 'turbo'));
    var marker = new L.CircleMarker(landing.latlng, {
        radius: (entry.label === 'BASE') ? 6 : 4,
        fillOpacity: 1.0,
        zIndexOffset: 1200,
        fillColor: color,
        stroke: true,
        weight: 1,
        color: '#000000'
    }).addTo(map);
    // Build condition difference description vs BASE
    var base = ehime_current && ehime_current.base ? ehime_current.base : null;
    var diff_desc = [];
    if (base) {
        if (entry.settings.ascent_rate !== base.ascent_rate) {
            diff_desc.push('上昇' + (entry.settings.ascent_rate > base.ascent_rate ? '+' : '-') + '1 m/s');
        }
        if (entry.settings.descent_rate !== base.descent_rate) {
            diff_desc.push('下降' + (entry.settings.descent_rate > base.descent_rate ? '+' : '-') + '3 m/s');
        }
        if (entry.settings.burst_altitude !== base.burst_altitude) {
            var ratio = entry.settings.burst_altitude / base.burst_altitude;
            if (ratio > 1) { diff_desc.push('破裂+10%'); } else { diff_desc.push('破裂-20%'); }
        }
    }
    var desc_line = diff_desc.length ? ('変更: ' + diff_desc.join(', ')) : '変更: なし (基準)';
    // Show BASE landing for non-BASE entries. If BASE not ready yet, show placeholder '-'.
    var base_line = '';
    if (entry.label !== 'BASE') {
        var baseLL = null;
        try {
            for (var k in ehime_predictions) {
                var ep = ehime_predictions[k];
                if (ep && ep.label === 'BASE' && ep.results && ep.results.landing) { baseLL = ep.results.landing.latlng; break; }
            }
        } catch (_e) { }
        if (baseLL) {
            base_line = 'BASE着地点: ' + (typeof formatCoord === 'function' ? (formatCoord(baseLL.lat, 'lat') + ', ' + formatCoord(baseLL.lng, 'lon')) : (baseLL.lat.toFixed(4) + ', ' + baseLL.lng.toFixed(4))) + '<br/>';
        } else {
            base_line = 'BASE着地点: -<br/>';
        }
    }
    var popup_html = entry.label + '<br/>' +
        desc_line + '<br/>' +
        '着地点<br/>' +
        '緯度経度: ' + (landing.latlng.lat.toFixed(4) + ', ' + landing.latlng.lng.toFixed(4)) + '<br/>' +
        '上昇/下降: ' + (entry.settings.ascent_rate.toFixed ? entry.settings.ascent_rate.toFixed(1) : entry.settings.ascent_rate) + ' / ' + (entry.settings.descent_rate.toFixed ? entry.settings.descent_rate.toFixed(1) : entry.settings.descent_rate) + ' m/s<br/>' +
        '破裂高度: ' + (entry.settings.burst_altitude.toFixed ? entry.settings.burst_altitude.toFixed(0) : entry.settings.burst_altitude) + ' m<br/>' +
        '着地時刻: ' + (landing && landing.datetime ? landing.datetime.clone().utcOffset(9 * 60).format('YYYY-MM-DD HH:mm') + ' JST' : '不明') + '<br/>';
    marker.bindPopup(popup_html);
    ehime_predictions[variant_id].marker = marker;

    // 表示制御ポリシー調整 (要件):
    //  - 毎時タイプ (hourly) と同様にクリックで経路表示/非表示をトグル
    //  - ダブルクリックでは「ポップアップは残し、飛行経路のみ消去」
    //  - BASE バリアントは既存挙動を保持 (変更禁止)
    if (entry.label === 'BASE') {
        marker.on('click', function () { toggleEhimeVariantPath(variant_id); });
        // Add BASE-specific popup buttons: 再表示 (復元) と 重ね表示
        var btns = document.createElement('div');
        btns.style.marginTop = '6px';
        var restoreBtn = document.createElement('button');
        restoreBtn.className = 'btn-preset'; restoreBtn.textContent = '愛媛用を再表示';
        restoreBtn.style.marginRight = '6px';
        restoreBtn.addEventListener('click', function () {
            var snap = buildEhimeHistorySnapshot();
            if (!snap) { if (typeof showToast === 'function') showToast('履歴がありません', 'warning'); return; }
            restoreEhimeHistoryAsCurrentRun(snap);
        });
        var overlayBtn = document.createElement('button');
        overlayBtn.className = 'btn-preset'; overlayBtn.textContent = '重ね表示';
        overlayBtn.addEventListener('click', function () {
            var snap = buildEhimeHistorySnapshot();
            if (!snap) { if (typeof showToast === 'function') showToast('履歴がありません', 'warning'); return; }
            var hid = getEhimeHistoryRecordId(snap);
            showEhimeHistoryLayer(snap, hid);
            renderEhimeHistoryPanel();
            if (typeof showToast === 'function') showToast('重ね表示しました', 'info');
        });
        btns.appendChild(restoreBtn); btns.appendChild(overlayBtn);
        marker.on('popupopen', function () {
            var p = marker.getPopup().getContentNode ? marker.getPopup().getContentNode() : null;
            if (p) { p.appendChild(btns); }
        });
    } else {
        attachEhimeVariantClickHandlers(marker, variant_id);
    }
}

// 愛媛モード: バリアント飛行経路の表示/非表示トグル
function toggleEhimeVariantPath(variant_id) {
    var entry = ehime_predictions[variant_id];
    if (!entry || entry.status !== 'ok' || !entry.results) return;

    // BASE バリアントは最初に標準描画済みなので未登録なら既存グローバルを紐付け
    if (entry.label === 'BASE' && (!entry.layers || !entry.layers.flight_path)) {
        entry.layers = entry.layers || {};
        if (map_items['path_polyline']) entry.layers.flight_path = map_items['path_polyline'];
        if (map_items['launch_marker']) entry.layers.launch_marker = map_items['launch_marker'];
        if (map_items['pop_marker']) entry.layers.burst_marker = map_items['pop_marker'];
    }

    // 既に表示中 -> 削除
    if (entry.layers && entry.layers.flight_path) {
        if (entry.layers.flight_path.remove) entry.layers.flight_path.remove();
        if (entry.layers.launch_marker && entry.layers.launch_marker.remove) entry.layers.launch_marker.remove();
        if (entry.layers.burst_marker && entry.layers.burst_marker.remove) entry.layers.burst_marker.remove();
        delete entry.layers.flight_path;
        delete entry.layers.launch_marker;
        delete entry.layers.burst_marker;
        return;
    }

    // 新規表示
    entry.layers = entry.layers || {};
    var res = entry.results;
    // アイコンは単一予測と同じ
    var launch_icon = L.icon({ iconUrl: launch_img, iconSize: [10, 10], iconAnchor: [5, 5] });
    var burst_icon = L.icon({ iconUrl: burst_img, iconSize: [16, 16], iconAnchor: [8, 8] });
    // 発射マーカー
    var launch_marker = L.marker(res.launch.latlng, {
        title: '離陸地点 (' + res.launch.latlng.lat.toFixed(4) + ', ' + res.launch.latlng.lng.toFixed(4) + ')',
        icon: launch_icon
    }).addTo(map);
    // 破裂マーカー
    var burst_marker = L.marker(res.burst.latlng, {
        title: 'バースト (' + res.burst.latlng.lat.toFixed(4) + ', ' + res.burst.latlng.lng.toFixed(4) + ' 高度 ' + res.burst.latlng.alt.toFixed(0) + ')',
        icon: burst_icon
    }).addTo(map);
    // 経路ポリライン（黒、標準と同じスタイル）
    var path_polyline = L.polyline(res.flight_path, { weight: 3, color: '#000000' }).addTo(map);
    entry.layers.flight_path = path_polyline;
    entry.layers.launch_marker = launch_marker;
    entry.layers.burst_marker = burst_marker;
}

// Ehime 非BASEバリアント: シングルクリック=トグル, ダブルクリック=経路削除+ポップアップ維持
function attachEhimeVariantClickHandlers(marker, variant_id) {
    var clickTimer = null;
    var SINGLE_DELAY = 250; // ダブルクリック判定待ち (ms)

    marker.on('click', function (e) {
        // detail>1 (ブラウザが連続クリック回数提供) の場合はダブルクリックハンドラに任せる
        if (e.originalEvent && e.originalEvent.detail > 1) { return; }
        if (clickTimer) { clearTimeout(clickTimer); }
        clickTimer = setTimeout(function () {
            toggleEhimeVariantPath(variant_id);
            clickTimer = null;
        }, SINGLE_DELAY);
    });

    marker.on('dblclick', function (e) {
        if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
        var entry = ehime_predictions[variant_id];
        if (entry && entry.layers && entry.layers.flight_path) {
            try { if (entry.layers.flight_path.remove) entry.layers.flight_path.remove(); } catch (_e) { }
            try { if (entry.layers.launch_marker && entry.layers.launch_marker.remove) entry.layers.launch_marker.remove(); } catch (_e) { }
            try { if (entry.layers.burst_marker && entry.layers.burst_marker.remove) entry.layers.burst_marker.remove(); } catch (_e) { }
            delete entry.layers.flight_path;
            delete entry.layers.launch_marker;
            delete entry.layers.burst_marker;
        }
        // ポップアップを開いたままにする (未開なら開く)
        try { marker.openPopup(); } catch (_e) { }
        // 地図のデフォルトダブルクリックズームを抑制 (Leaflet doubleClickZoom オプション有効時)
        if (e.originalEvent && e.originalEvent.preventDefault) { e.originalEvent.preventDefault(); }
        L.DomEvent.stopPropagation(e);
    });
}

function updateEhimeSummaryFromStore() {
    var completed = Object.values(ehime_predictions).filter(p => p.status === 'ok');
    $('#ehime_completed').text(completed.length);
    if (completed.length === 0) { refreshEhimePanel(); updateEhimeCSVLink(); return; }
    var sumLat = 0, sumLon = 0; completed.forEach(p => { sumLat += p.results.landing.latlng.lat; sumLon += p.results.landing.latlng.lng; });
    var meanLat = sumLat / completed.length;
    var meanLon = sumLon / completed.length;
    $('#ehime_mean').text(meanLat.toFixed(4) + ', ' + meanLon.toFixed(4));
    var maxDev = 0; completed.forEach(p => { var d = distHaversine({ lat: meanLat, lng: meanLon }, { lat: p.results.landing.latlng.lat, lng: p.results.landing.latlng.lng }, 2); if (d > maxDev) maxDev = d; });
    $('#ehime_max_dev').text(parseFloat(maxDev).toFixed(2));
    
    // 陸地着率の更新
    var landCount = 0;
    var waterCount = 0;
    completed.forEach(function(p){
        if(p.results && p.results.landing && p.results.landing.latlng){
            var lat = p.results.landing.latlng.lat;
            var lng = p.results.landing.latlng.lng;
            if(typeof LandSea !== 'undefined'){
                if(LandSea.isLand(lat, lng)) landCount++;
                else waterCount++;
            }
        }
    });
    var totalDet = landCount + waterCount;
    if(totalDet > 0){
        $('#ensemble_land_pct').text(Math.round((landCount / totalDet) * 100) + '%');
        $('#ensemble_sea_pct').text(Math.round((waterCount / totalDet) * 100) + '%');
    }

    var landingPoints = completed.map(function (p) {
        return {
            lat: p.results && p.results.landing && p.results.landing.latlng ? p.results.landing.latlng.lat : null,
            lng: p.results && p.results.landing && p.results.landing.latlng ? p.results.landing.latlng.lng : null,
            label: p.label || ''
        };
    }).filter(function (point) {
        return isFinite(point.lat) && isFinite(point.lng);
    });

    if (landingPoints.length > 0 && typeof compute13VarStatistics === 'function') {
        compute13VarStatistics(landingPoints);
    }

    updateEhimeCSVLink();
    refreshEhimePanel();
}
function processTawhiriResults(data, settings, fall_only) {
    // Process results from a Tawhiri run.

    if (data.hasOwnProperty('error')) {
        // The prediction API has returned an error.
        throwError("Predictor returned error: " + data.error.description)
    } else {

        var prediction_results = parsePrediction(data.prediction);
        if (fall_only) {
            // 上昇区間を除去し、ユーザー指定開始高度へアルティチュードを平行移動
            try {
                var userStartAlt = settings.fall_user_start_alt;
                var descentPath = data.prediction[1].trajectory || [];
                if (descentPath.length > 0) {
                    var first = descentPath[0];
                    var _lonf = first.longitude; if (_lonf > 180) _lonf = _lonf - 360.0;
                    var altOffset = first.altitude - userStartAlt; // 減算で開始高度を合わせる
                    var fp = []; // ポリライン用 (lat,lon,alt)
                    var fp_time = []; // CSV 用 (lat,lon,alt,datetimeUTC)
                    descentPath.forEach(function (item) {
                        var _lat = item.latitude; var _lon = item.longitude; if (_lon > 180) _lon = _lon - 360.0;
                        var adjAlt = item.altitude - altOffset; if (adjAlt < 0) adjAlt = 0;
                        fp.push([_lat, _lon, adjAlt]);
                        // 各ポイント UTC 時刻を保持 (moment 形式)
                        fp_time.push({ lat: _lat, lon: _lon, alt: adjAlt, datetime: moment.utc(item.datetime) });
                    });
                    prediction_results.flight_path = fp;
                    prediction_results.flight_path_time = fp_time; // 追加: 時刻付き配列 (落下のみ CSV 用)
                    // launch 再構成 (開始高度=ユーザー指定)
                    prediction_results.launch = { latlng: L.latLng([first.latitude, _lonf, userStartAlt]), datetime: moment.utc(first.datetime) };
                    // burst は落下専用のダミー (開始点と同じ)
                    prediction_results.burst = prediction_results.launch;
                    // landing altitude もオフセット適用 (地表近似なので 0 に留める)
                    var landingLL = prediction_results.landing.latlng;
                    prediction_results.landing.latlng = L.latLng([landingLL.lat, landingLL.lng, Math.max(0, landingLL.alt - altOffset)]);
                    prediction_results.flight_time = prediction_results.landing.datetime.diff(prediction_results.launch.datetime, 'seconds');
                    prediction_results.profile = 'fall_only';
                }
            } catch (e) { appendDebug('落下モード変換失敗: ' + e); }
        }

        var extended_results = prediction_results;
        // If Ehime mode, apply burst-altitude margin stats (display only)
        if (settings.pred_type === 'ehime') {
            ehime_current = { base: settings, result: prediction_results };
            // Compute center (landing) and spec ring radii based on ascent/descent variance
            // For simplicity, treat ascent/descent variance as instantaneous speed bands and not re-simulate.
            // Record for UI summary after plotting.
        }
        if (fall_only) {
            plotFallOnlyPrediction(extended_results, settings);
        } else {
            plotStandardPrediction(extended_results, settings);
        }
        if (settings.pred_type === 'ehime') {
            updateEhimeSummary([extended_results]);
        }

        try {
            if (typeof updateAltitudeChart === 'function') {
                updateAltitudeChart(data.prediction);
            }
            if (typeof updateWindChart === 'function') {
                updateWindChart(data.prediction);
            }
            updatePredictionDerivedMetrics(data.prediction);
        } catch (_e) { }

        writePredictionInfo(settings, data.metadata, data.request, fall_only ? extended_results : null);

    }

    //console.log(data);

}

// Update Ehime mode statistical summary (currently single prediction placeholder)
function updateEhimeSummary(predictionArray) {
    // predictionArray: array of prediction result objects
    $('#ehime_total').text(predictionArray.length);
    $('#ehime_completed').text(predictionArray.length);
    // Compute mean landing lat/lon
    var sumLat = 0, sumLon = 0;
    predictionArray.forEach(p => { sumLat += p.landing.latlng.lat; sumLon += p.landing.latlng.lng; });
    var meanLat = sumLat / predictionArray.length;
    var meanLon = sumLon / predictionArray.length;
    $('#ehime_mean').text(meanLat.toFixed(4) + ', ' + meanLon.toFixed(4));
    // Max deviation distance from mean (km)
    var maxDev = 0;
    predictionArray.forEach(p => {
        var d = distHaversine({ lat: meanLat, lng: meanLon }, { lat: p.landing.latlng.lat, lng: p.landing.latlng.lng }, 2);
        if (d > maxDev) maxDev = d;
    });
    $('#ehime_max_dev').text(maxDev.toFixed(2));
}

function parsePrediction(prediction) {
    // Convert a prediction in the Tawhiri API format to a Polyline.

    var flight_path = [];
    var launch = {};
    var burst = {};
    var landing = {};

    var ascent = prediction[0].trajectory;
    var descent = prediction[1].trajectory;

    // Add the ascent track to the flight path array.
    ascent.forEach(function (item, index) {
        var _lat = item.latitude;
        // Correct for API giving us longitudes outside [-180, 180]
        var _lon = item.longitude;
        if (_lon > 180.0) {
            _lon = _lon - 360.0;
        }

        flight_path.push([_lat, _lon, item.altitude]);
    });

    // Add the Descent or Float track to the flight path array.
    descent.forEach(function (item, index) {
        var _lat = item.latitude;
        var _lon = item.longitude;
        // Correct for API giving us longitudes outside [-180, 180]
        if (_lon > 180.0) {
            _lon = _lon - 360.0;
        }

        flight_path.push([_lat, _lon, item.altitude]);
    });

    // Populate the launch, burst and landing points
    var launch_obj = ascent[0];
    var _lon = launch_obj.longitude;
    if (_lon > 180.0) {
        _lon = _lon - 360.0;
    }
    launch.latlng = L.latLng([launch_obj.latitude, _lon, launch_obj.altitude]);
    launch.datetime = moment.utc(launch_obj.datetime);

    var burst_obj = descent[0];
    var _lon = burst_obj.longitude;
    if (_lon > 180.0) {
        _lon = _lon - 360.0;
    }
    burst.latlng = L.latLng([burst_obj.latitude, _lon, burst_obj.altitude]);
    burst.datetime = moment.utc(burst_obj.datetime);

    var landing_obj = descent[descent.length - 1];
    var _lon = landing_obj.longitude;
    if (_lon > 180.0) {
        _lon = _lon - 360.0;
    }
    landing.latlng = L.latLng([landing_obj.latitude, _lon, landing_obj.altitude]);
    landing.datetime = moment.utc(landing_obj.datetime);

    var profile = null;
    if (prediction[1].stage == 'descent') {
        profile = 'standard_profile';
    } else {
        profile = 'float_profile';
    }

    var flight_time = landing.datetime.diff(launch.datetime, 'seconds');

    return { 'flight_path': flight_path, 'launch': launch, 'burst': burst, 'landing': landing, 'profile': profile, 'flight_time': flight_time };
}

function plotStandardPrediction(prediction, settings) {
    appendDebug("Flight data parsed, creating map plot...");
    // 単一タイプ描画時: 既存 Ehime バリアント表示を完全クリア (残存経路対策)
    // settings.pred_type が 'ehime' でない場合、Ehime 由来レイヤを除去
    if (settings && settings.pred_type !== 'ehime') {
        clearMapItems();
    } else {
        // Ehime BASE の再描画時は既存バリアントマーカーを残す
        // （BASE 経路だけ再生成したいケースを想定）
    }

    var launch = prediction.launch;
    var landing = prediction.landing;
    var burst = prediction.burst;

    // Calculate range and time of flight
    var range = distHaversine(launch.latlng, landing.latlng, 1);
    var flighttime = "";
    var f_hours = Math.floor(prediction.flight_time / 3600);
    var f_minutes = Math.floor(((prediction.flight_time % 86400) % 3600) / 60);
    if (f_minutes < 10) f_minutes = "0" + f_minutes;
    flighttime = f_hours + "hr" + f_minutes;
    $("#cursor_pred_range").html(range);
    $("#cursor_pred_time").html(flighttime);
    cursorPredShow();

    // Make some nice icons
    var launch_icon = L.icon({
        iconUrl: launch_img,
        iconSize: [10, 10],
        iconAnchor: [5, 5]
    });

    var land_icon = L.icon({
        iconUrl: land_img,
        iconSize: [10, 10],
        iconAnchor: [5, 5]
    });

    var burst_icon = L.icon({
        iconUrl: burst_img,
        iconSize: [16, 16],
        iconAnchor: [8, 8]
    });


    var launch_marker = L.marker(
        launch.latlng,
        {
            title: '離陸地点 (' + launch.latlng.lat.toFixed(4) + ', ' + launch.latlng.lng.toFixed(4) + ') 時刻 '
                + launch.datetime.clone().utcOffset(9 * 60).format("HH:mm") + " JST",
            icon: launch_icon
        }
    ).addTo(map);
    // Build condition popup (launch)
    var cond_html = '';
    if (settings) {
        if (settings.profile === 'standard_profile') {
            cond_html += '<b>上昇速度:</b> ' + settings.ascent_rate + ' m/s<br/>';
            cond_html += '<b>下降速度:</b> ' + settings.descent_rate + ' m/s<br/>';
            cond_html += '<b>破裂高度:</b> ' + settings.burst_altitude + ' m<br/>';
        } else {
            cond_html += '<b>上昇速度:</b> ' + settings.ascent_rate + ' m/s<br/>';
            cond_html += '<b>滞留高度:</b> ' + settings.float_altitude + ' m<br/>';
        }
    }
    var launch_popup = '<b>離陸地点</b><br/>' + cond_html +
        '<b>離陸時刻:</b> ' + launch.datetime.clone().utcOffset(9 * 60).format('YYYY-MM-DD HH:mm') + ' JST';
    launch_marker.bindPopup(launch_popup);

    var land_marker = L.marker(
        landing.latlng,
        {
            title: '予測着地点 (' + landing.latlng.lat.toFixed(4) + ', ' + landing.latlng.lng.toFixed(4) + ') 時刻 '
                + landing.datetime.clone().utcOffset(9 * 60).format("HH:mm") + " JST",
            icon: land_icon,
            zIndexOffset: 2000 // 履歴マーカーより前面に表示
        }
    ).addTo(map);
    var land_popup = '着地点<br/>' +
        '緯度経度: ' + (typeof formatCoord === 'function' ? formatCoord(landing.latlng.lat, 'lat') + ', ' + formatCoord(landing.latlng.lng, 'lon') : (landing.latlng.lat.toFixed(4) + ', ' + landing.latlng.lng.toFixed(4))) + '<br/>' +
        (settings && settings.profile === 'standard_profile' ? '上昇/下降: ' + settings.ascent_rate + ' / ' + settings.descent_rate + ' m/s<br/>' : '') +
        (settings && settings.profile === 'standard_profile' ? '破裂高度: ' + settings.burst_altitude + ' m<br/>' : (settings ? '滞留高度: ' + settings.float_altitude + ' m<br/>' : '')) +
        '着地時刻: ' + landing.datetime.clone().utcOffset(9 * 60).format('YYYY-MM-DD HH:mm') + ' JST';
    land_marker.bindPopup(land_popup);

    // 愛媛モードのBASEピンだった場合は再表示・重ね表示ボタンを追加（一時的に削除）
    // if (settings && settings.pred_type === 'ehime') { ... }

    var pop_marker = L.marker(
        burst.latlng,
        {
            title: 'バースト (' + burst.latlng.lat.toFixed(4) + ', ' + burst.latlng.lng.toFixed(4) +
                ' 高度 ' + burst.latlng.alt.toFixed(0) + ') 時刻 '
                + burst.datetime.clone().utcOffset(9 * 60).format("HH:mm") + " JST",
            icon: burst_icon
        }
    ).addTo(map);
    var burst_popup = '<b>破裂地点</b><br/>' +
        '緯度経度: ' + (typeof formatCoord === 'function' ? formatCoord(burst.latlng.lat, 'lat') + ', ' + formatCoord(burst.latlng.lng, 'lon') : (burst.latlng.lat.toFixed(4) + ', ' + burst.latlng.lng.toFixed(4))) + '<br/>' +
        '<b>破裂高度:</b> ' + burst.latlng.alt.toFixed(0) + ' m<br/>' +
        (settings && settings.profile === 'standard_profile' ? '<b>上昇/下降:</b> ' + settings.ascent_rate + ' / ' + settings.descent_rate + ' m/s<br/>' : '') +
        '<b>破裂時刻:</b> ' + burst.datetime.clone().utcOffset(9 * 60).format('YYYY-MM-DD HH:mm') + ' JST';
    pop_marker.bindPopup(burst_popup);

    var path_polyline = L.polyline(
        prediction.flight_path,
        {
            weight: 3,
            color: '#000000'
        }
    ).addTo(map);



    // Add the launch/land markers to map
    // We might need access to these later, so push them associatively
    map_items['launch_marker'] = launch_marker;
    map_items['land_marker'] = land_marker;
    map_items['pop_marker'] = pop_marker;
    map_items['path_polyline'] = path_polyline;

    // --- Persistent History Marker with Path ---
    var siteName_hist = $("#site option:selected").text();
    var launchTimeJST = typeof getJSTDateTimeFormatted === 'function' ? getJSTDateTimeFormatted(launch.datetime) : launch.datetime.clone().utcOffset(9 * 60).format('YYYY-MM-DD HH:mm');

    // Create a NEW polyline for history (independent of map_items)
    var history_path = L.polyline(
        prediction.flight_path,
        {
            weight: 3,
            color: '#000000',
            opacity: 0 // Hidden by default
        }
    ).addTo(map);

    var history_popup_content = '着地点<br/>' +
        '緯度経度: ' + (landing.latlng.lat.toFixed(4) + ', ' + landing.latlng.lng.toFixed(4)) + '<br/>' +
        (settings && settings.profile === 'standard_profile' ? '上昇/下降: ' + settings.ascent_rate + ' / ' + settings.descent_rate + ' m/s<br/>' : '') +
        (settings && settings.profile === 'standard_profile' ? '破裂高度: ' + settings.burst_altitude + ' m<br/>' : (settings ? '滞留高度: ' + settings.float_altitude + ' m<br/>' : '')) +
        '着地時刻: ' + landing.datetime.clone().utcOffset(9 * 60).format('YYYY-MM-DD HH:mm') + ' JST<br/>' +
        '<hr style="margin:5px 0"/>' +
        '打ち上げ場所: ' + siteName_hist + '<br/>' +
        '打ち上げ時刻 (JST): ' + launchTimeJST + '<br/>' +
        '<small>クリックで軌跡を表示</small>';

    var historyMarker = L.marker(landing.latlng, {
        icon: land_icon
    }).bindPopup(history_popup_content);

    // 愛媛モードの場合は履歴ピンにも再表示ボタン等を追加（一時的に削除）
    // if (settings && settings.pred_type === 'ehime') { ... }

    historyMarker.associatedPath = history_path;
    historyMarker.on('click', function () {
        if (typeof toggleHistoryPath === 'function') toggleHistoryPath(historyMarker);
    });
    historyMarker.addTo(map);
    if (typeof landing_history_markers !== 'undefined') {
        landing_history_markers.push(historyMarker);
    }
    // ---------------------------------

    // Pan to the new position
    map.setView(launch.latlng, 8)

    // Update List
    var rowId = null;
    if (typeof updatePosList === 'function') {
        rowId = updatePosList(launch, burst, landing);
        historyMarker.uniqueId = rowId; // Link them
    }

    // Land/Sea Check & Fishing ports
    if (typeof checkLandSea === 'function') {
        checkLandSea(landing.latlng.lat, landing.latlng.lng, rowId);
    }
    if (typeof updateNearestFishingPorts === 'function') {
        updateNearestFishingPorts(landing.latlng.lat, landing.latlng.lng, '通常予測の着地点');
    }

    return true;
}

// 落下のみモード描画
function plotFallOnlyPrediction(prediction, settings) {
    appendDebug('落下のみモード: 下降経路を描画');
    clearMapItems();
    var launch = prediction.launch; // 開始点 (元バースト位置)
    var landing = prediction.landing;
    var range = distHaversine(launch.latlng, landing.latlng, 1);
    var flighttime = '';
    var f_hours = Math.floor(prediction.flight_time / 3600);
    var f_minutes = Math.floor(((prediction.flight_time % 86400) % 3600) / 60);
    if (f_minutes < 10) f_minutes = '0' + f_minutes;
    flighttime = f_hours + 'hr' + f_minutes;
    $("#cursor_pred_range").html(range);
    $("#cursor_pred_time").html(flighttime);
    cursorPredShow();

    var launch_icon = L.icon({ iconUrl: launch_img, iconSize: [10, 10], iconAnchor: [5, 5] });
    var land_icon = L.icon({ iconUrl: land_img, iconSize: [10, 10], iconAnchor: [5, 5] });

    var launch_marker = L.marker(launch.latlng, { title: '落下開始 (' + launch.latlng.lat.toFixed(4) + ', ' + launch.latlng.lng.toFixed(4) + ') 高度 ' + launch.latlng.alt.toFixed(0) + 'm JST ' + launch.datetime.clone().utcOffset(9 * 60).format('HH:mm'), icon: launch_icon }).addTo(map);
    var land_marker = L.marker(landing.latlng, { title: '着地点 (' + landing.latlng.lat.toFixed(4) + ', ' + landing.latlng.lng.toFixed(4) + ') JST ' + landing.datetime.clone().utcOffset(9 * 60).format('HH:mm'), icon: land_icon }).addTo(map);

    var launch_popup = '<b>落下開始</b><br/>' +
        '位置: ' + (typeof formatCoord === 'function' ? formatCoord(launch.latlng.lat, 'lat') + ', ' + formatCoord(launch.latlng.lng, 'lon') : (launch.latlng.lat.toFixed(4) + ', ' + launch.latlng.lng.toFixed(4))) + '<br/>' +
        '<b>開始高度:</b> ' + launch.latlng.alt.toFixed(0) + ' m<br/>' +
        '<b>開始時刻:</b> ' + launch.datetime.clone().utcOffset(9 * 60).format('YYYY-MM-DD HH:mm') + ' JST<br/>' +
        '<b>下降速度:</b> ' + (settings.descent_rate != null ? settings.descent_rate : '?') + ' m/s';
    launch_marker.bindPopup(launch_popup);
    var land_popup = '<b>着地点</b><br/>' +
        '緯度経度: ' + (typeof formatCoord === 'function' ? formatCoord(landing.latlng.lat, 'lat') + ', ' + formatCoord(landing.latlng.lng, 'lon') : (landing.latlng.lat.toFixed(4) + ', ' + landing.latlng.lng.toFixed(4))) + '<br/>' +
        '<b>着地高度:</b> ' + landing.latlng.alt.toFixed(0) + ' m<br/>' +
        '<b>下降時間:</b> ' + flighttime + '<br/>' +
        '<b>着地時刻:</b> ' + landing.datetime.clone().utcOffset(9 * 60).format('YYYY-MM-DD HH:mm') + ' JST';
    land_marker.bindPopup(land_popup);

    var path_polyline = L.polyline(prediction.flight_path, { weight: 3, color: '#4444aa', dashArray: '4,4' }).addTo(map);
    map_items['launch_marker'] = launch_marker;
    map_items['land_marker'] = land_marker;
    map_items['path_polyline'] = path_polyline;
    map.setView(launch.latlng, 8);

    var rowId = null;
    if (typeof updatePosList === 'function') {
        var burst_stub = { latlng: launch.latlng, datetime: launch.datetime }; // no burst for fall-only
        rowId = updatePosList(launch, burst_stub, landing);
    }
    if (typeof checkLandSea === 'function') {
        checkLandSea(landing.latlng.lat, landing.latlng.lng, rowId);
    }
    if (typeof updateNearestFishingPorts === 'function') {
        updateNearestFishingPorts(landing.latlng.lat, landing.latlng.lng, '落下のみ予測の着地点');
    }
}


// Populate and enable the download CSV, KML and Pan To links, and write the 
// time the prediction was run and the model used to the Scenario Info window
function writePredictionInfo(settings, metadata, request, fall_results) {
    // populate the download links

    // Create the API URLs based on the current prediction settings
    if (fall_results) {
        // クライアント側 CSV/KML (簡易) を生成: 下降のみ
        // flight_path_time が存在する場合はそこから UTC 時刻を出力
        var header = 'lat,lon,alt_m,datetime_UTC';
        var csvLines = [header];
        if (Array.isArray(fall_results.flight_path_time)) {
            fall_results.flight_path_time.forEach(function (pt) {
                var dt = pt.datetime ? pt.datetime.clone().utc().format('YYYY-MM-DD HH:mm:ss') : '';
                csvLines.push(pt.lat.toFixed(6) + ',' + pt.lon.toFixed(6) + ',' + pt.alt.toFixed(1) + ',' + dt);
            });
        } else {
            // 後方互換: 時刻情報が無い場合は空欄
            fall_results.flight_path.forEach(function (p) { csvLines.push(p[0].toFixed(6) + ',' + p[1].toFixed(6) + ',' + p[2].toFixed(1) + ','); });
        }
        var csvBlob = new Blob([csvLines.join('\n')], { type: 'text/csv' });
        var csvUrl = URL.createObjectURL(csvBlob);
        // 命名規則: FallOnly_YYYYMMDD_HHmmJST_<LAT><N/S>_<LON><E/W>_ALT<startAlt>m.csv
        try {
            var launchJst = fall_results.launch && fall_results.launch.datetime ? fall_results.launch.datetime.clone().utcOffset(9 * 60) : moment();
            var tsJst = launchJst.format('YYYYMMDD_HHmm');
            var lat = fall_results.launch && fall_results.launch.latlng ? fall_results.launch.latlng.lat : 0;
            var lon = fall_results.launch && fall_results.launch.latlng ? fall_results.launch.latlng.lng : 0;
            var latPart = Math.abs(lat).toFixed(3) + (lat >= 0 ? 'N' : 'S');
            var lonPart = Math.abs(lon).toFixed(3) + (lon >= 0 ? 'E' : 'W');
            var startAlt = fall_results.launch && fall_results.launch.latlng && fall_results.launch.latlng.alt != null ? Math.round(fall_results.launch.latlng.alt) : 0;
            var fname = 'FallOnly_' + tsJst + 'JST_' + latPart + '_' + lonPart + '_ALT' + startAlt + 'm.csv';
            $('#dlcsv').attr('href', csvUrl).attr('download', fname);
        } catch (_e) {
            $('#dlcsv').attr('href', csvUrl).attr('download', 'FallOnly.csv');
        }
        // 簡易 KML
        var kmlPts = fall_results.flight_path.map(function (p) { return p[1] + ',' + p[0] + ',' + p[2]; }).join(' ');
        var kml = '<?xml version="1.0" encoding="UTF-8"?>\n' +
            '<kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><name>Fall Only Descent</name><LineString><coordinates>' + kmlPts + '</coordinates></LineString></Placemark></Document></kml>';
        var kmlBlob = new Blob([kml], { type: 'application/vnd.google-earth.kml+xml' });
        var kmlUrl = URL.createObjectURL(kmlBlob);
        $("#dlkml").attr("href", kmlUrl).attr('download', 'fall_only.kml');
    } else {
        _base_url = tawhiri_api + "?" + $.param(settings)
        _csv_url = _base_url + "&format=csv";
        _kml_url = _base_url + "&format=kml";
        $("#dlcsv").attr("href", _csv_url).removeAttr('download');
        $("#dlkml").attr("href", _kml_url).removeAttr('download');
    }
    bindPanToCenterLink();

    var run_time = moment.utc(metadata.complete_datetime).clone().utcOffset(9 * 60).format('YYYY-MM-DD HH:mm');
    var dataset = moment.utc(request.dataset).format("YYYYMMDD-HH");


    $("#run_time").html(run_time);
    $("#dataset").html(dataset);
}

function bindPanToCenterLink() {
    $('#panto').off('click.prednew').on('click.prednew', function (e) {
        e.preventDefault();

        var target = null;
        if (map_items && map_items['launch_marker'] && typeof map_items['launch_marker'].getLatLng === 'function') {
            target = map_items['launch_marker'].getLatLng();
        } else if (map_items && map_items['land_marker'] && typeof map_items['land_marker'].getLatLng === 'function') {
            target = map_items['land_marker'].getLatLng();
        }

        if (!target && typeof ehime_predictions !== 'undefined') {
            var keys = Object.keys(ehime_predictions || {});
            for (var i = 0; i < keys.length; i++) {
                var ep = ehime_predictions[keys[i]];
                if (ep && ep.marker && typeof ep.marker.getLatLng === 'function') {
                    target = ep.marker.getLatLng();
                    break;
                }
            }
        }

        if (!target || !map || typeof map.panTo !== 'function') {
            if (typeof showToast === 'function') {
                showToast('中心へ移動できる予測結果がありません', 'warning', 2200);
            }
            return;
        }

        map.panTo(target);
    });
}

function updatePredictionDerivedMetrics(tawhiriPrediction) {
    if (!Array.isArray(tawhiriPrediction)) return;

    try {
        var allSpeeds = [];
        var surfaceSpeeds = [];

        tawhiriPrediction.forEach(function (stage) {
            if (!stage || !Array.isArray(stage.trajectory)) return;
            for (var i = 1; i < stage.trajectory.length; i++) {
                var p0 = stage.trajectory[i - 1];
                var p1 = stage.trajectory[i];
                var t0 = moment.utc(p0.datetime);
                var t1 = moment.utc(p1.datetime);
                var dt = t1.diff(t0, 'seconds');
                if (dt <= 0) continue;

                var lon0 = p0.longitude > 180 ? p0.longitude - 360 : p0.longitude;
                var lon1 = p1.longitude > 180 ? p1.longitude - 360 : p1.longitude;
                var distKm = parseFloat(distHaversine(
                    L.latLng(p0.latitude, lon0),
                    L.latLng(p1.latitude, lon1),
                    3
                ));
                if (isNaN(distKm)) continue;

                var speed = (distKm * 1000) / dt;
                allSpeeds.push(speed);

                var avgAlt = (p0.altitude + p1.altitude) / 2;
                if (avgAlt <= 500) {
                    surfaceSpeeds.push(speed);
                }
            }
        });

        var surfaceWind = 0;
        if (surfaceSpeeds.length > 0) {
            var sum = 0;
            for (var j = 0; j < surfaceSpeeds.length; j++) sum += surfaceSpeeds[j];
            surfaceWind = sum / surfaceSpeeds.length;
        }

        var maxWind = 0;
        if (allSpeeds.length > 0) {
            maxWind = Math.max.apply(null, allSpeeds);
        }

        $('#launch_surface_wind').text(surfaceWind.toFixed(1));
        $('#launch_max_wind').text(maxWind.toFixed(1));
    } catch (_e) {
        // 風速指標の更新失敗は予測本体を止めない
    }
}


function processHourlyTawhiriResults(data, settings, current_hour) {
    // Process results from a Tawhiri run.

    if (data.hasOwnProperty('error')) {
        // The prediction API has returned an error.
        throwError("Predictor returned error: " + data.error.description)
    } else {

        var prediction_results = parsePrediction(data.prediction);

        // Save prediction data into our hourly predictor data store.
        hourly_predictions[current_hour]['results'] = prediction_results;

        // Now plot...
        plotMultiplePrediction(prediction_results, current_hour);

        writeHourlyPredictionInfo(settings, data.metadata, data.request);

    }

    //console.log(data);

}

function plotMultiplePrediction(prediction, current_hour) {

    var launch = prediction.launch;
    var landing = prediction.landing;
    var burst = prediction.burst;


    // Make some nice icons
    var launch_icon = L.icon({
        iconUrl: launch_img,
        iconSize: [10, 10],
        iconAnchor: [5, 5]
    });


    if (!map_items.hasOwnProperty("launch_marker")) {
        var launch_marker = L.marker(
            launch.latlng,
            {
                title: '離陸地点 (' + launch.latlng.lat.toFixed(4) + ', ' + launch.latlng.lng.toFixed(4) + ')',
                icon: launch_icon
            }
        ).addTo(map);

        map_items['launch_marker'] = launch_marker;
    }

    var iconColour = ConvertRGBtoHex(evaluate_cmap((current_hour / MAX_PRED_HOURS), 'turbo'));
    var land_marker = new L.CircleMarker(landing.latlng, {
        radius: 5,
        fillOpacity: 1.0,
        zIndexOffset: 1000,
        fillColor: iconColour,
        stroke: true,
        weight: 1,
        color: "#000000",
        title: '<b>離陸時刻(JST): </b>' + launch.datetime.clone().utcOffset(9 * 60).format('YYYY-MM-DD HH:mm') + '<br/>' + '予測着地点 (' + landing.latlng.lat.toFixed(4) + ', ' + landing.latlng.lng.toFixed(4) + ')',
        current_hour: current_hour // Added in so we can extract this when we get a click event.
    }).addTo(map);

    var _base_url = tawhiri_api + "?" + $.param(hourly_predictions[current_hour]['settings'])
    var _csv_url = _base_url + "&format=csv";
    var _kml_url = _base_url + "&format=kml";

    var predict_description = '<b>離陸時刻(JST): </b>' + launch.datetime.clone().utcOffset(9 * 60).format('YYYY-MM-DD HH:mm') + '<br/>' +
        '<b>予測着地点:</b> ' + (typeof formatCoord === 'function' ? formatCoord(landing.latlng.lat, 'lat') + ', ' + formatCoord(landing.latlng.lng, 'lon') : (landing.latlng.lat.toFixed(4) + ', ' + landing.latlng.lng.toFixed(4))) + '</br>' +
        '<b>着地時刻(JST): </b>' + landing.datetime.clone().utcOffset(9 * 60).format('YYYY-MM-DD HH:mm') + '<br/>' +
        '<b>ダウンロード: </b> <a href="' + _kml_url + '" target="_blank">KML</a>  <a href="' + _csv_url + '" target="_blank">CSV</a></br>';

    var landing_popup = new L.popup(
        {
            autoClose: false,
            closeOnClick: false,
        }).setContent(predict_description);
    land_marker.bindPopup(landing_popup);
    land_marker.on('click', showHideHourlyPrediction);

    hourly_predictions[current_hour]['layers']['landing_marker'] = land_marker;
    hourly_predictions[current_hour]['landing_latlng'] = landing.latlng;

    // Generate polyline latlons.
    landing_track = [];
    landing_track_complete = true;
    for (i in hourly_predictions) {
        if (hourly_predictions[i]['landing_latlng']) {
            landing_track.push(hourly_predictions[i]['landing_latlng']);
        } else {
            landing_track_complete = false;
        }
    }
    // If we dont have any undefined elements, plot.
    if (landing_track_complete) {
        if (hourly_polyline) {
            hourly_polyline.setLatLngs(landing_track);
        } else {
            hourly_polyline = L.polyline(
                landing_track,
                {
                    weight: 2,
                    zIndexOffset: 100,
                    color: '#000000'
                }
            ).addTo(map);
        }

        for (i in hourly_predictions) {
            hourly_predictions[i]['layers']['landing_marker'].remove();
            hourly_predictions[i]['layers']['landing_marker'].addTo(map);
        }

        map.fitBounds(hourly_polyline.getBounds());
        map.setZoom(8);

        $("#cursor_pred_lastrun").show();

    }

    // var pop_marker = L.marker(
    //     burst.latlng,
    //     {
    //         title: 'Balloon burst ('+burst.latlng.lat.toFixed(4)+', '+burst.latlng.lng.toFixed(4)+ 
    //         ' at altitude ' + burst.latlng.alt.toFixed(0) + ') at ' 
    //         + burst.datetime.format("HH:mm") + " UTC",
    //         icon: burst_icon
    //     }
    // ).addTo(map);

    // var path_polyline = L.polyline(
    //     prediction.flight_path,
    //     {
    //         weight: 3,
    //         color: '#000000'
    //     }
    // ).addTo(map);



    // Pan to the new position
    // map.panTo(launch.latlng);
    // map.setZoom(8);

    return true;
}

function showHideHourlyPrediction(e) {

    // Extract the current hour from the marker options.
    var current_hour = e.target.options.current_hour;
    var current_pred = hourly_predictions[current_hour]['results'];
    var landing = current_pred.landing;
    var launch = current_pred.launch;
    var burst = current_pred.burst;


    if (hourly_predictions[current_hour]['layers'].hasOwnProperty('flight_path')) {
        // Flight path layer already exists, remove it and the burst icon.
        hourly_predictions[current_hour]['layers']['flight_path'].remove()
        hourly_predictions[current_hour]['layers']['pop_marker'].remove()
        delete hourly_predictions[current_hour]['layers'].flight_path;
        delete hourly_predictions[current_hour]['layers'].pop_marker;

    } else {
        // We need to make new icons.

        var burst_icon = L.icon({
            iconUrl: burst_img,
            iconSize: [16, 16],
            iconAnchor: [8, 8]
        });

        var pop_marker = L.marker(
            burst.latlng,
            {
                title: 'Balloon burst (' + burst.latlng.lat.toFixed(4) + ', ' + burst.latlng.lng.toFixed(4) +
                    ' at altitude ' + burst.latlng.alt.toFixed(0) + ') at '
                    + burst.datetime.clone().utcOffset(9 * 60).format("HH:mm") + " JST",
                icon: burst_icon,
                current_hour: current_hour
            }
        ).addTo(map);

        hourly_predictions[current_hour]['layers']['pop_marker'] = pop_marker;

        var path_polyline = L.polyline(
            current_pred.flight_path,
            {
                weight: 3,
                color: '#000000',
                current_hour: current_hour
            }
        ).addTo(map);
        path_polyline.on('click', showHideHourlyPrediction);

        hourly_predictions[current_hour]['layers']['flight_path'] = path_polyline;
    }

}

function writeHourlyPredictionInfo(settings, metadata, request) {
    // populate the download links

    // // Create the API URLs based on the current prediction settings
    // _base_url = tawhiri_api + "?" + $.param(settings) 
    // _csv_url = _base_url + "&format=csv";
    // _kml_url = _base_url + "&format=kml";


    // $("#dlcsv").attr("href", _csv_url);
    // $("#dlkml").attr("href", _kml_url);
    // $("#panto").click(function() {
    //         map.panTo(map_items['launch_marker'].getLatLng());
    //         //map.setZoom(7);
    // });

    var run_time = moment.utc(metadata.complete_datetime).clone().utcOffset(9 * 60).format('YYYY-MM-DD HH:mm');
    var dataset = moment.utc(request.dataset).format("YYYYMMDD-HH");


    $("#run_time").html(run_time);
    $("#dataset").html(dataset);
}

// ==========================================
// Injected Helpers from Antigravity
// ==========================================

function getJSTFormatted(momentObj) {
    return moment(momentObj).utcOffset(9 * 60).format("HH:mm");
}
function getJSTFullFormatted(momentObj) {
    return moment(momentObj).utcOffset(9 * 60).format("YYYY/MM/DD HH:mm:ss");
}
function getJSTDateTimeFormatted(momentObj) {
    var m = moment(momentObj).utcOffset(9 * 60);
    return m.format("YYYY") + "年" + m.format("M") + "月" + m.format("D") + "日" + m.format("HH:mm");
}

var landing_history_markers = [];

function updatePosList(launch, burst, landing) {
    var tbody = $("#pos_list_body");
    var siteName = $("#site option:selected").text();
    var t = getJSTDateTimeFormatted(launch.datetime);
    var lat = landing.latlng.lat.toFixed(4);
    var lon = landing.latlng.lng.toFixed(4);
    var uniqueId = Date.now();

    var locLink = '<a href="#" onclick="map.panTo(new L.LatLng(' + lat + ', ' + lon + ')); return false;">' + lat + ', ' + lon + '</a>';
    var row = "<tr id='tr_" + uniqueId + "'>" +
        "<td>" + siteName + "</td>" +
        "<td>" + t + "</td>" +
        "<td>" + locLink + "</td>" +
        "<td id='land_sea_" + uniqueId + "'>判定中...</td>" +
        "</tr>";
    tbody.prepend(row);

    $("#tr_" + uniqueId).css("cursor", "pointer").on("click", function () {
        for (var i = 0; i < landing_history_markers.length; i++) {
            var m = landing_history_markers[i];
            if (m.uniqueId === uniqueId) {
                map.panTo(m.getLatLng());
                m.openPopup();
                toggleHistoryPath(m);
                break;
            }
        }
    });
    return uniqueId;
}

function toggleHistoryPath(marker) {
    if (!marker.associatedPath) return;
    var isVisible = marker.associatedPath.options.opacity > 0;
    for (var i = 0; i < landing_history_markers.length; i++) {
        var other = landing_history_markers[i];
        if (other.associatedPath) {
            other.associatedPath.setStyle({ opacity: 0, weight: 3 });
        }
    }
    if (!isVisible) {
        marker.associatedPath.setStyle({ opacity: 0.8, weight: 4 });
        marker.associatedPath.bringToFront();
        $("#tr_" + marker.uniqueId).addClass("active-path");
    } else {
        marker.associatedPath.setStyle({ opacity: 0 });
        $("#tr_" + marker.uniqueId).removeClass("active-path");
    }
}

function checkLandSea(lat, lon, rowId) {
    $("#landing_type").text("判定中...");
    $("#landing_type").css("color", "red");
    if (rowId) {
        $("#land_sea_" + rowId).text("判定中...");
        $("#land_sea_" + rowId).css("color", "red");
    }

    classifyLandSeaAt(lat, lon, function (isWater) {
        if (isWater === true) {
            if (typeof updateLandSeaUI === 'function') updateLandSeaUI(true, rowId);
            return;
        }
        if (isWater === false) {
            if (typeof updateLandSeaUI === 'function') updateLandSeaUI(false, rowId);
            return;
        }
        $("#landing_type").text("不明 (Unknown)").css("color", "gray");
        if (rowId) {
            $("#land_sea_" + rowId).text("不明 (Unknown)").css("color", "gray");
        }
    });
}

function updateLandSeaUI(isWater, rowId) {
    if (isWater) {
        $("#landing_type").text("海 (Sea)").css("color", "blue");
        if (rowId) $("#land_sea_" + rowId).text("海").css("color", "blue");
    } else {
        $("#landing_type").text("陸 (Land)").css("color", "green");
        if (rowId) $("#land_sea_" + rowId).text("陸").css("color", "green");
    }
}

var _landSeaDecisionCache = {};
var _landSeaDecisionCacheKeys = [];
var LANDSEA_DECISION_CACHE_LIMIT = 400;

function cacheLandSeaDecision(lat, lon, isWater) {
    var key = lat.toFixed(4) + ',' + lon.toFixed(4);
    _landSeaDecisionCache[key] = isWater;
    _landSeaDecisionCacheKeys.push(key);
    if (_landSeaDecisionCacheKeys.length > LANDSEA_DECISION_CACHE_LIMIT) {
        var oldKey = _landSeaDecisionCacheKeys.shift();
        delete _landSeaDecisionCache[oldKey];
    }
}

function getCachedLandSeaDecision(lat, lon) {
    var key = lat.toFixed(4) + ',' + lon.toFixed(4);
    if (_landSeaDecisionCache.hasOwnProperty(key)) {
        return _landSeaDecisionCache[key];
    }
    return undefined;
}

function monteCarloLandSeaAt(lat, lon) {
    if (typeof LandSea === 'undefined' || !LandSea.isLand) return null;
    var localResult = LandSea.isLand(lat, lon);
    var nearCoast = LandSea.isNearCoast ? LandSea.isNearCoast(lat, lon) : true;
    if (!nearCoast) {
        if (localResult === true) return false;
        if (localResult === false) return null;
    }
    if (localResult === null) return null;
    var sampleCount = nearCoast ? 32 : 12;
    var radiusDeg = nearCoast ? 0.010 : 0.006;
    var landVotes = 0, seaVotes = 0;
    for (var i = 0; i < sampleCount; i++) {
        var theta = Math.random() * Math.PI * 2;
        var r = radiusDeg * Math.sqrt(Math.random());
        var sampleLat = lat + Math.sin(theta) * r;
        var sampleLon = lon + Math.cos(theta) * r;
        var sampleLand = LandSea.isLand(sampleLat, sampleLon);
        if (sampleLand === true) landVotes++;
        else if (sampleLand === false) seaVotes++;
    }
    var totalVotes = landVotes + seaVotes;
    if (totalVotes === 0) return null;
    var landRatio = landVotes / totalVotes;
    var seaRatio = seaVotes / totalVotes;
    if (landRatio >= 0.65) return false;
    if (seaRatio >= 0.65) return true;
    return null;
}

function classifyLandSeaAt(lat, lon, callback) {
    var cached = getCachedLandSeaDecision(lat, lon);
    if (typeof cached !== 'undefined') { callback(cached); return; }
    var geoJsonResult = null;
    var nearCoast = true;
    if (typeof LandSea !== 'undefined') {
        geoJsonResult = LandSea.isLand(lat, lon);
        nearCoast = LandSea.isNearCoast ? LandSea.isNearCoast(lat, lon) : true;
    }
    if (geoJsonResult === true && !nearCoast) {
        queryInlandWaterAt(lat, lon, function (inlandWater, err) {
            if (err) { cacheLandSeaDecision(lat, lon, false); callback(false); return; }
            var result = inlandWater === true ? true : false;
            cacheLandSeaDecision(lat, lon, result);
            callback(result);
        });
        return;
    }
    var monteCarloResult = monteCarloLandSeaAt(lat, lon);
    if (monteCarloResult !== null) {
        cacheLandSeaDecision(lat, lon, monteCarloResult);
        callback(monteCarloResult);
        return;
    }
    var api_url = "https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=" + lat + "&longitude=" + lon + "&localityLanguage=en";
    $.getJSON(api_url, function (data) {
        var isWater = true, seaEvidence = false, territorialEvidence = false, inlandLandEvidence = false;
        if (data.countryCode && data.countryCode !== "") isWater = false;
        if (data.localityInfo && data.localityInfo.informative) {
            var seaKeywords = ["sea", "ocean", "bay", "gulf", "strait", "channel", "sound", "water", "湾", "海", "灘", "offshore"];
            var territorialKeywords = ["territorial sea", "territorial water", "internal waters"];
            for (var i = 0; i < data.localityInfo.informative.length; i++) {
                var info = data.localityInfo.informative[i];
                var name = (info.name || '').toLowerCase();
                var desc = (info.description || '').toLowerCase();
                for (var tk = 0; tk < territorialKeywords.length; tk++) {
                    if (name.indexOf(territorialKeywords[tk]) !== -1 || desc.indexOf(territorialKeywords[tk]) !== -1) { territorialEvidence = true; break; }
                }
                if (info.order <= 6) {
                    for (var sk = 0; sk < seaKeywords.length; sk++) {
                        if (name.indexOf(seaKeywords[sk]) !== -1 || desc.indexOf(seaKeywords[sk]) !== -1) { seaEvidence = true; break; }
                    }
                }
                if (name.indexOf('prefecture') !== -1 || name.indexOf('city') !== -1 || name.indexOf('municipality') !== -1) { inlandLandEvidence = true; }
            }
        }
        if (territorialEvidence || seaEvidence) { cacheLandSeaDecision(lat, lon, true); callback(true); return; }
        if (!isWater && geoJsonResult === false && nearCoast && !inlandLandEvidence) { cacheLandSeaDecision(lat, lon, true); callback(true); return; }
        if (isWater) { cacheLandSeaDecision(lat, lon, true); callback(true); return; }
        queryInlandWaterAt(lat, lon, function (inlandWater, err) {
            if (err) { cacheLandSeaDecision(lat, lon, false); callback(false); return; }
            var result = inlandWater === true ? true : false;
            cacheLandSeaDecision(lat, lon, result); callback(result);
        });
    }).fail(function () {
        if (geoJsonResult === true) {
            queryInlandWaterAt(lat, lon, function (inlandWater, _err) {
                var result = inlandWater === true ? true : false;
                cacheLandSeaDecision(lat, lon, result); callback(result);
            });
            return;
        }
        if (geoJsonResult === false) { cacheLandSeaDecision(lat, lon, true); callback(true); return; }
        callback(null);
    });
}

function queryInlandWaterAt(lat, lon, callback) {
    var query = '[out:json][timeout:10];('
        + 'way["natural"="water"](around:50,' + lat + ',' + lon + ');'
        + 'relation["natural"="water"](around:50,' + lat + ',' + lon + ');'
        + 'way["waterway"](around:30,' + lat + ',' + lon + ');'
        + ');out count;';
    $.ajax({
        url: "https://overpass-api.de/api/interpreter", type: "POST", data: { data: query }, dataType: "json", timeout: 15000,
        success: function (data) {
            var count = 0;
            if (data.elements && data.elements.length > 0) count = parseInt(data.elements[0].tags.total) || 0;
            if (callback) callback((count > 0), null);
        },
        error: function (jqxhr, textStatus, error) {
            if (callback) callback(null, textStatus || error || 'overpass error');
        }
    });
}

// 漁港機能
var _fishingPorts = [];
var _fishingPortsLoaded = false;
var _allFishingPortMarkers = [];
var _nearbyFishingPortMarkers = [];

function parseFishingPortsFromKML(xml) {
    var ports = [];
    $(xml).find('Folder').each(function () {
        var folderName = $(this).children('name').first().text() || '';
        if (folderName.indexOf('漁船') === -1 && folderName.indexOf('漁港') === -1) return;
        var hasRecord = folderName.indexOf('実績あり') !== -1;
        $(this).find('Placemark').each(function () {
            var name = $(this).find('name').first().text();
            var coordText = $(this).find('coordinates').first().text().trim();
            if (coordText) {
                var parts = coordText.split(',');
                if (parts.length >= 2) {
                    var lng = parseFloat(parts[0]);
                    var lat = parseFloat(parts[1]);
                    if (!isNaN(lat) && !isNaN(lng)) {
                        ports.push({ name: name, lat: lat, lng: lng, hasRecord: hasRecord });
                    }
                }
            }
        });
    });
    return ports;
}

function loadFishingPortData() {
    if (_fishingPortsLoaded) return;
    var kmlUrl = '漁船・回収地点位置関係マップ.kml';
    $.ajax({
        type: "GET", url: kmlUrl, dataType: "xml",
        success: function (xml) {
            _fishingPorts = parseFishingPortsFromKML(xml);
            _fishingPortsLoaded = true;
            appendDebug("漁港データ(KML)読込完了: " + _fishingPorts.length + " 件");
        },
        error: function () { appendDebug("漁港データ(KML)の読み込みに失敗しました。"); }
    });
}

function updateNearestFishingPorts(lat, lng, targetName) {
    if (!_fishingPortsLoaded || _fishingPorts.length === 0) return;
    _nearbyFishingPortMarkers.forEach(function (m) { map.removeLayer(m); });
    _nearbyFishingPortMarkers = [];
    var results = _fishingPorts.map(function (port) {
        var d = parseFloat(distHaversine({ lat: lat, lng: lng }, { lat: port.lat, lng: port.lng }, 2));
        if (!isFinite(d)) d = 99999;
        return { port: port, distance: d };
    });
    results.sort(function (a, b) { return a.distance - b.distance; });
    var nearest = results.slice(0, 3);
    var html = "<b>" + (targetName || "着地点") + " から近い漁港 (Top 3)</b><br>";
    nearest.forEach(function (item, i) {
        html += (i + 1) + ". " + item.port.name + " (" + item.distance.toFixed(1) + " km)<br>";
        var nearbyClass = 'fishing-port-pin nearby ' + (item.port.hasRecord ? 'has-record' : 'no-record');
        var icon = L.divIcon({
            className: nearbyClass,
            html: '<div class="fishing-port-pin-core"></div><div class="fishing-port-pin-wave"></div><div class="fishing-port-pin-wave wave2"></div>',
            iconSize: [28, 36],
            iconAnchor: [14, 34],
            popupAnchor: [0, -24]
        });
        var m = L.marker([item.port.lat, item.port.lng], { icon: icon }).bindPopup("<b>" + item.port.name + "</b><br>着地点から約 " + item.distance.toFixed(1) + " km").addTo(map);
        _nearbyFishingPortMarkers.push(m);
    });
    $("#nearest_fishing_ports_info").html(html);
}

function toggleAllFishingPorts() {
    if (!_fishingPortsLoaded) return;
    if (_allFishingPortMarkers.length > 0) {
        _allFishingPortMarkers.forEach(function (m) { map.removeLayer(m); });
        _allFishingPortMarkers = [];
        $("#toggle_all_fishing_ports_btn").text("漁港をすべて表示");
    } else {
        _fishingPorts.forEach(function (port) {
            var className = 'fishing-port-pin ' + (port.hasRecord ? 'has-record' : 'no-record');
            var icon = L.divIcon({
                className: className,
                html: '<div class="fishing-port-pin-core"></div><div class="fishing-port-pin-wave"></div><div class="fishing-port-pin-wave wave2"></div>',
                iconSize: [22, 30],
                iconAnchor: [11, 28],
                popupAnchor: [0, -20]
            });
            var m = L.marker([port.lat, port.lng], { icon: icon }).bindPopup(port.name).addTo(map);
            _allFishingPortMarkers.push(m);
        });
        $("#toggle_all_fishing_ports_btn").text("漁港をすべて隠す");
    }
}

function clearNearbyFishingPorts() {
    _nearbyFishingPortMarkers.forEach(function (m) { map.removeLayer(m); });
    _nearbyFishingPortMarkers = [];
    $("#nearest_fishing_ports_info").html("シミュレーション後に近い漁港と距離を表示します。");
}

$(function () {
    bindPanToCenterLink();
    if (typeof loadFishingPortData === 'function') loadFishingPortData();
});
