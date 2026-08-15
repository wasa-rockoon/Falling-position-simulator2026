/* Ehime ensemble, legacy history, batch and prediction dispatch controller. */
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
    } catch (_e) { if (typeof reportNonFatalError === 'function') reportNonFatalError(_e, 'non-fatal fallback'); }
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
        var rowLandSea = p.landSeaResult || localLandSeaResult(p.results.landing.latlng.lat, p.results.landing.latlng.lng);
        p.landSeaResult = rowLandSea;
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
            isWater: legacyIsWaterFromLandSea(rowLandSea),
            landSeaClassification: rowLandSea.classification,
            landSea: rowLandSea,
            landsea: landSeaLabel(rowLandSea),
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
    var inlandWaterCount = 0;
    var unknownCount = 0;
    rows.forEach(function (row) {
        var classification = row.landSeaClassification || (row.isWater === true ? 'sea' : (row.isWater === false ? 'land' : 'unknown'));
        if (classification === 'land') landCount += 1;
        else if (classification === 'sea') waterCount += 1;
        else if (classification === 'inland_water') inlandWaterCount += 1;
        else unknownCount += 1;
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
        inlandWaterCount: inlandWaterCount,
        unknownCount: unknownCount,
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
            isWater: row.isWater,
            landSea: row.landSea || null,
            landSeaClassification: row.landSeaClassification || null
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
            landSeaResult: row.landSea || localLandSeaResult(toEhimeFiniteNumber(row.lat), toEhimeFiniteNumber(row.lng)),
            landsea: row.landsea || landSeaLabel(row.landSea),
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

    var successCount = keys.filter(function (k) {
        return ehime_predictions[k] && ehime_predictions[k].status === 'ok';
    }).length;
    var anySuccess = successCount > 0;

    if (anySuccess) {
        saveEhimeHistorySnapshot();
        renderEhimeHistoryPanel();
    }
    ehime_history_saved_for_run = true;
    var finalStatus = !anySuccess ? 'failed' : (successCount === keys.length ? 'completed' : 'partial');
    var finalError = !anySuccess && typeof AppErrors !== 'undefined'
        ? AppErrors.create('EHIME_ALL_VARIANTS_FAILED', '愛媛13条件の予測に失敗しました。', { phase: 'prediction', runId: ehime_current && ehime_current.runId })
        : undefined;
    persistEhimeRunBoundary(finalStatus, finalError).then(function () {
        $(document).trigger('ehime_run_complete', [{ runId: ehime_current && ehime_current.runId, success: anySuccess }]);
    });
}

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

// 旧「全地点一括計算」は自動探索の全地点プリセットへ統合した互換入口です。
function runBatchSimulation() {
    if (typeof showAllSitesAutoSearchPreset === 'function') return showAllSitesAutoSearchPreset();
    if (typeof showToast === 'function') showToast('放球自動探索を初期化しています。', 'info', 1800);
    return null;
}

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
            entry.landSeaResult = localLandSeaResult(ll.lat, ll.lng);
            landsea = landSeaLabel(entry.landSeaResult);
            entry.landsea = landsea;
        } catch (e) {
            landsea = '不明';
            if (typeof reportNonFatalError === 'function') reportNonFatalError(e, 'ehime.land-sea');
        }
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
            var summaryLandSea = p.landSeaResult || localLandSeaResult(p.results.landing.latlng.lat, p.results.landing.latlng.lng);
            p.landSeaResult = summaryLandSea;
            if (summaryLandSea.classification === 'land') landCount++;
            else if (summaryLandSea.classification === 'sea') waterCount++;
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
    if (typeof ehime_predictions === 'undefined' || typeof ExportService === 'undefined') return '';
    var completed = Object.values(ehime_predictions).filter(function (prediction) { return prediction.status === 'ok' && prediction.results && prediction.results.landing; });
    if (completed.length === 0) return '';
    var rows = completed.map(function (prediction) {
        var launchTime = prediction.results.launch && prediction.results.launch.datetime ? prediction.results.launch.datetime.clone().utcOffset(9 * 60).format('YYYY-MM-DD HH:mm') : '';
        var landingTime = prediction.results.landing.datetime ? prediction.results.landing.datetime.clone().utcOffset(9 * 60).format('YYYY-MM-DD HH:mm') : '';
        return {
            label: prediction.label,
            landing_lat: prediction.results.landing.latlng.lat.toFixed(5),
            landing_lon: prediction.results.landing.latlng.lng.toFixed(5),
            ascent_rate: prediction.settings && prediction.settings.ascent_rate,
            descent_rate: prediction.settings && prediction.settings.descent_rate,
            burst_altitude: prediction.settings && prediction.settings.burst_altitude,
            launch_time_JST: launchTime,
            landing_time_JST: landingTime,
            flight_time_min: prediction.results.flight_time == null ? '' : Math.round(prediction.results.flight_time / 60)
        };
    });
    return ExportService.rowsToCsv(['label', 'landing_lat', 'landing_lon', 'ascent_rate', 'descent_rate', 'burst_altitude', 'launch_time_JST', 'landing_time_JST', 'flight_time_min'], rows);
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
    e.preventDefault();
    var csv = buildEhimeLandingCSV();
    if (!csv) {
        showToast('まだ着地点データがありません。予測完了後に再度お試しください。', 'warning', 5000);
        return;
    }
    var baseEntry = Object.values(ehime_predictions).find(function (prediction) { return prediction.label === 'BASE' && prediction.results && prediction.results.launch; });
    var launchMoment = baseEntry && baseEntry.results.launch.datetime ? baseEntry.results.launch.datetime.clone().utcOffset(9 * 60) : moment();
    var position = baseEntry && baseEntry.results.launch.latlng;
    var latlonPart = position ? '_' + Math.abs(position.lat).toFixed(3) + (position.lat >= 0 ? 'N' : 'S') + '_' + Math.abs(position.lng).toFixed(3) + (position.lng >= 0 ? 'E' : 'W') : '';
    var ascPart = baseEntry && Number.isFinite(Number(baseEntry.settings.ascent_rate)) ? '_ASC' + Number(baseEntry.settings.ascent_rate).toFixed(2) : '';
    var descPart = baseEntry && Number.isFinite(Number(baseEntry.settings.descent_rate)) ? '_DES' + Number(baseEntry.settings.descent_rate).toFixed(2) : '';
    var filename = 'Ehime_着地点一覧_' + launchMoment.format('YYYYMMDD_HHmm') + 'JST' + ascPart + descPart + latlonPart + '.csv';
    ExportService.download(csv, filename, 'text/csv;charset=utf-8');
});

function tawhiriRequest(settings, extra_settings, requestContext) {
    var context = requestContext || createPredictionRequestContext();
    if (!context) return;
    function requestFailure(error, fallbackMessage) {
        var detail = error && error.message ? ' ' + error.message : '';
        var normalized = typeof AppErrors !== 'undefined'
            ? AppErrors.normalize(error, { code: 'PREDICTION_FAILED', userMessage: fallbackMessage, phase: 'prediction', runId: context.runId })
            : error;
        persistPredictionRunBoundary(context, { status: 'failed', error: normalized });
        throwError(fallbackMessage + detail);
    }
    if (settings.pred_type === 'single' || settings.pred_type === 'fall') {
        hourly_mode = false;
        var fallOnly = settings.pred_type === 'fall';
        requestTawhiriData(settings, context, { label: fallOnly ? 'fall' : 'single' })
            .then(function (data) { processTawhiriResults(data, settings, fallOnly, context); })
            .catch(function (error) { requestFailure(error, fallOnly ? '落下モード予測失敗。' : 'Prediction failed.'); });
        return;
    }
    if (settings.pred_type === 'ehime') {
        if (settings.profile !== 'standard_profile') {
            throwError('愛媛モードは標準フライトプロファイルのみ対応');
            return;
        }
        runEhimePredictions(settings, extra_settings, context);
        return;
    }
    hourly_mode = true;
    clearMapItems();
    hourly_predictions = {};
    var timeStepByType = { daily: 24, '1_hour': 1, '3_hour': 3, '6_hour': 6, '12_hour': 12 };
    var timeStep = timeStepByType[settings.pred_type];
    if (!timeStep) { throwError('Invalid time step.'); return; }
    if (settings.profile !== 'standard_profile') {
        throwError('Hourly/Daily predictions are only available for the standard flight profile.');
        return;
    }
    initializePredictionBatch(context, Math.ceil(MAX_PRED_HOURS / timeStep));
    for (let currentHour = 0; currentHour < MAX_PRED_HOURS; currentHour += timeStep) {
        let currentMoment = moment(extra_settings.launch_moment).add(currentHour, 'hours');
        let currentSettings = Object.assign({}, settings, { launch_datetime: currentMoment.format() });
        hourly_predictions[currentHour] = { layers: {}, settings: currentSettings, apiUrl: context.baseUrl };
        requestTawhiriData(currentSettings, context, { label: 'hourly-' + currentHour })
            .then(function (data) {
                processHourlyTawhiriResults(data, currentSettings, currentHour, context);
                recordPredictionBatchBoundary(context, true);
            })
            .catch(function (error) {
                hourly_predictions[currentHour].error = error && error.message ? error.message : String(error);
                recordPredictionBatchBoundary(context, false, error);
            });
    }
}

// Generate and run multiple variant predictions for Ehime mode
function runEhimePredictions(base_settings, extra_settings, requestContext, runtimeOptions) {
    if (ehime_current && ehime_current.runId && Object.keys(ehime_predictions || {}).some(function (key) { return ehime_predictions[key].status === 'pending'; })) {
        $(document).trigger('ehime_run_complete', [{ runId: ehime_current.runId, success: false, interrupted: true }]);
    }
    clearMapItems();
    ehime_predictions = {};
    ehime_history_saved_for_run = false;
    var runId = requestContext && requestContext.runId ? requestContext.runId : (typeof RunRecord !== 'undefined' ? RunRecord.makeId('run') : 'ehime-' + Date.now().toString(36));
    if (requestContext) requestContext.runId = runId;
    runtimeOptions = runtimeOptions || {};
    ehime_current = { base: base_settings, apiUrl: requestContext ? requestContext.baseUrl : null, runId: runId, requestContext: requestContext, suppressRunRecord: runtimeOptions.suppressRunRecord === true };
    if (!ehime_current.suppressRunRecord) startPredictionRunRecord(base_settings, requestContext, 'ehime_ensemble', '愛媛13条件比較', runId);
    if (typeof VariantProfileRegistry === 'undefined') throw new Error('VariantProfileRegistry is unavailable');
    var variants = VariantProfileRegistry.buildEhime(base_settings);
    ehime_variant_total = variants.length;
    $('#ehime_total').text(ehime_variant_total);
    $('#ehime_completed').text(0);
    $('#ehime_mean').text('-');
    $('#ehime_max_dev').text('-');
    variants.forEach(function (variant, index) {
        var variantSettings = Object.assign({}, variant.settings);
        var variantId = variant.id;
        ehime_predictions[variantId] = { settings: variantSettings, status: 'pending', label: variant.label };
        requestTawhiriData(variantSettings, requestContext, { label: variantId })
            .then(function (data) {
                if (!ehime_current || ehime_current.runId !== runId) return;
                processEhimeResult(data, variantSettings, variantId, index, requestContext, runId);
            })
            .catch(function (error) {
                if (!ehime_current || ehime_current.runId !== runId) return;
                ehime_predictions[variantId].status = 'error';
                ehime_predictions[variantId].error = error && error.message ? error.message : String(error);
                updateEhimeSummaryFromStore();
                persistEhimeRunBoundary('running').then(finalizeEhimeRunIfCompleted);
            });
    });
    updateEhimeCSVLink();
    expandEhimePanel();
    refreshEhimePanel();
    return runId;
}
function run13VariantEnsemble(base_settings, api_url, requestContext, runtimeOptions) {
    if (!base_settings) return;
    var settings = Object.assign({}, base_settings, { pred_type: 'ehime' });
    var source = $('#api_source').val() || 'sondehub';
    var context = requestContext || createPredictionRequestContext({ source: source, baseUrl: api_url || resolveTawhiriApiUrl() });
    if (!context) return;
    if ($('#prediction_type').val() !== 'ehime') $('#prediction_type').val('ehime').trigger('change');
    return runEhimePredictions(settings, {}, context, runtimeOptions);
}

function processEhimeResult(data, settings, variant_id, variant_index, requestContext, runId) {
    if (!ehime_current || ehime_current.runId !== runId) return;
    if (data.hasOwnProperty('error')) {
        ehime_predictions[variant_id].status = 'error';
        ehime_predictions[variant_id].error = data.error && (data.error.description || data.error.message) || 'prediction error';
        updateEhimeSummaryFromStore();
        persistEhimeRunBoundary('running').then(finalizeEhimeRunIfCompleted);
        return;
    }
    var prediction_results = parsePrediction(data.prediction);
    ehime_predictions[variant_id].status = 'ok';
    ehime_predictions[variant_id].results = prediction_results;
    try {
        if (typeof updatePredictionCharts === 'function') {
            updatePredictionCharts(data.prediction, {
                id: variant_id,
                label: ehime_predictions[variant_id].label || variant_id,
                color: ConvertRGBtoHex(evaluate_cmap((variant_index + 1) / (ehime_variant_total + 1), 'turbo')),
                groupId: runId
            });
        }
    } catch (_chartError) {
        if (typeof reportNonFatalError === 'function') reportNonFatalError(_chartError, 'ehime.charts');
    }
    // Plot base path for BASE only once
    if (ehime_predictions[variant_id].label === 'BASE') {
        // Pass settings so popups can show conditions
        plotStandardPrediction(prediction_results, settings);
        try {
            updatePredictionDerivedMetrics(data.prediction);
        } catch (_e0) { if (typeof reportNonFatalError === 'function') reportNonFatalError(_e0, 'prediction.metrics'); }
        // Set standard CSV/KML links to BASE flight path (same as single mode)
        try {
            var _base_url = getPredictionRequestBaseUrl(requestContext) + "?" + $.param(settings);
            var _csv_url = _base_url + "&format=csv";
            var _kml_url = _base_url + "&format=kml";
            $("#dlcsv").attr("href", _csv_url).removeAttr('download');
            $("#dlkml").attr("href", _kml_url).removeAttr('download');
        } catch (_e) { if (typeof reportNonFatalError === 'function') reportNonFatalError(_e, 'non-fatal fallback'); }
        // Update run time/model if available
        try {
            if (data && data.metadata && data.request) {
                var run_time = moment.utc(data.metadata.complete_datetime).clone().utcOffset(9 * 60).format('YYYY-MM-DD HH:mm');
                var dataset = moment.utc(data.request.dataset).format("YYYYMMDD-HH");
                $("#run_time").html(run_time);
                $("#dataset").html(dataset);
            }
        } catch (__e) { if (typeof reportNonFatalError === 'function') reportNonFatalError(__e, 'non-fatal fallback'); }
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
    } catch (_e) { if (typeof reportNonFatalError === 'function') reportNonFatalError(_e, 'non-fatal fallback'); }
    persistEhimeRunBoundary('running').then(finalizeEhimeRunIfCompleted);
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
        } catch (_e) { if (typeof reportNonFatalError === 'function') reportNonFatalError(_e, 'non-fatal fallback'); }
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
            try { if (entry.layers.flight_path.remove) entry.layers.flight_path.remove(); } catch (_e) { if (typeof reportNonFatalError === 'function') reportNonFatalError(_e, 'non-fatal fallback'); }
            try { if (entry.layers.launch_marker && entry.layers.launch_marker.remove) entry.layers.launch_marker.remove(); } catch (_e) { if (typeof reportNonFatalError === 'function') reportNonFatalError(_e, 'non-fatal fallback'); }
            try { if (entry.layers.burst_marker && entry.layers.burst_marker.remove) entry.layers.burst_marker.remove(); } catch (_e) { if (typeof reportNonFatalError === 'function') reportNonFatalError(_e, 'non-fatal fallback'); }
            delete entry.layers.flight_path;
            delete entry.layers.launch_marker;
            delete entry.layers.burst_marker;
        }
        // ポップアップを開いたままにする (未開なら開く)
        try { marker.openPopup(); } catch (_e) { if (typeof reportNonFatalError === 'function') reportNonFatalError(_e, 'non-fatal fallback'); }
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
            var summaryLandSea = p.landSeaResult || localLandSeaResult(lat, lng);
            p.landSeaResult = summaryLandSea;
            if (summaryLandSea.classification === 'land') landCount++;
            else if (summaryLandSea.classification === 'sea') waterCount++;
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
            label: p.label || '',
            landSea: p.landSeaResult || null,
            landSeaClassification: p.landSeaResult && p.landSeaResult.classification || null,
            isWater: legacyIsWaterFromLandSea(p.landSeaResult)
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
