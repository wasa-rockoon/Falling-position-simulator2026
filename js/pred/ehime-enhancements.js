/*
 * - プリセット保存/復元
 * - CSVエクスポート
 * - レイヤー管理
 * - インラインバリデーション
 */

// ============================================================
// a. 予測パラメータのプリセット機能
// ============================================================

var ENSEMBLE_HEATMAP_LAYER = null;
var ENSEMBLE_HEATMAP_POINTS = [];
var ENSEMBLE_HEATMAP_VISIBLE = false;

// ============================================================

function exportPosListCSV() {
    var table = document.getElementById('pos_list_table');
    if (!table) return;
    var tableRows = Array.from(table.querySelectorAll('tr'));
    if (tableRows.length <= 1) {
        if (typeof showToast === 'function') showToast('エクスポートするデータがありません', 'warning', 3000);
        return;
    }
    if (typeof ExportService === 'undefined') throw new Error('ExportService is unavailable');
    var csv = tableRows.map(function (row) {
        return Array.from(row.querySelectorAll('th, td')).map(function (column) { return ExportService.escapeCsv(column.textContent.trim()); }).join(',');
    }).join('\r\n');
    ExportService.download(csv, '落下位置一覧_' + new Date().toISOString().slice(0, 10) + '.csv', 'text/csv;charset=utf-8');
    if (typeof showToast === 'function') showToast('CSVをエクスポートしました', 'success', 3000);
}

function copyPosListToClipboard() {
    var table = document.getElementById('pos_list_table');
    if (!table) return;

    var rows = table.querySelectorAll('tr');
    if (rows.length <= 1) {
        if (typeof showToast === 'function') {
            showToast('コピーするデータがありません', 'warning', 3000);
        }
        return;
    }

    var text = [];
    rows.forEach(function (row) {
        var cols = row.querySelectorAll('th, td');
        var rowData = [];
        cols.forEach(function (col) {
            rowData.push(col.textContent.trim());
        });
        text.push(rowData.join('\t'));
    });

    navigator.clipboard.writeText(text.join('\n')).then(function () {
        if (typeof showToast === 'function') {
            showToast('クリップボードにコピーしました', 'success', 2000);
        }
    }).catch(function () {
        if (typeof showToast === 'function') {
            showToast('コピーに失敗しました', 'error', 3000);
        }
    });
}

// ============================================================
// c. 地図上の結果レイヤー管理
// ============================================================

function clearPredictionMapDisplay() {
    if (typeof clearMapItems === 'function') clearMapItems();
    if (ENSEMBLE_HEATMAP_LAYER && typeof ENSEMBLE_HEATMAP_LAYER.remove === 'function') ENSEMBLE_HEATMAP_LAYER.remove();
    ENSEMBLE_HEATMAP_LAYER = null;
    ENSEMBLE_HEATMAP_POINTS = [];
    ENSEMBLE_HEATMAP_VISIBLE = false;
    updateEnsembleHeatmapButtonLabel();
    if (typeof landing_history_markers !== 'undefined') {
        for (var i = 0; i < landing_history_markers.length; i++) {
            var marker = landing_history_markers[i];
            if (!marker) continue;
            if (marker.associatedPath && typeof marker.associatedPath.remove === 'function') marker.associatedPath.remove();
            if (typeof marker.remove === 'function') marker.remove();
        }
        landing_history_markers = [];
    }
}

function clearAllPredictions() {
    if (window.MapDisplayController) window.MapDisplayController.clearAll({ source: 'user' });
    else {
        clearPredictionMapDisplay();
        if (typeof showToast === 'function') showToast('地図上の結果をすべて消しました（履歴・表・グラフ・設定は保持）', 'info', 3500);
    }
}

function getThemeColor(varName, fallback) {
    try {
        var value = getComputedStyle(document.documentElement).getPropertyValue(varName);
        return value && value.trim() ? value.trim() : fallback;
    } catch (_e) {
        return fallback;
    }
}

function updateEnsembleHeatmapButtonLabel() {
    var button = document.getElementById('ensemble_heatmap_toggle');
    if (!button) return;
    button.textContent = ENSEMBLE_HEATMAP_VISIBLE ? '着地範囲 OFF' : '着地範囲 ON';
}

function normalizeEnsemblePoints(points) {
    var list = [];
    if (!Array.isArray(points)) return list;
    points.forEach(function (point) {
        var lat = point && (typeof point.lat === 'number' ? point.lat : parseFloat(point.lat));
        var lng = point && (typeof point.lng === 'number' ? point.lng : parseFloat(point.lng));
        if (!isFinite(lat) || !isFinite(lng)) return;
        list.push({
            lat: lat,
            lng: lng,
            label: point.label || '',
            isWater: point.isWater,
            landSea: point.landSea || null,
            landSeaClassification: point.landSeaClassification || (point.landSea && point.landSea.classification) || null
        });
    });
    return list;
}

function buildConvexHull(points) {
    if (!Array.isArray(points) || points.length < 3) return points ? points.slice() : [];

    var sorted = points.slice().sort(function (a, b) {
        if (a.lng === b.lng) return a.lat - b.lat;
        return a.lng - b.lng;
    });

    function cross(o, a, b) {
        return (a.lng - o.lng) * (b.lat - o.lat) - (a.lat - o.lat) * (b.lng - o.lng);
    }

    var lower = [];
    for (var i = 0; i < sorted.length; i++) {
        while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], sorted[i]) <= 0) {
            lower.pop();
        }
        lower.push(sorted[i]);
    }

    var upper = [];
    for (var j = sorted.length - 1; j >= 0; j--) {
        while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], sorted[j]) <= 0) {
            upper.pop();
        }
        upper.push(sorted[j]);
    }

    lower.pop();
    upper.pop();
    return lower.concat(upper);
}

function renderEnsembleHeatmapLayer() {
    if (ENSEMBLE_HEATMAP_LAYER && typeof ENSEMBLE_HEATMAP_LAYER.remove === 'function') {
        ENSEMBLE_HEATMAP_LAYER.remove();
    }
    ENSEMBLE_HEATMAP_LAYER = null;

    if (!ENSEMBLE_HEATMAP_VISIBLE || !Array.isArray(ENSEMBLE_HEATMAP_POINTS) || ENSEMBLE_HEATMAP_POINTS.length === 0) {
        updateEnsembleHeatmapButtonLabel();
        return;
    }

    if (typeof map === 'undefined' || !map || typeof L === 'undefined') return;

    var hull = buildConvexHull(ENSEMBLE_HEATMAP_POINTS);
    var fillColor = getThemeColor('--color-danger', '#ff3b30');
    var borderColor = getThemeColor('--color-danger', '#ff3b30');

    if (hull.length >= 3) {
        var coords = hull.map(function (point) {
            return [point.lat, point.lng];
        });
        ENSEMBLE_HEATMAP_LAYER = L.polygon(coords, {
            color: borderColor,
            weight: 2,
            fillColor: fillColor,
            fillOpacity: 0.16,
            opacity: 0.9,
            interactive: false
        }).addTo(map);
    } else if (hull.length === 2) {
        ENSEMBLE_HEATMAP_LAYER = L.polyline(hull.map(function (point) {
            return [point.lat, point.lng];
        }), {
            color: borderColor,
            weight: 3,
            opacity: 0.7,
            dashArray: '6,6',
            interactive: false
        }).addTo(map);
    } else if (hull.length === 1) {
        ENSEMBLE_HEATMAP_LAYER = L.circle(hull[0], {
            radius: 250,
            color: borderColor,
            fillColor: fillColor,
            fillOpacity: 0.16,
            opacity: 0.9,
            weight: 2,
            interactive: false
        }).addTo(map);
    }

    updateEnsembleHeatmapButtonLabel();
}

function toggleEnsembleHeatmap() {
    if (!Array.isArray(ENSEMBLE_HEATMAP_POINTS) || ENSEMBLE_HEATMAP_POINTS.length === 0) {
        if (typeof showToast === 'function') {
            showToast('着地範囲を表示できる結果がありません', 'warning', 2400);
        }
        return;
    }

    ENSEMBLE_HEATMAP_VISIBLE = !ENSEMBLE_HEATMAP_VISIBLE;
    renderEnsembleHeatmapLayer();

    if (typeof showToast === 'function') {
        showToast(ENSEMBLE_HEATMAP_VISIBLE ? '着地範囲を表示しました' : '着地範囲を非表示にしました', 'info', 1800);
    }
}

function updateEnsembleWaterStats(landingPoints, total) {
    var points = normalizeEnsemblePoints(landingPoints);
    ENSEMBLE_HEATMAP_POINTS = points;

    var waterCount = 0;
    var landCount = 0;
    var inlandWaterCount = 0;
    var unknownCount = 0;
    points.forEach(function (point) {
        var classification = point.landSeaClassification || (point.isWater === true ? 'sea' : (point.isWater === false ? 'land' : 'unknown'));
        if (classification === 'sea') waterCount += 1;
        else if (classification === 'land') landCount += 1;
        else if (classification === 'inland_water') inlandWaterCount += 1;
        else unknownCount += 1;
    });

    var determined = waterCount + landCount + inlandWaterCount;
    var allTotal = typeof total === 'number' && total > 0 ? total : points.length;
    var landPct = determined > 0 ? Math.round((landCount / determined) * 100) : 0;
    var seaPct = determined > 0 ? Math.round((waterCount / determined) * 100) : 0;

    $('#ensemble_land_pct').text(determined > 0 ? landPct + '%' : '-');
    $('#ensemble_sea_pct').text(determined > 0 ? seaPct + '%' : '-').attr('title', '内水面 ' + inlandWaterCount + '件 / 不明 ' + unknownCount + '件');
    $('#ensemble_land_pct').attr('title', '内水面 ' + inlandWaterCount + '件 / 不明 ' + unknownCount + '件');
    $('#ensemble_completed').text(points.length);
    $('#ensemble_total').text(allTotal);

    renderEnsembleHeatmapLayer();
}

function compute13VarStatistics(landingPoints) {
    var points = normalizeEnsemblePoints(landingPoints);
    ENSEMBLE_HEATMAP_POINTS = points;

    if (points.length === 0) {
        $('#ensemble_mean_pos').text('-');
        $('#ensemble_max_dev').text('-');
        $('#ehime_panel_mean').text('-');
        $('#ehime_panel_maxdev').text('-');
        return;
    }

    var sumLat = 0;
    var sumLng = 0;
    points.forEach(function (point) {
        sumLat += point.lat;
        sumLng += point.lng;
    });

    var meanLat = sumLat / points.length;
    var meanLng = sumLng / points.length;
    var maxDev = 0;

    points.forEach(function (point) {
        var distKm = parseFloat(distHaversine(L.latLng(meanLat, meanLng), L.latLng(point.lat, point.lng), 1));
        if (isFinite(distKm) && distKm > maxDev) {
            maxDev = distKm;
        }
    });

    $('#ensemble_mean_pos').text(meanLat.toFixed(4) + ', ' + meanLng.toFixed(4));
    $('#ensemble_max_dev').text(maxDev.toFixed(2));
    $('#ehime_panel_mean').text(meanLat.toFixed(4) + ', ' + meanLng.toFixed(4));
    $('#ehime_panel_maxdev').text(maxDev.toFixed(2));

    renderEnsembleHeatmapLayer();
}

// ============================================================
// d. インラインバリデーション
// ============================================================

function getEnsembleExportRows() {
    if (typeof _ensembleResults !== 'undefined' && Array.isArray(_ensembleResults) && _ensembleResults.length > 0) {
        return _ensembleResults.slice().sort(function (a, b) { return a.index - b.index; });
    }

    if (typeof ehime_predictions === 'undefined' || !ehime_predictions) {
        return [];
    }

    var baseEntry = null;
    var keys = Object.keys(ehime_predictions).sort(function (a, b) {
        return parseInt(a.split('_')[1], 10) - parseInt(b.split('_')[1], 10);
    });

    for (var i = 0; i < keys.length; i++) {
        var e = ehime_predictions[keys[i]];
        if (e && e.label === 'BASE' && e.settings) {
            baseEntry = e;
            break;
        }
    }

    var rows = [];
    keys.forEach(function (key) {
        var entry = ehime_predictions[key];
        if (!entry || entry.status !== 'ok' || !entry.results || !entry.results.landing) return;

        var idx = parseInt(key.split('_')[1], 10);
        var launch = entry.results.launch && entry.results.launch.latlng ? entry.results.launch.latlng : null;
        var burst = entry.results.burst && entry.results.burst.latlng ? entry.results.burst.latlng : null;
        var landing = entry.results.landing.latlng;
        var baseSettings = baseEntry && baseEntry.settings ? baseEntry.settings : null;

        var desc = '基準設定';
        if (entry.label !== 'BASE' && baseSettings && entry.settings) {
            var parts = [];
            if (entry.settings.ascent_rate !== baseSettings.ascent_rate) {
                parts.push('上昇' + (entry.settings.ascent_rate > baseSettings.ascent_rate ? '+' : '-') + '1 m/s');
            }
            if (entry.settings.descent_rate !== baseSettings.descent_rate) {
                parts.push('下降' + (entry.settings.descent_rate > baseSettings.descent_rate ? '+' : '-') + '3 m/s');
            }
            if (entry.settings.burst_altitude !== baseSettings.burst_altitude) {
                parts.push('破裂' + (entry.settings.burst_altitude > baseSettings.burst_altitude ? '+10%' : '-20%'));
            }
            desc = parts.length ? parts.join(', ') : '基準設定';
        }

        var flightSec = 0;
        if (entry.results.launch && entry.results.launch.datetime && entry.results.landing && entry.results.landing.datetime) {
            flightSec = entry.results.landing.datetime.diff(entry.results.launch.datetime, 'seconds');
        }
        var flightMinutes = flightSec > 0 ? Math.round(flightSec / 60) : 0;
        var flightStr = flightMinutes + '分';

        var landSeaResult = entry.landSeaResult;
        if (!landSeaResult || !landSeaResult.classification) {
            try {
                landSeaResult = (typeof LandSea !== 'undefined' && typeof LandSea.classify === 'function')
                    ? LandSea.classify(landing.lat, landing.lng)
                    : { classification: 'unknown', confidence: 'unknown', source: 'unavailable', coastDistanceKm: null, dataVersion: '', reason: 'classifier-unavailable' };
                entry.landSeaResult = landSeaResult;
            } catch (_e) {
                landSeaResult = { classification: 'unknown', confidence: 'unknown', source: 'unavailable', coastDistanceKm: null, dataVersion: '', reason: 'classification-error' };
                if (typeof reportNonFatalError === 'function') reportNonFatalError(_e, 'ehime-export.land-sea');
            }
        }
        var isWater = landSeaResult.classification === 'sea' ? true : (landSeaResult.classification === 'land' ? false : null);
        rows.push({
            index: isNaN(idx) ? rows.length : idx,
            label: entry.label || '-',
            description: desc,
            lat: Number(landing.lat) || 0,
            lng: Number(landing.lng) || 0,
            ascent_rate: entry.settings && entry.settings.ascent_rate != null ? Number(entry.settings.ascent_rate) : 0,
            descent_rate: entry.settings && entry.settings.descent_rate != null ? Number(entry.settings.descent_rate) : 0,
            burst_altitude: entry.settings && entry.settings.burst_altitude != null ? Number(entry.settings.burst_altitude) : 0,
            flight_time_str: flightStr,
            launch_lat: launch ? Number(launch.lat) || 0 : 0,
            launch_lng: launch ? Number(launch.lng) || 0 : 0,
            burst_lat: burst ? Number(burst.lat) || 0 : 0,
            burst_lng: burst ? Number(burst.lng) || 0 : 0,
            burst_alt: burst && burst.alt != null ? Number(burst.alt) || 0 : 0,
            isWater: isWater,
            landSea: landSeaResult,
            landSeaClassification: landSeaResult.classification
        });
    });

    return rows.sort(function (a, b) { return a.index - b.index; });
}

/**
 * 13バリアント結果をCSVファイルとしてダウンロード
 */
function exportEnsembleCSV() {
    var exportRows = getEnsembleExportRows();
    if (exportRows.length === 0) {
        if (typeof showToast === 'function') showToast('エクスポートするアンサンブル結果がありません', 'warning', 3000);
        return;
    }
    if (typeof ExportService === 'undefined') throw new Error('ExportService is unavailable');
    var headers = ['ラベル', '変更内容', '着地緯度', '着地経度', '上昇速度(m/s)', '下降速度(m/s)', '破裂高度(m)', '飛行時間', '打上緯度', '打上経度', '破裂緯度', '破裂経度', '破裂高度(実)', '海陸判定', '判定信頼度', '判定元', '海岸距離(km)', '判定データ版'];
    var rows = exportRows.map(function (row) {
        var classification = row.landSeaClassification || (row.isWater === true ? 'sea' : (row.isWater === false ? 'land' : 'unknown'));
        return [row.label, row.description, row.lat.toFixed(6), row.lng.toFixed(6), row.ascent_rate.toFixed(2), row.descent_rate.toFixed(2), row.burst_altitude.toFixed(0), row.flight_time_str, row.launch_lat.toFixed(6), row.launch_lng.toFixed(6), row.burst_lat.toFixed(6), row.burst_lng.toFixed(6), (row.burst_alt || 0).toFixed(0), classification === 'sea' ? '海' : (classification === 'land' ? '陸' : (classification === 'inland_water' ? '内水面' : '不明')), row.landSea && row.landSea.confidence || 'unknown', row.landSea && row.landSea.source || 'unavailable', row.landSea && row.landSea.coastDistanceKm != null ? Number(row.landSea.coastDistanceKm).toFixed(3) : '', row.landSea && row.landSea.dataVersion || ''];
    });
    var csv = [headers].concat(rows).map(function (row) { return row.map(ExportService.escapeCsv).join(','); }).join('\r\n');
    ExportService.download(csv, 'ensemble_results_' + moment().format('YYYYMMDD_HHmmss') + '.csv', 'text/csv;charset=utf-8');
    if (typeof showToast === 'function') showToast('アンサンブル結果をCSVエクスポートしました', 'success', 3000);
}

/**
 * 13バリアント結果をJSONファイルとしてダウンロード
 * メタデータ（日時、統計情報）も含む
 */
function exportEnsembleJSON() {
    var exportRows = getEnsembleExportRows();
    if (exportRows.length === 0) {
        if (typeof showToast === 'function') showToast('エクスポートするアンサンブル結果がありません', 'warning', 3000);
        return;
    }

    // 統計情報を収集
    var meanPos = document.getElementById('ensemble_mean_pos');
    var maxDev = document.getElementById('ensemble_max_dev');
    var landPct = document.getElementById('ensemble_land_pct');
    var seaPct = document.getElementById('ensemble_sea_pct');

    var exportData = {
        metadata: {
            exported_at: moment().format('YYYY-MM-DD HH:mm:ss JST'),
            variant_count: exportRows.length,
            mean_landing_position: meanPos ? meanPos.textContent : '-',
            max_deviation_km: maxDev ? maxDev.textContent : '-',
            land_percentage: landPct ? landPct.textContent : '-',
            sea_percentage: seaPct ? seaPct.textContent : '-'
        },
        results: exportRows
    };

    var json = JSON.stringify(exportData, null, 2);
    if (typeof ExportService === 'undefined') throw new Error('ExportService is unavailable');
    ExportService.download(json, 'ensemble_results_' + moment().format('YYYYMMDD_HHmmss') + '.json', 'application/json;charset=utf-8');

    if (typeof showToast === 'function') showToast('アンサンブル結果をJSONエクスポートしました', 'success', 3000);
}

// ============================================================
// 初期化
// ============================================================
// Initialisation
// ============================================================
var _ehimeEnhancementsInitialized = false;
function initEhimeEnhancements() {
    if (_ehimeEnhancementsInitialized) return;
    _ehimeEnhancementsInitialized = true;
    var csvBtn = document.getElementById('csv_export_btn');
    if (csvBtn) csvBtn.addEventListener('click', exportPosListCSV);
    var copyBtn = document.getElementById('clipboard_copy_btn');
    if (copyBtn) copyBtn.addEventListener('click', copyPosListToClipboard);
    if (window.MapDisplayController) window.MapDisplayController.register('prediction-results', clearPredictionMapDisplay);
    ['clear_all_btn', 'clear_map_results_btn'].forEach(function (id) {
        var clearBtn = document.getElementById(id);
        if (clearBtn) clearBtn.addEventListener('click', clearAllPredictions);
    });
    var ensembleCsvBtn = document.getElementById('ensemble_export_csv');
    if (ensembleCsvBtn) ensembleCsvBtn.addEventListener('click', exportEnsembleCSV);
    var ensembleJsonBtn = document.getElementById('ensemble_export_json');
    if (ensembleJsonBtn) ensembleJsonBtn.addEventListener('click', exportEnsembleJSON);
    var redAreaBtn = document.getElementById('ensemble_heatmap_toggle');
    if (redAreaBtn) redAreaBtn.addEventListener('click', function () {
        if (typeof toggleEnsembleHeatmap === 'function') toggleEnsembleHeatmap();
    });
}
window.AppShell.registerInitializer('ehime-enhancements', initEhimeEnhancements, 50);
