
// Logic for overlaying real flight logs (CSV) onto the map for comparison

var log_overlay_layer = null;

function handleLogUpload(files) {
    if (files.length === 0) return;

    var file = files[0];
    var reader = new FileReader();

    reader.onload = function (e) {
        var text = e.target.result;
        processLogCSV(text);
    };

    reader.readAsText(file);
}

function processLogCSV(csvText) {
    var lines = csvText.split(/\r\n|\n/);
    var path = [];

    if (lines.length == 0) return;

    // Remove BOM if present
    if (lines[0].charCodeAt(0) === 0xFEFF) {
        lines[0] = lines[0].substring(1);
    }

    // Detect separator (comma, tab, semicolon, space)
    var separator = ',';
    if (lines[0].indexOf('\t') !== -1) separator = '\t';
    else if (lines[0].indexOf(',') === -1 && lines[0].indexOf(' ') !== -1) separator = ' ';

    // Helper to clean header string
    var clean = function (s) { return s.toLowerCase().trim().replace(/['"]/g, '').replace(/\ufeff/g, ''); };

    var rawHeader = lines[0].split(separator);
    var header = rawHeader.map(clean);

    console.log("[CSV Debug] Raw header: " + JSON.stringify(rawHeader));
    console.log("[CSV Debug] Cleaned header: " + JSON.stringify(header));
    console.log("[CSV Debug] Separator: '" + separator + "'");
    console.log("[CSV Debug] Total lines: " + lines.length);

    var latIdx = -1;
    var lonIdx = -1;
    var altIdx = -1;

    // Step 1: Try exact match first
    for (var i = 0; i < header.length; i++) {
        var h = header[i];
        // Exact matches for latitude
        if (latIdx === -1 && (h === 'lat' || h === 'latitude' || h === '緯度' ||
            h === 'c15_p4d_la' || h === 'c15_p4d_lat')) {
            latIdx = i;
        }
        // Exact matches for longitude
        if (lonIdx === -1 && (h === 'lon' || h === 'lng' || h === 'long' ||
            h === 'longitude' || h === '経度' || h === '经度' ||
            h === 'c15_p4d_lo' || h === 'c15_p4d_lon')) {
            lonIdx = i;
        }
        // Exact matches for altitude
        if (altIdx === -1 && (h === 'alt' || h === 'altitude' || h === 'height' ||
            h === '高度' || h === 'c15_p4d_al')) {
            altIdx = i;
        }
    }

    // Step 2: If exact match failed, try substring match
    if (latIdx === -1 || lonIdx === -1) {
        for (var i = 0; i < header.length; i++) {
            var h = header[i];
            if (latIdx === -1 && (h.indexOf('latitude') !== -1 || h.indexOf('緯度') !== -1)) latIdx = i;
            if (lonIdx === -1 && (h.indexOf('longitude') !== -1 || h.indexOf('経度') !== -1)) lonIdx = i;
        }
    }

    console.log("[CSV Debug] Header match result: latIdx=" + latIdx + ", lonIdx=" + lonIdx + ", altIdx=" + altIdx);

    var startRow = 0;
    if (latIdx !== -1 && lonIdx !== -1) {
        startRow = 1;
        console.log("[CSV Debug] Header detected successfully. Lat col=" + latIdx + " (" + rawHeader[latIdx] + "), Lon col=" + lonIdx + " (" + rawHeader[lonIdx] + ")");
    } else {
        // Fallback: scan data rows for numeric columns that look like coordinates
        console.log("[CSV Debug] Header detection failed. Using fallback heuristic.");

        // Look at a few data rows to find columns with coordinate-like values
        for (var r = 1; r < Math.min(lines.length, 20); r++) {
            var parts = lines[r].split(separator);
            if (parts.length < 2) continue;

            for (var c = 0; c < parts.length; c++) {
                var val = parts[c].trim();
                // Skip anything that looks like a date/time string
                if (val.indexOf(':') !== -1 || val.indexOf('-') !== -1 || val.indexOf('/') !== -1) continue;

                var num = parseFloat(val);
                if (isNaN(num) || num === 0) continue;

                // Found a plausible longitude (> 90)
                if (lonIdx === -1 && Math.abs(num) > 90 && Math.abs(num) <= 180) {
                    lonIdx = c;
                }
                // Found a plausible latitude (<= 90, not zero)
                if (latIdx === -1 && c !== lonIdx && Math.abs(num) > 0.1 && Math.abs(num) <= 90) {
                    latIdx = c;
                }
            }
            if (latIdx !== -1 && lonIdx !== -1) break;
        }

        if (latIdx === -1) latIdx = 0;
        if (lonIdx === -1) lonIdx = 1;
        console.log("[CSV Debug] Fallback result: latIdx=" + latIdx + ", lonIdx=" + lonIdx);
    }

    // === PASS 1: Collect all numerically valid coordinates ===
    var rawPoints = [];
    var skippedRange = 0;
    var skippedNaN = 0;

    for (var i = startRow; i < lines.length; i++) {
        var line = lines[i].trim();
        if (line === '') continue;

        var parts = line.split(separator);
        if (parts.length <= Math.max(latIdx, lonIdx)) continue;

        var lat = parseFloat(parts[latIdx]);
        var lon = parseFloat(parts[lonIdx]);

        if (isNaN(lat) || isNaN(lon)) { skippedNaN++; continue; }
        if (lat < -90 || lat > 90 || lon < -180 || lon > 360) { skippedRange++; continue; }

        // Normalize longitude
        if (lon > 180) lon -= 360;

        rawPoints.push([lat, lon]);
    }

    console.log("[CSV Debug] Pass 1: " + rawPoints.length + " raw points (NaN=" + skippedNaN + ", Range=" + skippedRange + ")");

    // === PASS 2: Outlier detection using median ===
    // GPS initialization artifacts produce coordinates far from the actual flight area.
    // We find the median lat/lon and reject anything more than 5 degrees away.
    var skippedOutlier = 0;

    if (rawPoints.length > 10) {
        // Extract lat and lon arrays and sort to find median
        var lats = rawPoints.map(function (p) { return p[0]; }).slice().sort(function (a, b) { return a - b; });
        var lons = rawPoints.map(function (p) { return p[1]; }).slice().sort(function (a, b) { return a - b; });

        var medianLat = lats[Math.floor(lats.length / 2)];
        var medianLon = lons[Math.floor(lons.length / 2)];

        console.log("[CSV Debug] Median: lat=" + medianLat + ", lon=" + medianLon);

        var OUTLIER_THRESHOLD = 5.0; // degrees

        for (var j = 0; j < rawPoints.length; j++) {
            var pt = rawPoints[j];
            if (Math.abs(pt[0] - medianLat) > OUTLIER_THRESHOLD || Math.abs(pt[1] - medianLon) > OUTLIER_THRESHOLD) {
                skippedOutlier++;
            } else {
                path.push(pt);
            }
        }
    } else {
        // Too few points, use all of them
        path = rawPoints;
    }

    console.log("[CSV Debug] Pass 2: " + path.length + " valid points, " + skippedOutlier + " outliers removed");
    if (path.length > 0) {
        console.log("[CSV Debug] First point: [" + path[0][0] + ", " + path[0][1] + "]");
        console.log("[CSV Debug] Last point: [" + path[path.length - 1][0] + ", " + path[path.length - 1][1] + "]");
    }

    if (path.length > 0) {
        drawLogOverlay(path);
        $("#clear_log_overlay").show();
        alert("実測ログを読み込みました (" + path.length + " points)\nLatCol=" + latIdx + ", LonCol=" + lonIdx + "\n外れ値除外: " + skippedOutlier);
    } else {
        alert("有効な座標データが見つかりませんでした。\n解析モード: Sep='" + separator + "', LatCol=" + latIdx + ", LonCol=" + lonIdx + "\nヘッダー: " + JSON.stringify(header) + "\nスキップ: NaN=" + skippedNaN + ", Range=" + skippedRange);
    }
}

function drawLogOverlay(latlngs) {
    if (log_overlay_layer) {
        map.removeLayer(log_overlay_layer);
    }

    log_overlay_layer = L.polyline(latlngs, {
        color: '#0066FF',
        weight: 3,
        opacity: 0.8,
        dashArray: '5, 10' // Dashed line to distinguish from prediction
    }).addTo(map);

    var bounds = log_overlay_layer.getBounds();
    console.log("[CSV Debug] Polyline bounds: SW=" + bounds.getSouthWest().toString() + ", NE=" + bounds.getNorthEast().toString());
    map.fitBounds(bounds, { maxZoom: 14 });
    console.log("[CSV Debug] Map center after fitBounds: " + map.getCenter().toString() + ", zoom: " + map.getZoom());
}

function clearLogOverlay() {
    if (log_overlay_layer) {
        map.removeLayer(log_overlay_layer);
        log_overlay_layer = null;
    }
    $("#log_file_input").val("");
    $("#clear_log_overlay").hide();
}
