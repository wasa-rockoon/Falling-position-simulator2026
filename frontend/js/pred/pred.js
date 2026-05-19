/*
 * CUSF Landing Prediction Version 2
 * Jon Sowman 2010
 * jon@hexoc.com
 * http://www.hexoc.com
 *
 * Modified for Local Python Simulation Server (Tawhiri + OpenDrift)
 */

var map = null;
var map_items = {}; // 描画したマーカーや線を保存しておくためのオブジェクト

// This function runs when the document object model is fully populated
// and the page is loaded
$(document).ready(function() {
    // Initialise the map canvas with parameters (lat, long, zoom-level)
    initMap(-34.03, 138.66, 8);

    // Populate the launch site list from sites.json
    populateLaunchSite();

    // Setup all event handlers in the UI using jQuery
    setupEventHandlers();

    // Initialise UI elements such as draggable windows
    initUI();

    // Populate the launch card time/date fields
    initLaunchCard();
    
    // Read in URL parameters if provided, and run a prediction again.
    var params_provided = readURLParams();

    // Plot the initial launch location
    plotClick();

    // Initialise the burst calculator
    calc_init();

    // Run the prediction if it is provided in the URL.
    if(params_provided) {
        runPrediction();
    }
});

function readURLParams() {
    // Get current URL
    url = new URL(window.location.href);

    var params_provided = false;

    if(url.searchParams.has('launch_latitude')){
        $("#lat").val(url.searchParams.get('launch_latitude'));
    }
    if(url.searchParams.has('launch_longitude')){
        $("#lon").val(url.searchParams.get('launch_longitude'));
    }
    if(url.searchParams.has('launch_altitude')){
        $("#initial_alt").val(url.searchParams.get('launch_altitude'));
    }
    if(url.searchParams.has('ascent_rate')){
        $("#ascent").val(url.searchParams.get('ascent_rate'));
    }
    if(url.searchParams.has('descent_rate')){
        $("#drag").val(url.searchParams.get('descent_rate'));
    }
    if(url.searchParams.has('profile')){
        $("#flight_profile").val(url.searchParams.get('profile'));
    }
    if(url.searchParams.has('prediction_type')){
        $("#prediction_type").val(url.searchParams.get('prediction_type'));
    }
    if(url.searchParams.has('burst_altitude')){
        $("#burst").val(url.searchParams.get('burst_altitude'));
    }
    if(url.searchParams.has('float_altitude')){
        $("#burst").val(url.searchParams.get('float_altitude'));
    }

    if(url.searchParams.has('launch_datetime')){
        var launch_datetime = url.searchParams.get('launch_datetime');

        if(launch_datetime == "now"){
            launch_moment = moment.utc();
            time_was_now = true;
        } else {
            launch_moment = moment.utc(launch_datetime);
        }

        $("#min").val(launch_moment.minutes());
        $("#hour").val(launch_moment.hours());
        $("#day").val(launch_moment.date());
        $("#month").val(launch_moment.month()+1);
        $("#year").val(launch_moment.year());

        params_provided = true;
    }

    return params_provided;
}

// Add information to the hashstring of the current window
function addHashLink(link) {
   var ln = "#!/" + link;
   window.location = ln;
}

// Clear the Launch Site dropdown and repopulate it with the information from
// sites.json, as well as an "Other" option to open the saved locations window
function populateLaunchSite() {
    $("#site > option").remove();
    $.getJSON("sites.json", function(sites) {
        $.each(sites, function(sitename, site) {
            $("<option>").attr("value", sitename).text(sitename).appendTo("#site");
        });
        $("<option>").attr("value", "Other").text("Other").appendTo("#site");
        return true;
    });
    return true;
}

// The onchange handler for the launch locations dropdown menu, which opens
// the saved locations window if "Other" was chosen; sets the launch card
// lat/lon and plots the new launch location otherwise
function changeLaunchSite() {
    var selectedName = $("#site").val();
    if ( selectedName == "Other" ) {
        appendDebug("User requested locally saved launch sites");
        if ( constructCookieLocationsTable("cusf_predictor") ) {
            $("#location_save_local").fadeIn();
        }
    } else {
        $.getJSON("sites.json", function(sites) {
            $.each(sites, function(sitename, site) {
               if ( selectedName == sitename ) {
                    $("#lat").val(site.latitude);
                    $("#lon").val(site.longitude);
                    $("#initial_alt").val(site.altitude);
               }
            });
            plotClick();
        });
    }
}


// =============================================================================
// ローカルPythonサーバー (FastAPI) と通信するシミュレーション実行関数
// =============================================================================
function runPrediction() {
    if (typeof appendDebug === "function") appendDebug(null, 1); // clear debug window
    if (typeof appendDebug === "function") appendDebug("Sending request to local Python server...");
    
    // UIを「計算中」に変更
    $("#modelForm").find("input").attr("disabled", true);
    $("#error_window").fadeOut(250);
    $("#prediction_status").html("Predicting... (Copernicusデータ取得のため数分かかる場合があります)");
    $("#status_message").fadeIn(250);
    $("#input_form").hide("slide", { direction: "down" }, 500);
    $("#scenario_info").hide("slide", { direction: "up" }, 500);
    $("#map_canvas").fadeTo(1000, 0.2);

    // フォームから値を取得
    const lat = document.getElementById('lat').value;
    const lon = document.getElementById('lon').value;
    
    // 時刻の組み立て (ISO8601形式: YYYY-MM-DDTHH:mm:00Z)
    const year = document.getElementById('year').value;
    const month = document.getElementById('month').value.padStart(2, '0');
    const day = document.getElementById('day').value.padStart(2, '0');
    const hour = document.getElementById('hour').value.padStart(2, '0');
    const min = document.getElementById('min').value.padStart(2, '0');
    const timeISO = `${year}-${month}-${day}T${hour}:${min}:00Z`;

    const ascent = document.getElementById('ascent').value;
    const burst = document.getElementById('burst').value;
    const drag = document.getElementById('drag').value;
    
    // drift_hoursがHTMLになければデフォルト6時間にする
    const driftInput = document.getElementById('drift_hours');
    const driftHours = driftInput ? driftInput.value : 6;

    // Ocean drift toggle (default true)
    const driftCheckbox = document.getElementById('enable_drift');
    const oceanDrift = driftCheckbox ? (driftCheckbox.checked ? 'true' : 'false') : 'true';

    // APIベースURLは window.PREDICTOR_API_BASE があれば優先して使う。
    const apiBase = (typeof window.PREDICTOR_API_BASE === 'string' && window.PREDICTOR_API_BASE.trim() !== '')
        ? window.PREDICTOR_API_BASE.replace(/\/$/, '')
        : '';

    // ローカル/リモートのPython API URLを構築
    const apiUrl = `${apiBase}/api/simulate?lat=${lat}&lon=${lon}&time=${timeISO}&ascent_rate=${ascent}&burst_alt=${burst}&descent_rate=${drag}&hours=${driftHours}&ocean_drift=${oceanDrift}`;

    // APIを呼び出す
    fetch(apiUrl)
        .then(response => {
            if (!response.ok) throw new Error("サーバーエラーが発生しました");
            return response.text();
        })
        .then(csvText => {
            if (typeof appendDebug === "function") appendDebug("Got CSV response from local server, parsing...");
            $("#prediction_status").html("Prediction finished.");
            
            // CSVをパースして地図に描画
            parseCombinedCSV(csvText);
            
            // UIを元に戻す
            $("#status_message").fadeOut(250);
            $("#input_form").show("slide", { direction: "down" }, 500);
            $("#scenario_info").show("slide", { direction: "up" }, 500);
            $("#map_canvas").fadeTo(500, 1.0);
            $("#modelForm").find("input").attr("disabled", false);
        })
        .catch(error => {
            console.error(error);
            if (typeof appendDebug === "function") appendDebug("Error: " + error.message);
            $("#prediction_status").html("Error occurred.");
            $("#map_canvas").fadeTo(500, 1.0);
            $("#modelForm").find("input").attr("disabled", false);
            alert("エラーが発生しました。Pythonサーバーのコンソールを確認してください。\n" + error.message);
        });
}


// =============================================================================
// 気球と漂流の結合CSVをパースしてLeafletに描画する関数
// =============================================================================
function parseCombinedCSV(csvText) {
    const lines = csvText.trim().split('\n');
    if (lines.length <= 1) {
        if (typeof appendDebug === "function") appendDebug("The server returned an empty or invalid CSV file");
        return false;
    }

    // 古い描画アイテムは clearMapItems() で削除する。
    clearMapItems();

    let balloonPath = [];
    let driftPath = [];
    
    let launchPoint = null;
    let burstHeight = -1;
    let burstPoint = null;

    // ヘッダーを飛ばしてデータ行をループ (time, lat, lon, alt, type)
    for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].split(',');
        if (parts.length < 5) continue;
        
        const lat = parseFloat(parts[1]);
        const lon = parseFloat(parts[2]);
        const alt = parseFloat(parts[3]);
        const type = parts[4].trim();
        
        const point = L.latLng(lat, lon);

        if (type === 'balloon') {
            if (i === 1) launchPoint = point; // 最初の行が打ち上げ地点
            
            // バースト（最高高度）地点の記録
            if (alt > burstHeight) {
                burstHeight = alt;
                burstPoint = point;
            }
            balloonPath.push(point);
        } else if (type === 'drift_mean') {
            driftPath.push(point);
        }
    }

    if (typeof appendDebug === "function") appendDebug("Flight data parsed, creating Leaflet plot...");

    // 🎈 気球の軌道を赤線で描画
    const balloonPolyline = L.polyline(balloonPath, {
        color: '#FF0000',
        weight: 3,
        opacity: 0.8
    }).addTo(map);
    map_items['balloon_line'] = balloonPolyline;

    const bounds = L.latLngBounds();
    balloonPath.forEach(pt => bounds.extend(pt));

    // 🌊 漂流の軌道が存在すれば青線で描画
    if (driftPath.length > 0) {
        const splashPoint = balloonPath[balloonPath.length - 1];
        driftPath.unshift(splashPoint);

        const driftPolyline = L.polyline(driftPath, {
            color: '#0000FF',
            weight: 3,
            opacity: 0.8,
            dashArray: '8, 8'
        }).addTo(map);
        map_items['drift_line'] = driftPolyline;

        const splashMarker = L.marker(splashPoint, {
            title: '着水＆漂流開始地点'
        }).addTo(map);
        splashMarker.bindTooltip('着水＆漂流開始地点', {permanent: false, direction: 'right'});
        map_items['splash_marker'] = splashMarker;

        for (let i = 0; i < driftPath.length; i++) {
            bounds.extend(driftPath[i]);
        }
    } else {
        if (typeof appendDebug === "function") appendDebug("Warning: No drift data found. Landed on ground?");
    }

    if (launchPoint) {
        const launchMarker = L.circleMarker(launchPoint, {
            radius: 6,
            color: '#FF0000',
            fillColor: '#FF6666',
            fillOpacity: 1.0
        }).addTo(map);
        launchMarker.bindTooltip('Launch point', {permanent: false, direction: 'right'});
        map_items['launch_marker'] = launchMarker;
    }

    if (bounds.isValid()) {
        map.fitBounds(bounds.pad(0.05));
    } else if (balloonPath.length > 0) {
        map.setView(balloonPath[0], 8);
    }
    
    return true;
}


// =============================================================================
// Utility Functions
// =============================================================================

// Return the size of a given associative array
function getAssocSize(arr) {
    var i = 0;
    for ( j in arr ) {
        i++;
    }
    return i;
}

function POSIXtoHM(timestamp, include_day) {
    var ts = new Date(timestamp*1000);
    var s = "";
    var temp;

    function pad(s2, n) {
        s2 = String(s2);
        while (s2.length < n)
            s2 = "0" + s2;
        return s2;
    }

    s += pad(ts.getUTCHours(), 2);
    s += ":";
    s += pad(ts.getUTCMinutes(), 2);

    if (include_day) {
        s += " ";
        s += pad(ts.getUTCDate(), 2);
        s += "/";
        s += pad(ts.getUTCMonth() + 1, 2);
        s += "/";
        s += pad(ts.getUTCFullYear(), 2);
    }

    return s;
}

rad = function(x) {return x*Math.PI/180;}