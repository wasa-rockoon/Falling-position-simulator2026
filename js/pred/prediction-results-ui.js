/* Prediction result history, land/sea UI and recovery-port helpers. */
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

    classifyLandSeaAt(lat, lon, function (isWater, landSeaResult) {
        if (typeof updateLandSeaUI === 'function') updateLandSeaUI(isWater, rowId, landSeaResult);
    });
}

function updateLandSeaUI(isWater, rowId, landSeaResult) {
    var classification = landSeaResult && landSeaResult.classification;
    var label = '不明 (Unknown)';
    var shortLabel = '不明';
    var color = 'gray';
    if (classification === 'inland_water') {
        label = '内水面 (Inland water)';
        shortLabel = '内水面';
        color = '#7b61a8';
    } else if (isWater === true) {
        label = '海 (Sea)';
        shortLabel = '海';
        color = 'blue';
    } else if (isWater === false) {
        label = '陸 (Land)';
        shortLabel = '陸';
        color = 'green';
    }
    $("#landing_type").text(label).css("color", color);
    if (rowId) $("#land_sea_" + rowId).text(shortLabel).css("color", color);
}

function classifyLandSeaAt(lat, lon, callback) {
    var landSeaResult = localLandSeaResult(lat, lon);
    var isWater = landSeaResult.classification === 'sea'
        ? true
        : (landSeaResult.classification === 'land' ? false : null);
    callback(isWater, landSeaResult);
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

var _predNewExtensionsInitialized = false;
function initPredNewExtensions() {
    if (_predNewExtensionsInitialized) return;
    _predNewExtensionsInitialized = true;
    renderEhimeHistoryPanel();
    if (typeof RunRepository !== 'undefined' && typeof loadEhimeHistoryCache === 'function') {
        RunRepository.migrateLegacyEhime(loadEhimeHistoryCache()).catch(function (error) {
            if (typeof reportNonFatalError === 'function') reportNonFatalError(error, 'ehime-history.migration');
        });
    }
    $('#prediction_type').off('change.predNewFall').on('change.predNewFall', updateFallModeUI);
    updateFallModeUI();
    bindPanToCenterLink();
    if (typeof loadFishingPortData === 'function') loadFishingPortData();
}
window.AppShell.registerInitializer('prediction-extensions', initPredNewExtensions, 30);
