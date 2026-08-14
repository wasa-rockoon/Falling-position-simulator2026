/*
 * 放球ウィンドウ分析 (Launch Window Analysis)
 *
 * 動作：
 *  1. 「放球NG判定」ボタン押下 → フォーム時刻 から 15分間隔 × 6時間(25スロット) を
 *      BASE条件で順次予測 (3秒間隔でTawhiriに送信)
 *  2. 各スロットの着地点を固定版ローカルデータで決定論的に海陸判定
 *  3. スライダー変更 → その時刻でフォームの時刻を更新し、愛媛13バリアントを新規実行
 *
 * API負荷配慮: 3秒間隔 (BASE条件のみ)
 */

var _launchWindowResults   = [];   // { offsetMin, launchTimeJST, launchTimeUTC, landingLat, landingLng, isWater, windSpeed, landProbPct, seaProbPct }
var _launchWindowMarkers   = [];
var _launchWindowRunning   = false;
var _launchWindowNGThreshold = 50; // 陸落ち確率の閾値 (%)
var _launchWindowBaseTimeUTC = null; // 開始時刻 (moment UTC)
var _launchWindowApiUrl      = '';   // API URL (実行時に記録)
var _launchWindowSettings    = {};   // 実行時のフライト設定 (記録用)
var _launchWindowUseEhimeProbability = false; // local実行時はtrue
var _launchWindowLastSelectedIdx = 0;
var _launchWindowUIInitialized = false;
var _lwEnsembleRunning       = false;

// ============================================================
// UI 初期化
// ============================================================

var _lwDebounceTimer = null;

function buildEhimeVariants(baseSettings) {
    var baseAscent = baseSettings.ascent_rate;
    var baseDescent = baseSettings.descent_rate;
    var baseBurst = baseSettings.burst_altitude;

    var ASC_MARGIN = 1;
    var DES_MARGIN = 3;
    var BURST_PLUS = 0.10;
    var BURST_MINUS = 0.20;

    var defs = [
        { label: 'BASE', ascent: 0, descent: 0, burstFactor: 0, desc: "基準設定 (0 m/s 変動)" },
        { label: 'ASC-', ascent: -ASC_MARGIN, descent: 0, burstFactor: 0, desc: "上昇 -" + ASC_MARGIN + " m/s" },
        { label: 'ASC+', ascent: +ASC_MARGIN, descent: 0, burstFactor: 0, desc: "上昇 +" + ASC_MARGIN + " m/s" },
        { label: 'DES-', ascent: 0, descent: -DES_MARGIN, burstFactor: 0, desc: "下降 -" + DES_MARGIN + " m/s" },
        { label: 'DES+', ascent: 0, descent: +DES_MARGIN, burstFactor: 0, desc: "下降 +" + DES_MARGIN + " m/s" },
        { label: 'BURST-', ascent: 0, descent: 0, burstFactor: -BURST_MINUS, desc: "破裂高度 -" + (BURST_MINUS * 100) + "%" },
        { label: 'BURST+', ascent: 0, descent: 0, burstFactor: +BURST_PLUS, desc: "破裂高度 +" + (BURST_PLUS * 100) + "%" },
        { label: 'A-D-', ascent: -ASC_MARGIN, descent: -DES_MARGIN, burstFactor: 0, desc: "上昇 -" + ASC_MARGIN + " & 下降 -" + DES_MARGIN },
        { label: 'A+D+', ascent: +ASC_MARGIN, descent: +DES_MARGIN, burstFactor: 0, desc: "上昇 +" + ASC_MARGIN + " & 下降 +" + DES_MARGIN },
        { label: 'A-B-', ascent: -ASC_MARGIN, descent: 0, burstFactor: -BURST_MINUS, desc: "上昇 -" + ASC_MARGIN + " & 破裂 -" + (BURST_MINUS * 100) + "%" },
        { label: 'A+B+', ascent: +ASC_MARGIN, descent: 0, burstFactor: +BURST_PLUS, desc: "上昇 +" + ASC_MARGIN + " & 破裂 +" + (BURST_PLUS * 100) + "%" },
        { label: 'D-B-', ascent: 0, descent: -DES_MARGIN, burstFactor: -BURST_MINUS, desc: "下降 -" + DES_MARGIN + " & 破裂 -" + (BURST_MINUS * 100) + "%" },
        { label: 'D+B+', ascent: 0, descent: +DES_MARGIN, burstFactor: +BURST_PLUS, desc: "下降 +" + DES_MARGIN + " & 破裂 +" + (BURST_PLUS * 100) + "%" }
    ];

    return defs.map(function (d, index) {
        var s = JSON.parse(JSON.stringify(baseSettings));
        s.ascent_rate = baseAscent + d.ascent;
        s.descent_rate = baseDescent + d.descent;
        s.burst_altitude = baseBurst * (1 + d.burstFactor);
        if (s.descent_rate <= 0) s.descent_rate = 0.5;
        return { index: index, label: d.label, desc: d.desc, settings: s };
    });
}

function formatLaunchWindowFlightTime(seconds) {
    if (typeof seconds !== 'number' || isNaN(seconds) || seconds < 0) return '-';
    var minutes = Math.floor(seconds / 60);
    var hours = Math.floor(minutes / 60);
    var remainMinutes = minutes % 60;
    if (hours > 0) {
        return hours + '時間' + remainMinutes + '分';
    }
    return minutes + '分';
}

function classifyLandingForLaunchWindow(lat, lon, callback) {
    if (typeof classifyLandSeaAt === 'function') {
        classifyLandSeaAt(lat, lon, function (isWater, landSeaResult) {
            callback(isWater, landSeaResult);
        });
        return;
    }
    var landSeaResult = (typeof LandSea !== 'undefined' && typeof LandSea.classify === 'function')
        ? LandSea.classify(lat, lon)
        : { classification: 'unknown', confidence: 'unknown', source: 'unavailable', coastDistanceKm: null, dataVersion: '', reason: 'classifier-unavailable' };
    var isWater = landSeaResult.classification === 'sea' ? true : (landSeaResult.classification === 'land' ? false : null);
    callback(isWater, landSeaResult);
}
function evaluateEhimeProbabilityForSlot(slotSettings, api_url, callback) {
    var variants = buildEhimeVariants(slotSettings);
    var total = variants.length;
    var completed = 0;
    var landCount = 0;
    var seaCount = 0;
    var inlandWaterCount = 0;
    var unknownCount = 0;
    var baseLanding = null;
    var baseWindSpeed = 0;
    var baseFlightTimeSec = 0;
    var slotVariants = new Array(total);

    variants.forEach(function (v) {
        var req = JSON.parse(JSON.stringify(v.settings));
        delete req.pred_type;

        $.get(api_url, req)
            .done(function (data) {
                try {
                    var parsed = parsePrediction(data.prediction);
                    var lat = parsed.landing.latlng.lat;
                    var lng = parsed.landing.latlng.lng;

                    if (v.label === 'BASE') {
                        baseLanding = { lat: lat, lng: lng };
                        baseWindSpeed = calcSurfaceWindFromPrediction(data.prediction);
                        baseFlightTimeSec = parsed.flight_time || 0;
                    }

                    classifyLandingForLaunchWindow(lat, lng, function (isWater, landSeaResult) {
                        if (landSeaResult && landSeaResult.classification === 'sea') seaCount++;
                        else if (landSeaResult && landSeaResult.classification === 'land') landCount++;
                        else if (landSeaResult && landSeaResult.classification === 'inland_water') inlandWaterCount++;
                        else unknownCount++;
                        if (v.label === 'BASE' && baseLanding) baseLanding.landSea = landSeaResult;
                        
                        slotVariants[v.index] = {
                            index: v.index,
                            label: v.label,
                            desc: v.desc,
                            lat: lat,
                            lng: lng,
                            isWater: isWater,
                            landSea: landSeaResult,
                            settings: req
                        };

                        completed++;
                        if (completed >= total) {
                            var known = landCount + seaCount + inlandWaterCount;
                            var landPct = known > 0 ? (landCount / known) * 100 : 100;
                            var seaPct = known > 0 ? (seaCount / known) * 100 : 0;
                            callback({
                                landProbPct: landPct,
                                seaProbPct: seaPct,
                                inlandWaterCount: inlandWaterCount,
                                unknownCount: unknownCount,
                                baseLanding: baseLanding,
                                baseWindSpeed: baseWindSpeed,
                                flightTimeSec: baseFlightTimeSec,
                                flightTimeStr: formatLaunchWindowFlightTime(baseFlightTimeSec),
                                variants: slotVariants.filter(function (item) { return !!item; }).sort(function (a, b) { return a.index - b.index; })
                            });
                        }
                    });
                } catch (_e) {
                    unknownCount++;
                    completed++;
                    if (completed >= total) {
                        callback({
                            landProbPct: 100,
                            seaProbPct: 0,
                            unknownCount: unknownCount,
                            baseLanding: baseLanding,
                            baseWindSpeed: baseWindSpeed,
                            flightTimeSec: baseFlightTimeSec,
                            flightTimeStr: formatLaunchWindowFlightTime(baseFlightTimeSec),
                            variants: slotVariants.filter(function (item) { return !!item; }).sort(function (a, b) { return a.index - b.index; })
                        });
                    }
                }
            })
            .fail(function () {
                unknownCount++;
                completed++;
                if (completed >= total) {
                    callback({
                        landProbPct: 100,
                        seaProbPct: 0,
                        unknownCount: unknownCount,
                        baseLanding: baseLanding,
                        baseWindSpeed: baseWindSpeed,
                        flightTimeSec: baseFlightTimeSec,
                        flightTimeStr: formatLaunchWindowFlightTime(baseFlightTimeSec),
                        variants: slotVariants.filter(function (item) { return !!item; }).sort(function (a, b) { return a.index - b.index; })
                    });
                }
            });
    });
}

function updateLaunchWindowVariantSummary(result) {
    if (!result || !Array.isArray(result.variants) || result.variants.length === 0) return;

    var landingPoints = result.variants.filter(function (v) { return v && typeof v.lat === 'number' && typeof v.lng === 'number'; }).map(function (v) {
        return { lat: v.lat, lng: v.lng, label: v.label, isWater: v.isWater, landSea: v.landSea };
    });
    if (landingPoints.length === 0) return;

    if (typeof updateEnsembleWaterStats === 'function') {
        updateEnsembleWaterStats(landingPoints, landingPoints.length);
    }
    if (typeof compute13VarStatistics === 'function') {
        compute13VarStatistics(landingPoints);
    }
}

function bindLaunchWindowVariantInteractions(variantIndex) {
    var marker = _launchWindowVariantMarkers[variantIndex];
    var selectVariant = function () {
        if (marker && typeof marker.getLatLng === 'function') {
            map.panTo(marker.getLatLng());
            if (typeof marker.openPopup === 'function') marker.openPopup();
        }
    };

    $('#ehime_row_' + variantIndex).css('cursor', 'pointer').off('click').on('click', selectVariant);
    $('#ehime_card_' + variantIndex).css('cursor', 'pointer').off('click').on('click', selectVariant);
}

function initLaunchWindowUI() {
    if (_launchWindowUIInitialized) return;
    _launchWindowUIInitialized = true;
    // 項目: スライダー (時刻選択)
    var slider = document.getElementById('launch_window_slider');
    if (slider) {
        slider.addEventListener('input', function () {
            var idx = parseInt(this.value);
            syncLaunchWindowSelection(idx, _launchWindowUseEhimeProbability);
        });
        // changeイベントは冗長になる可能性があるためinput + debounceに統一
    }

    // 閾値スライダー
    var threshSlider = document.getElementById('ng_threshold_slider');
    if (threshSlider) {
        threshSlider.addEventListener('input', function () {
            _launchWindowNGThreshold = parseInt(this.value);
            document.getElementById('ng_threshold_value').textContent = this.value + '%';
            refreshLaunchWindowMarkerStyles(_launchWindowLastSelectedIdx);
            updateLaunchWindowNGLine();
            if (_launchWindowResults.length > 0) {
                updateLaunchWindowSlider(_launchWindowLastSelectedIdx);
            }
        });
    }

    // 実行ボタン
    var runBtn = document.getElementById('launch_window_run_btn');
    if (runBtn) {
        runBtn.addEventListener('click', runLaunchWindowAnalysis);
    }

    // クリアボタン
    var clearBtn = document.getElementById('launch_window_clear_btn');
    if (clearBtn) {
        clearBtn.addEventListener('click', clearLaunchWindow);
    }
}

// ============================================================
// 設定の取得ヘルパー
// ============================================================

function getLaunchWindowSettings() {
    var s = {};
    s.profile = $('#flight_profile').val();
    s.launch_site_name = $('#site option:selected').text();
    s.launch_latitude  = parseFloat($('#lat').val());
    s.launch_longitude = parseFloat($('#lon').val());
    if (s.launch_longitude < 0.0) s.launch_longitude += 360.0;
    s.launch_altitude  = parseFloat($('#initial_alt').val());
    s.ascent_rate      = parseFloat($('#ascent').val());
    s.burst_altitude   = parseFloat($('#burst').val());
    s.descent_rate     = parseFloat($('#drag').val());
    return s;
}

function getLaunchWindowApiUrl() {
    var src = $('#api_source').val();
    if (src === 'local')  return '/api/v1/';
    if (src === 'custom') return $('#api_custom_url').val();
    return 'https://api.v2.sondehub.org/tawhiri';
}

function getLaunchWindowBaseTime() {
    var y  = parseInt($('#year').val());
    var mo = parseInt($('#month').val()) - 1;
    var d  = parseInt($('#day').val());
    var h  = parseInt($('#hour').val());
    var mi = parseInt($('#min').val());
    return moment([y, mo, d, h, mi, 0]).utcOffset(9 * 60, true).clone().utc();
}

function getLaunchWindowLandPct(result) {
    if (!result) return 0;
    if (typeof result.landProbPct === 'number') return result.landProbPct;
    if (result.isWater === false) return 100;
    if (result.isWater === true) return 0;
    return 0;
}

function launchWindowClassification(result) {
    if (result && result.landSea && result.landSea.classification) return result.landSea.classification;
    if (result && result.isWater === true) return 'sea';
    if (result && result.isWater === false) return 'land';
    return 'unknown';
}

function launchWindowLandSeaLabel(result) {
    var classification = launchWindowClassification(result);
    if (classification === 'sea') return '海';
    if (classification === 'land') return '陸';
    if (classification === 'inland_water') return '内水面';
    return '不明';
}

function launchWindowLandSeaColor(result) {
    var classification = launchWindowClassification(result);
    if (classification === 'sea') return '#1565C0';
    if (classification === 'land') return '#C62828';
    if (classification === 'inland_water') return '#7b61a8';
    return '#9E9E9E';
}
function getLaunchWindowMarkerFillColor(result) {
    return getLaunchWindowLandPct(result) >= _launchWindowNGThreshold ? '#ff3b30' : '#34c759';
}

function refreshLaunchWindowMarkerStyles(selectedIdx) {
    for (var i = 0; i < _launchWindowMarkers.length; i++) {
        var marker = _launchWindowMarkers[i];
        var result = _launchWindowResults[i];
        if (!marker || !result) continue;

        var isSelected = (i === selectedIdx);
        var isNG = getLaunchWindowLandPct(result) >= _launchWindowNGThreshold;
        var color = isNG ? '#ff3b30' : '#34c759';

        marker.setStyle({
            radius: isSelected ? 10 : 5,
            weight: isSelected ? 3 : 1,
            fillOpacity: isSelected ? 1.0 : 0.75,
            color: isSelected ? '#1c1c1e' : color,
            fillColor: color
        });

        if (isSelected) {
            marker.bringToFront();
        }
    }
}

function syncLaunchWindowSelection(slotIdx, skipRecalc) {
    _launchWindowLastSelectedIdx = slotIdx;
    updateLaunchWindowSlider(slotIdx);

    if (skipRecalc) return;
    if (_launchWindowUseEhimeProbability) return;

    if (_lwDebounceTimer) clearTimeout(_lwDebounceTimer);
    _lwDebounceTimer = setTimeout(function () {
        runEhimeAtSlot(slotIdx);
    }, 1000);
}

function handleLaunchWindowSelection(slotIdx) {
    syncLaunchWindowSelection(slotIdx, true);
    if (!_launchWindowUseEhimeProbability) {
        runEhimeAtSlot(slotIdx);
    }
}

// ============================================================
// 放球ウィンドウ分析 実行
// ============================================================

function runLaunchWindowAnalysis() {
    if (_launchWindowRunning) {
        if (typeof showToast === 'function') showToast('分析が実行中です', 'warning', 2000);
        return;
    }

    var settings      = getLaunchWindowSettings();
    var api_url       = getLaunchWindowApiUrl();
    var baseTimeUTC   = getLaunchWindowBaseTime();

    var INTERVAL_MIN  = 15;
    var MAX_HOURS     = 6;
    var totalSlots    = Math.floor((MAX_HOURS * 60) / INTERVAL_MIN) + 1; // 25
    var apiSource     = $('#api_source').val();
    // Local実行時はTawhiriが手元にあるため待機なしで回す
    var slotDelayMs   = (apiSource === 'local') ? 0 : 3000;

    // 状態を記録
    _launchWindowBaseTimeUTC = baseTimeUTC;
    _launchWindowApiUrl      = api_url;
    _launchWindowSettings    = settings;
    _launchWindowUseEhimeProbability = (apiSource === 'local');
    _launchWindowRunning     = true;
    _launchWindowResults     = [];
    clearLaunchWindowMarkers();

    // パネルを表示
    $('#launch_window_panel').show();
    $('#launch_window_progress').show();
    $('#launch_window_progress_text').text('0 / ' + totalSlots);
    $('#launch_window_progress_bar').css('width', '0%');
    $('#launch_window_slider').attr('max', totalSlots - 1).val(0);
    $('#launch_window_result_area').hide();
    $('#lw_ensemble_status').text('').hide();

    if (typeof showToast === 'function') {
        var intervalText = (slotDelayMs === 0) ? '高速実行' : '3秒間隔';
        var modeText = _launchWindowUseEhimeProbability ? '愛媛13バリアント海落ち確率モード' : 'BASE判定モード';
        showToast('放球ウィンドウ分析を開始 (' + totalSlots + 'スロット, ' + intervalText + ', ' + modeText + ')', 'info', 4000);
    }

    var currentSlot = 0;

    function processNextSlot() {
        if (currentSlot >= totalSlots) {
            // 全スロット完了
            _launchWindowRunning = false;
            $('#launch_window_progress_text').text(totalSlots + ' / ' + totalSlots + ' (完了)');
            $('#launch_window_progress_bar').css('width', '100%');
            $('#launch_window_result_area').show();
            updateLaunchWindowNGLine();
            // スライダーを0に戻してハイライト
            $('#launch_window_slider').val(0);
            syncLaunchWindowSelection(0, true);
            refreshLaunchWindowMarkerStyles(0);
            if (typeof showToast === 'function') {
                showToast('放球ウィンドウ分析完了', 'success', 4000);
            }
            // D4: 分析完了後に自動実行はせず、ユーザーの選択に任せる
            // 初期のBASE位置をハイライトするのみ
            return;
        }

        var offsetMin   = currentSlot * INTERVAL_MIN;
        var slotTimeUTC = baseTimeUTC.clone().add(offsetMin, 'minutes');
        var slotTimeJST = slotTimeUTC.clone().utcOffset(9 * 60).format('HH:mm');

        var slotSettings = JSON.parse(JSON.stringify(settings));
        slotSettings.launch_datetime = slotTimeUTC.format();

        // プログレス更新
        $('#launch_window_progress_text').text(currentSlot + ' / ' + totalSlots + ' (' + slotTimeJST + ' JST)');
        $('#launch_window_progress_bar').css('width', ((currentSlot / totalSlots) * 100) + '%');

        if (_launchWindowUseEhimeProbability) {
            evaluateEhimeProbabilityForSlot(slotSettings, api_url, function (ehimeProb) {
                var landingLat = ehimeProb.baseLanding ? ehimeProb.baseLanding.lat : settings.launch_latitude;
                var landingLng = ehimeProb.baseLanding ? ehimeProb.baseLanding.lng : settings.launch_longitude;

                var result = {
                    offsetMin: offsetMin,
                    launchTimeJST: slotTimeJST,
                    launchTimeUTC: slotTimeUTC.clone(),
                    landingLat: landingLat,
                    landingLng: landingLng,
                    isWater: ehimeProb.seaProbPct >= 50,
                    windSpeed: ehimeProb.baseWindSpeed || 0,
                    landProbPct: ehimeProb.landProbPct,
                    seaProbPct: ehimeProb.seaProbPct,
                    inlandWaterCount: ehimeProb.inlandWaterCount || 0,
                    unknownCount: ehimeProb.unknownCount || 0,
                    landSea: ehimeProb.baseLanding && ehimeProb.baseLanding.landSea || null,
                    variants: ehimeProb.variants || []
                };
                _launchWindowResults.push(result);
                plotLaunchWindowMarker(result, currentSlot);
                currentSlot++;
                setTimeout(processNextSlot, slotDelayMs);
            });
            return;
        }

        $.get(api_url, slotSettings)
            .done(function (data) {
                try {
                    var res = parsePrediction(data.prediction);
                    var landLat = res.landing.latlng.lat;
                    var landLng = res.landing.latlng.lng;
                    var windSpeed = calcSurfaceWindFromPrediction(data.prediction);

                    classifyLandingForLaunchWindow(landLat, landLng, function (isWater, landSeaResult) {
                        var result = {
                            offsetMin: offsetMin,
                            launchTimeJST: slotTimeJST,
                            launchTimeUTC: slotTimeUTC.clone(),
                            landingLat: landLat,
                            landingLng: landLng,
                            isWater: isWater,
                            landSea: landSeaResult,
                            windSpeed: windSpeed,
                            landProbPct: (isWater === false ? 100 : (isWater === true ? 0 : 100)),
                            seaProbPct: (isWater === true ? 100 : (isWater === false ? 0 : 0))
                        };
                        _launchWindowResults.push(result);
                        plotLaunchWindowMarker(result, currentSlot);
                        currentSlot++;
                        setTimeout(processNextSlot, slotDelayMs);
                    });
                } catch (e) {
                    appendDebug('Launch window slot ' + offsetMin + 'min error: ' + e);
                    currentSlot++;
                    setTimeout(processNextSlot, slotDelayMs);
                }
            })
            .fail(function () {
                appendDebug('Launch window slot ' + offsetMin + 'min failed.');
                currentSlot++;
                setTimeout(processNextSlot, slotDelayMs);
            });
    }

    processNextSlot();
}

// ============================================================
// 地表風速ヘルパー
// ============================================================

function calcSurfaceWindFromPrediction(tawhiriPrediction) {
    try {
        var surfaceSpeeds = [];
        tawhiriPrediction.forEach(function (stage) {
            for (var i = 1; i < stage.trajectory.length; i++) {
                var p0 = stage.trajectory[i - 1];
                var p1 = stage.trajectory[i];
                var t0 = moment.utc(p0.datetime);
                var t1 = moment.utc(p1.datetime);
                var dt = t1.diff(t0, 'seconds');
                if (dt <= 0) continue;
                var lon0 = p0.longitude > 180 ? p0.longitude - 360 : p0.longitude;
                var lon1 = p1.longitude > 180 ? p1.longitude - 360 : p1.longitude;
                var d = parseFloat(distHaversine(
                    L.latLng(p0.latitude, lon0), L.latLng(p1.latitude, lon1), 3
                ));
                var avgAlt = (p0.altitude + p1.altitude) / 2;
                if (avgAlt <= 500) {
                    surfaceSpeeds.push((d * 1000) / dt);
                }
            }
        });
        if (surfaceSpeeds.length === 0) return 0;
        var sum = 0;
        for (var j = 0; j < surfaceSpeeds.length; j++) sum += surfaceSpeeds[j];
        return sum / surfaceSpeeds.length;
    } catch (e) {
        return 0;
    }
}

// ============================================================
// スライダー → その時刻で13バリアント実行
// ============================================================

function runEhimeAtSlot(slotIdx) {
    if (_launchWindowUseEhimeProbability) {
        // localの放球NG判定は13バリアント確率で評価済みのため再計算しない
        if (_launchWindowResults.length > 0) {
            var localResult = _launchWindowResults[slotIdx];
            if (localResult) {
                var localTime = localResult.launchTimeUTC.clone().utcOffset(9 * 60);
                $('#year').val(localTime.year());
                $('#month').val(localTime.month() + 1);
                $('#day').val(localTime.date());
                $('#hour').val(localTime.hours());
                $('#min').val(localTime.minutes());
            }
        }
        updateLaunchWindowSlider(slotIdx);
        return;
    }

    if (_launchWindowResults.length === 0) return;
    var result = _launchWindowResults[slotIdx];
    if (!result) return;

    if (_lwEnsembleRunning) {
        if (typeof showToast === 'function') showToast('13バリアント実行中です。しばらく待ってください', 'warning', 2000);
        return;
    }

    // フォームの時刻をスライダーの時刻に書き換える
    var t = result.launchTimeUTC.clone().utcOffset(9 * 60);
    $('#year').val(t.year());
    $('#month').val(t.month() + 1);
    $('#day').val(t.date());
    $('#hour').val(t.hours());
    $('#min').val(t.minutes());

    $('#lw_ensemble_status').text('選択時刻 ' + result.launchTimeJST + ' JST で13バリアントを実行中...').show();

    _lwEnsembleRunning = true;

    // RESULTSタブへ切り替え (D4: 結果を見えるようにする)
    if (typeof switchTab === 'function') switchTab('results');

    // run13VariantEnsemble は pred-new.js で定義されている
    if (typeof run13VariantEnsemble === 'function') {
        var slotSettings = JSON.parse(JSON.stringify(_launchWindowSettings || {}));
        slotSettings.launch_datetime = result.launchTimeUTC.clone().format();
        slotSettings.pred_type = 'ensemble_13var';

        // 13バリアントを実行 (内部でフォームを読み直す)
        // D4: 地図上のアイテムクリア
        if (typeof clearMapItems === 'function') clearMapItems();
        
        run13VariantEnsemble(slotSettings, _launchWindowApiUrl || getLaunchWindowApiUrl());
        
        if (typeof showToast === 'function') {
            showToast(result.launchTimeJST + ' JST: 13バリアント実行開始', 'info', 3000);
        }
        
    } else {
        appendDebug('run13VariantEnsemble not available');
        _lwEnsembleRunning = false;
    }

    // UIの現在時刻を更新
    updateLaunchWindowSlider(slotIdx);
}

// ============================================================
// マーカー表示
// ============================================================

function plotLaunchWindowMarker(result, slotIdx) {
    var color = launchWindowLandSeaColor(result);

    var marker = L.circleMarker([result.landingLat, result.landingLng], {
        radius: 5,
        fillOpacity: 0.75,
        color: '#333',
        fillColor: color,
        weight: 1
    }).addTo(map);

    marker.setStyle({
        fillColor: getLaunchWindowMarkerFillColor(result),
        color: launchWindowLandSeaColor(result)
    });

    var landSeaText = launchWindowLandSeaLabel(result);
    var popupContent =
        '<b>+' + result.offsetMin + '分 (' + result.launchTimeJST + ' JST)</b><br>' +
        '着地: ' + result.landingLat.toFixed(4) + ', ' + result.landingLng.toFixed(4) + '<br>' +
        '判定: ' + landSeaText + '<br>' +
        '地表風速: ' + result.windSpeed.toFixed(1) + ' m/s<br>' +
        '<small>クリックでこの時刻の13バリアントを実行</small>';
    marker.bindPopup(popupContent);

    // マーカークリック → 13バリアント実行
    (function(idx) {
        marker.on('click', function() {
            $('#launch_window_slider').val(idx);
            handleLaunchWindowSelection(idx);
        });
    })(slotIdx);

    _launchWindowMarkers.push(marker);
}

function clearLaunchWindowMarkers() {
    for (var i = 0; i < _launchWindowMarkers.length; i++) {
        try { _launchWindowMarkers[i].remove(); } catch (_e) { if (typeof reportNonFatalError === 'function') reportNonFatalError(_e, 'non-fatal fallback'); }
    }
    _launchWindowMarkers = [];
    _launchWindowVariantMarkers.forEach(function(m) { map.removeLayer(m); });
    _launchWindowVariantMarkers = [];
    if (map_items && map_items['13var_hull']) {
        map.removeLayer(map_items['13var_hull']);
        delete map_items['13var_hull'];
    }
}

function clearLaunchWindow() {
    clearLaunchWindowMarkers();
    _launchWindowResults     = [];
    _launchWindowRunning     = false;
    _lwEnsembleRunning       = false;
    $('#launch_window_panel').hide();
    $('#launch_window_result_area').hide();
    $('#launch_window_progress').hide();
    $('#launch_window_ng_info').html('');
    $('#lw_ensemble_status').text('').hide();
}

// ============================================================
// スライダー UI 更新 (マーカーハイライトと13バリアントピン描画)
// ============================================================

var _launchWindowVariantMarkers = [];

function updateLaunchWindowSlider(slotIdx) {
    if (slotIdx >= _launchWindowResults.length) return;
    var result = _launchWindowResults[slotIdx];
    if (!result) return;

    var landSea      = launchWindowLandSeaLabel(result);
    var landSeaColor = launchWindowLandSeaColor(result);
    var probText = '';
    if (typeof result.landProbPct === 'number' && typeof result.seaProbPct === 'number') {
        probText = '<br>海落ち確率: <b style="color:blue;">' + result.seaProbPct.toFixed(0) + '%</b> / 陸落ち確率: <b style="color:#C62828;">' + result.landProbPct.toFixed(0) + '%</b>';
    }

    $('#launch_window_current_time').text('+' + result.offsetMin + '分 (' + result.launchTimeJST + ' JST)');
    $('#launch_window_current_result').html(
        '着地: ' + result.landingLat.toFixed(4) + ', ' + result.landingLng.toFixed(4) + '<br>' +
        '判定: <b style="color:' + landSeaColor + '">' + landSea + '</b>' +
        ' | 地表風速: <b>' + result.windSpeed.toFixed(1) + ' m/s</b>' +
        ' | 飛行時間: <b>' + (result.flightTimeStr || '-') + '</b>' +
        probText
    );
    $('#launch_window_result_area').show();
    refreshLaunchWindowMarkerStyles(slotIdx);

    updateLaunchWindowVariantSummary(result);

    map.panTo([result.landingLat, result.landingLng]);

    // 13バリアントのピンをクリアして再描画
    _launchWindowVariantMarkers.forEach(function(m) { map.removeLayer(m); });
    _launchWindowVariantMarkers = [];

    if (result.variants && result.variants.length > 0) {
        var variantColors = [
            '#e6194b', '#3cb44b', '#ffe119', '#4363d8', '#f58231',
            '#911eb4', '#42d4f4', '#f032e6', '#bfef45', '#fabed4',
            '#469990', '#dcbeff', '#9A6324'
        ];
        // 表も再生成
        $("#ehime_results_body").empty();
        $("#ehime_results_mobile").empty();

        result.variants.forEach(function(v, i) {
            var variantIndex = typeof v.index === 'number' ? v.index : i;
            var color = variantColors[variantIndex % variantColors.length];
            var m = L.circleMarker([v.lat, v.lng], {
                radius: v.label === 'BASE' ? 7 : 4,
                fillColor: color,
                color: '#333',
                weight: v.label === 'BASE' ? 2 : 1,
                fillOpacity: 0.85
            }).addTo(map);
            var variantClassification = launchWindowClassification(v);
            var landText = variantClassification === 'sea' ? '海 (Sea)' : (variantClassification === 'land' ? '陸 (Land)' : (variantClassification === 'inland_water' ? '内水面' : '不明'));
            m.bindPopup('<b>' + v.label + '</b><br>判定: ' + landText);
            _launchWindowVariantMarkers[variantIndex] = m;

            // 表への追加
            var landSeaFlag = v.isWater === true ? 'blue' : (v.isWater === false ? 'green' : 'gray');
            
            var rowHtml = '<tr id="ehime_row_' + variantIndex + '" data-variant-index="' + variantIndex + '">' +
                '<td>' + (variantIndex + 1) + '</td>' +
                '<td><span class="color-swatch" style="background:' + color + ';"></span></td>' +
                '<td><b>' + v.label + '</b></td>' +
                '<td>' + (v.desc || '') + '</td>' +
                '<td>' + v.lat.toFixed(4) + '</td>' +
                '<td>' + v.lng.toFixed(4) + '</td>' +
                '<td>' + (v.settings ? v.settings.ascent_rate.toFixed(1) : '-') + '</td>' +
                '<td>' + (v.settings ? v.settings.descent_rate.toFixed(1) : '-') + '</td>' +
                '<td>' + (v.settings ? v.settings.burst_altitude.toFixed(0) : '-') + '</td>' +
                '<td>' + (result.flightTimeStr || '-') + '</td>' +
                '<td><span class="badge-' + landSeaFlag + '">' + landText + '</span></td>' +
                '</tr>';
            $("#ehime_results_body").append(rowHtml);

            var baseClass = (variantIndex === 0) ? ' base' : '';
            var mobileCard = '<div class="ehime-card' + baseClass + '" id="ehime_card_' + variantIndex + '" data-variant-index="' + variantIndex + '">' +
                '<span class="swatch" style="background:' + color + ';"></span>' +
                '<span class="label">' + v.label + '</span> &mdash; ' + (v.desc || '') +
                '<div class="meta">' +
                '着地: ' + v.lat.toFixed(4) + ', ' + v.lng.toFixed(4) + '<br>' +
                '判定: <span class="badge-' + landSeaFlag + '">' + landText + '</span>' +
                '</div></div>';
            $("#ehime_results_mobile").append(mobileCard);

            bindLaunchWindowVariantInteractions(variantIndex);
        });
    }
}

// ============================================================
// NG判定ライン (テーブル)
// ============================================================

function updateLaunchWindowNGLine() {
    if (_launchWindowResults.length === 0) return;

    var ngStartMin = -1;
    var infoHtml = '<table style="width:100%; font-size:11px; border-collapse:collapse;">' +
        '<tr style="border-bottom:1px solid var(--border-color);"><th>時刻</th><th>海陸</th><th>風速(m/s)</th><th>海落ち確率</th><th>状態</th></tr>';

    for (var i = 0; i < _launchWindowResults.length; i++) {
        var r = _launchWindowResults[i];

        var landPct;
        if (typeof r.landProbPct === 'number') {
            landPct = r.landProbPct;
        } else {
            // 移動平均 (前後1スロット)
            var landCount = 0, total = 0;
            for (var j = Math.max(0, i - 1); j <= Math.min(_launchWindowResults.length - 1, i + 1); j++) {
                total++;
                if (_launchWindowResults[j].isWater === false) landCount++;
            }
            landPct = total > 0 ? (landCount / total) * 100 : 0;
        }

        var isNG = (landPct >= _launchWindowNGThreshold);
        if (isNG && ngStartMin < 0) ngStartMin = r.offsetMin;

        var landSeaText  = r.isWater === true ? '海' : r.isWater === false ? '陸' : '?';
        var landSeaColor = r.isWater === true ? 'blue' : r.isWater === false ? '#C62828' : 'gray';
        var statusText   = isNG ? 'NG' : 'OK';
        var statusColor  = isNG ? 'var(--color-danger)' : 'var(--color-success)';

        var seaProbText = (typeof r.seaProbPct === 'number')
            ? (r.seaProbPct.toFixed(0) + '%')
            : (r.isWater === true ? '100%' : (r.isWater === false ? '0%' : '-'));

        infoHtml +=
            '<tr style="cursor:pointer;" onclick="document.getElementById(\'launch_window_slider\').value=' + i + '; handleLaunchWindowSelection(' + i + ');">' +
            '<td>' + r.launchTimeJST + '</td>' +
            '<td style="color:' + landSeaColor + ';">' + landSeaText + '</td>' +
            '<td>' + r.windSpeed.toFixed(1) + '</td>' +
            '<td style="color:blue; font-weight:bold;">' + seaProbText + '</td>' +
            '<td style="color:' + statusColor + '; font-weight:bold;">' + statusText + '</td>' +
            '</tr>';
    }
    infoHtml += '</table>';
    $('#launch_window_ng_info').html(infoHtml);
    refreshLaunchWindowMarkerStyles(_launchWindowLastSelectedIdx);

    // サマリー
    if (ngStartMin >= 0) {
        var ngR = _launchWindowResults.find(function(r) { return r.offsetMin === ngStartMin; });
        $('#launch_window_ng_summary').html(
            '<span style="color:var(--color-danger); font-weight:bold;">放球NG: ' +
            (ngR ? ngR.launchTimeJST : '?') + ' JST 以降は放球NG (陸落ち率 ≥ ' + _launchWindowNGThreshold + '%)</span>'
        );
    } else {
        $('#launch_window_ng_summary').html(
            '<span style="color:var(--color-success); font-weight:bold;">放球可: 6時間以内は全て海上落下</span>'
        );
    }
}

// ============================================================
// 初期化
// ============================================================
window.AppShell.registerInitializer('launch-window', initLaunchWindowUI, 50);
