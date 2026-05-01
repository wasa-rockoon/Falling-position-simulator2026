/*
 * 機能改善群
 * - プリセット保存/復元
 * - CSVエクスポート
 * - レイヤー管理
 * - インラインバリデーション
 */

// ============================================================
// a. 予測パラメータのプリセット機能
// ============================================================

var PRESET_KEY = 'predictor_presets';
var LAST_SETTINGS_KEY = 'predictor_last_settings';
var ENSEMBLE_HEATMAP_LAYER = null;
var ENSEMBLE_HEATMAP_POINTS = [];
var ENSEMBLE_HEATMAP_VISIBLE = false;

// プリセットで保存するフィールドID
var PRESET_FIELDS = [
    'lat', 'lon', 'ascent', 'burst', 'drag', 'initial_alt', 
    'flight_profile', 'prediction_type', 
    'year', 'month', 'day', 'hour', 'min',
    'api_source', 'api_custom_url'
];

function getFormValues() {
    var values = {};
    PRESET_FIELDS.forEach(function (id) {
        var el = document.getElementById(id);
        if (el) values[id] = el.value;
    });
    return values;
}

function applyFormValues(values) {
    PRESET_FIELDS.forEach(function (id) {
        var el = document.getElementById(id);
        if (el && values[id] !== undefined) {
            el.value = values[id];
            
            // 特殊なトリガーが必要なフィールドの処理
            if (id === 'month' || id === 'site' || id === 'api_source') {
                $(el).change(); 
            }
            if (id === 'lat' || id === 'lon') {
                if (typeof plotClick === 'function') plotClick();
            }

            // バリデーション再実行
            if (typeof validateField === 'function') validateField(el);
        }
    });
    if (typeof showToast === 'function') {
        showToast('設定を復元しました', 'success', 2000);
    }
}

function loadPresets() {
    try {
        var raw = localStorage.getItem(PRESET_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch (e) {
        return [];
    }
}

function savePreset(name) {
    var presets = loadPresets();
    var values = getFormValues();
    // 同名があれば上書き
    var found = false;
    for (var i = 0; i < presets.length; i++) {
        if (presets[i].name === name) {
            presets[i].values = values;
            found = true;
            break;
        }
    }
    if (!found) {
        presets.push({ name: name, values: values });
    }
    localStorage.setItem(PRESET_KEY, JSON.stringify(presets));
    updatePresetUI();
    if (typeof showToast === 'function') {
        showToast('プリセット「' + name + '」を保存', 'success', 2000);
    }
}

function deletePreset(name) {
    var presets = loadPresets();
    presets = presets.filter(function (p) { return p.name !== name; });
    localStorage.setItem(PRESET_KEY, JSON.stringify(presets));
    updatePresetUI();
}

function updatePresetUI() {
    var select = document.getElementById('preset_select');
    if (!select) return;
    var presets = loadPresets();
    // 現在の選択値を保持
    var currentVal = select.value;
    select.innerHTML = '<option value="">-- プリセット選択 --</option>';
    presets.forEach(function (p) {
        var opt = document.createElement('option');
        opt.value = p.name;
        opt.textContent = p.name;
        select.appendChild(opt);
    });
    select.value = currentVal;
}

// 前回の設定を自動保存（予測実行時に呼ばれる）
function saveLastSettings() {
    var values = getFormValues();
    localStorage.setItem(LAST_SETTINGS_KEY, JSON.stringify(values));
}

function restoreLastSettings() {
    try {
        var raw = localStorage.getItem(LAST_SETTINGS_KEY);
        if (raw) {
            applyFormValues(JSON.parse(raw));
        }
    } catch (e) { /* 無視 */ }
}

// ============================================================
// b. 落下位置一覧のCSVエクスポート
// ============================================================

function exportPosListCSV() {
    var table = document.getElementById('pos_list_table');
    if (!table) return;

    var rows = table.querySelectorAll('tr');
    if (rows.length <= 1) {
        if (typeof showToast === 'function') {
            showToast('エクスポートするデータがありません', 'warning', 3000);
        }
        return;
    }

    var csv = [];
    rows.forEach(function (row) {
        var cols = row.querySelectorAll('th, td');
        var rowData = [];
        cols.forEach(function (col) {
            // リンクテキストを取得（HTMLを除去）
            var text = col.textContent.trim().replace(/"/g, '""');
            rowData.push('"' + text + '"');
        });
        csv.push(rowData.join(','));
    });

    var csvContent = '\uFEFF' + csv.join('\n'); // BOM付きUTF-8
    var blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    var link = document.createElement('a');
    var url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', '落下位置一覧_' + new Date().toISOString().slice(0, 10) + '.csv');
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    if (typeof showToast === 'function') {
        showToast('CSVをエクスポートしました', 'success', 3000);
    }
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

function clearAllPredictions() {
    if (typeof clearMapItems === 'function') {
        clearMapItems();
    }
    if (ENSEMBLE_HEATMAP_LAYER && typeof ENSEMBLE_HEATMAP_LAYER.remove === 'function') {
        ENSEMBLE_HEATMAP_LAYER.remove();
    }
    ENSEMBLE_HEATMAP_LAYER = null;
    ENSEMBLE_HEATMAP_POINTS = [];
    ENSEMBLE_HEATMAP_VISIBLE = false;
    updateEnsembleHeatmapButtonLabel();
    // 履歴マーカーも削除
    if (typeof landing_history_markers !== 'undefined') {
        for (var i = 0; i < landing_history_markers.length; i++) {
            var m = landing_history_markers[i];
            if (m) {
                // 軌跡があれば削除
                if (m.associatedPath && typeof m.associatedPath.remove === 'function') {
                    m.associatedPath.remove();
                }
                // マーカーを削除
                if (typeof m.remove === 'function') {
                    m.remove();
                }
            }
        }
        landing_history_markers = [];
    }
    // 落下位置一覧をクリア
    var tbody = document.querySelector('#pos_list_table tbody');
    if (tbody) tbody.innerHTML = '';

    // C3履歴キャッシュをクリア
    if (typeof clearEhimeHistoryCache === 'function') {
        clearEhimeHistoryCache();
    }

    if (typeof showToast === 'function') {
        showToast('すべての予測結果をクリアしました', 'info', 3000);
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
            isWater: point.isWater
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
    points.forEach(function (point) {
        if (point.isWater === true) waterCount += 1;
        else if (point.isWater === false) landCount += 1;
    });

    var determined = waterCount + landCount;
    var allTotal = typeof total === 'number' && total > 0 ? total : points.length;
    var landPct = determined > 0 ? Math.round((landCount / determined) * 100) : 0;
    var seaPct = determined > 0 ? Math.round((waterCount / determined) * 100) : 0;

    $('#ensemble_land_pct').text(determined > 0 ? landPct + '%' : '-');
    $('#ensemble_sea_pct').text(determined > 0 ? seaPct + '%' : '-');
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

var VALIDATION_RULES = {
    'ascent': { min: 0.1, max: 20, label: '上昇速度' },
    'burst': { min: 100, max: 50000, label: '破裂高度' },
    'drag': { min: 0.1, max: 30, label: '下降速度' },
    'initial_alt': { min: 0, max: 10000, label: '打ち上げ高度' },
    'lat': { min: -90, max: 90, label: '緯度' },
    'lon': { min: -180, max: 360, label: '経度' }
};

function validateField(el) {
    if (!el || !el.id) return true;
    var rule = VALIDATION_RULES[el.id];
    if (!rule) return true;

    // 落下モード時は開始高度の許容上限を拡張する
    var dynamicRule = {
        min: rule.min,
        max: rule.max,
        label: rule.label
    };
    if (el.id === 'initial_alt') {
        var predTypeEl = document.getElementById('prediction_type');
        var isFallMode = predTypeEl && predTypeEl.value === 'fall';
        if (isFallMode) {
            dynamicRule.max = 50000;
            dynamicRule.label = '落下開始高度';
        }
    }

    var val = parseFloat(el.value);
    var errorEl = document.getElementById('valid_' + el.id);

    if (isNaN(val)) {
        setValidationState(el, errorEl, '数値を入力してください');
        return false;
    }

    if (val < dynamicRule.min || val > dynamicRule.max) {
        setValidationState(el, errorEl, dynamicRule.label + ': ' + dynamicRule.min + '〜' + dynamicRule.max + ' の範囲');
        return false;
    }

    // 破裂高度 < 打ち上げ高度のチェック
    if (el.id === 'burst') {
        var initAlt = parseFloat(document.getElementById('initial_alt').value) || 0;
        if (val <= initAlt) {
            setValidationState(el, errorEl, '破裂高度は打ち上げ高度より高くしてください');
            return false;
        }
    }

    clearValidationState(el, errorEl);
    return true;
}

function setValidationState(el, errorEl, message) {
    el.classList.add('input-invalid');
    el.classList.remove('input-valid');
    if (errorEl) {
        errorEl.textContent = message;
        errorEl.style.display = 'block';
    }
}

function clearValidationState(el, errorEl) {
    el.classList.remove('input-invalid');
    el.classList.add('input-valid');
    if (errorEl) {
        errorEl.textContent = '';
        errorEl.style.display = 'none';
    }
}

// バリデーション初期化
function initValidation() {
    Object.keys(VALIDATION_RULES).forEach(function (id) {
        var el = document.getElementById(id);
        if (!el) return;

        // エラーメッセージ要素を作成
        var errorSpan = document.createElement('span');
        errorSpan.id = 'valid_' + id;
        errorSpan.className = 'validation-error';
        errorSpan.style.display = 'none';
        el.parentNode.appendChild(errorSpan);

        // イベントリスナー
        el.addEventListener('input', function () { validateField(el); });
        el.addEventListener('blur', function () { validateField(el); });
    });
}

// ============================================================
// e. アンサンブル結果エクスポート (CSV / JSON)
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

        var isWater = null;
        if (entry.landsea === '海') {
            isWater = true;
        } else if (entry.landsea === '陸') {
            isWater = false;
        } else {
            try {
                if (typeof LandSea !== 'undefined') {
                    var isLand = LandSea.isLand(landing.lat, landing.lng);
                    if (isLand === true) isWater = false;
                    else if (isLand === false) isWater = true;
                }
            } catch (_e) {}
        }

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
            isWater: isWater
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

    // CSVヘッダー行
    var header = [
        'ラベル', '変更内容', '着地緯度', '着地経度',
        '上昇速度(m/s)', '下降速度(m/s)', '破裂高度(m)',
        '飛行時間', '打上緯度', '打上経度',
        '破裂緯度', '破裂経度', '破裂高度(実)', '海陸判定'
    ];

    var rows = [header.join(',')];
    // indexでソートしてからエクスポート
    var sorted = exportRows;

    for (var i = 0; i < sorted.length; i++) {
        var r = sorted[i];
        var landSea = r.isWater === true ? '海' : r.isWater === false ? '陸' : '不明';
        var row = [
            '"' + r.label + '"',
            '"' + r.description + '"',
            r.lat.toFixed(6),
            r.lng.toFixed(6),
            r.ascent_rate.toFixed(2),
            r.descent_rate.toFixed(2),
            r.burst_altitude.toFixed(0),
            '"' + r.flight_time_str + '"',
            r.launch_lat.toFixed(6),
            r.launch_lng.toFixed(6),
            r.burst_lat.toFixed(6),
            r.burst_lng.toFixed(6),
            (r.burst_alt || 0).toFixed(0),
            '"' + landSea + '"'
        ];
        rows.push(row.join(','));
    }

    // BOM付きUTF-8でCSV生成
    var csvContent = '\uFEFF' + rows.join('\n');
    var blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    var link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'ensemble_results_' + moment().format('YYYYMMDD_HHmmss') + '.csv';
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

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
    var blob = new Blob([json], { type: 'application/json;charset=utf-8;' });
    var link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'ensemble_results_' + moment().format('YYYYMMDD_HHmmss') + '.json';
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    if (typeof showToast === 'function') showToast('アンサンブル結果をJSONエクスポートしました', 'success', 3000);
}

// ============================================================
// 初期化
// ============================================================
document.addEventListener('DOMContentLoaded', function () {
    updatePresetUI();
    initValidation();

    // プリセット読み込みボタン
    var loadBtn = document.getElementById('preset_load_btn');
    if (loadBtn) {
        loadBtn.addEventListener('click', function () {
            var select = document.getElementById('preset_select');
            if (!select || !select.value) return;
            var presets = loadPresets();
            var preset = presets.find(function (p) { return p.name === select.value; });
            if (preset) applyFormValues(preset.values);
        });
    }

    // プリセット保存ボタン
    var saveBtn = document.getElementById('preset_save_btn');
    if (saveBtn) {
        saveBtn.addEventListener('click', function () {
            var name = prompt('プリセット名を入力してください:');
            if (name && name.trim()) {
                savePreset(name.trim());
            }
        });
    }

    // プリセット削除ボタン
    var delBtn = document.getElementById('preset_delete_btn');
    if (delBtn) {
        delBtn.addEventListener('click', function () {
            var select = document.getElementById('preset_select');
            if (!select || !select.value) return;
            if (confirm('プリセット「' + select.value + '」を削除しますか？')) {
                deletePreset(select.value);
            }
        });
    }

    // 前回の設定復元ボタン
    var restoreBtn = document.getElementById('preset_restore_btn');
    if (restoreBtn) {
        restoreBtn.addEventListener('click', restoreLastSettings);
    }

    // CSVエクスポートボタン (落下位置一覧)
    var csvBtn = document.getElementById('csv_export_btn');
    if (csvBtn) csvBtn.addEventListener('click', exportPosListCSV);

    // クリップボードコピーボタン
    var copyBtn = document.getElementById('clipboard_copy_btn');
    if (copyBtn) copyBtn.addEventListener('click', copyPosListToClipboard);

    // 全クリアボタン
    var clearBtn = document.getElementById('clear_all_btn');
    if (clearBtn) clearBtn.addEventListener('click', clearAllPredictions);

    // アンサンブル結果エクスポートボタン
    var ensembleCsvBtn = document.getElementById('ensemble_export_csv');
    if (ensembleCsvBtn) ensembleCsvBtn.addEventListener('click', exportEnsembleCSV);

    var ensembleJsonBtn = document.getElementById('ensemble_export_json');
    if (ensembleJsonBtn) ensembleJsonBtn.addEventListener('click', exportEnsembleJSON);

    // 着地予測エリアトグルボタン
    var redAreaBtn = document.getElementById('ensemble_heatmap_toggle');
    if (redAreaBtn) redAreaBtn.addEventListener('click', function () {
        if (typeof toggleEnsembleHeatmap === 'function') toggleEnsembleHeatmap();
    });
});
