/* Tawhiri result processing, map rendering and prediction export bindings. */
function processTawhiriResults(data, settings, fall_only, requestContext) {
    // Process results from a Tawhiri run.

    if (data.hasOwnProperty('error')) {
        // The prediction API has returned an error.
        var apiError = new Error(data.error.description || "Predictor returned error");
        persistPredictionRunBoundary(requestContext, { status: 'failed', error: apiError });
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
            if (typeof updatePredictionCharts === 'function') {
                updatePredictionCharts(data.prediction, {
                    id: 'single',
                    label: settings.launch_site_name || settings.launchsite || '単発予測',
                    groupId: requestContext && requestContext.runId ? requestContext.runId : 'single'
                });
            }
            updatePredictionDerivedMetrics(data.prediction);
        } catch (_e) { if (typeof reportNonFatalError === 'function') reportNonFatalError(_e, 'prediction.charts'); }

        writePredictionInfo(settings, data.metadata, data.request, fall_only ? extended_results : null, requestContext);
        saveSinglePredictionResult(requestContext, extended_results);

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
    if (typeof PredictionRunner === 'undefined') throw new Error('PredictionRunner is unavailable');
    var normalized = PredictionRunner.normalizePrediction(prediction);
    function legacyPoint(point) {
        return { latlng: L.latLng([point.latitude, point.longitude, point.altitudeM]), datetime: moment.utc(point.timeUtc) };
    }
    return {
        flight_path: normalized.flightPath.map(function (point) { return [point.latitude, point.longitude, point.altitudeM]; }),
        flight_path_time: normalized.flightPath.map(function (point) { return { lat: point.latitude, lon: point.longitude, alt: point.altitudeM, datetime: moment.utc(point.timeUtc) }; }),
        launch: legacyPoint(normalized.launch),
        burst: legacyPoint(normalized.burst),
        landing: legacyPoint(normalized.landing),
        profile: normalized.profile,
        flight_time: normalized.flightTimeSec
    };
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
function writePredictionInfo(settings, metadata, request, fall_results, requestContext) {
    // populate the download links

    // Create the API URLs based on the current prediction settings
    if (fall_results) {
        if (typeof ExportService === 'undefined') throw new Error('ExportService is unavailable');
        var timedPoints = Array.isArray(fall_results.flight_path_time) ? fall_results.flight_path_time : fall_results.flight_path.map(function (point) {
            return { lat: point[0], lon: point[1], alt: point[2], datetime: null };
        });
        var trajectory = {
            id: 'fall-only',
            label: 'Fall Only Descent',
            points: timedPoints.map(function (point) {
                return {
                    latitude: point.lat,
                    longitude: point.lon,
                    altitudeM: point.alt,
                    timeUtc: point.datetime && typeof point.datetime.clone === 'function' ? point.datetime.clone().utc().format() : ''
                };
            })
        };
        var launchJst = fall_results.launch && fall_results.launch.datetime ? fall_results.launch.datetime.clone().utcOffset(9 * 60) : moment();
        var position = fall_results.launch && fall_results.launch.latlng || { lat: 0, lng: 0, alt: 0 };
        var filenameBase = 'FallOnly_' + launchJst.format('YYYYMMDD_HHmm') + 'JST_' + Math.abs(position.lat).toFixed(3) + (position.lat >= 0 ? 'N' : 'S') + '_' + Math.abs(position.lng).toFixed(3) + (position.lng >= 0 ? 'E' : 'W') + '_ALT' + Math.round(position.alt || 0) + 'm';
        $('#dlcsv').attr('href', '#').attr('download', filenameBase + '.csv').off('click.predictionExport').on('click.predictionExport', function (event) {
            event.preventDefault();
            ExportService.download(ExportService.trajectoryCsv(trajectory), filenameBase + '.csv', 'text/csv;charset=utf-8');
        });
        $('#dlkml').attr('href', '#').attr('download', filenameBase + '.kml').off('click.predictionExport').on('click.predictionExport', function (event) {
            event.preventDefault();
            ExportService.download(ExportService.trajectoryKml(trajectory, 'Fall Only Descent'), filenameBase + '.kml', 'application/vnd.google-earth.kml+xml;charset=utf-8');
        });
    } else {
        $('#dlcsv, #dlkml').off('click.predictionExport');
        _base_url = getPredictionRequestBaseUrl(requestContext) + "?" + $.param(settings)
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
