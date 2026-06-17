/*
 * CUSF Landing Prediction Version 2
 * Jon Sowman 2010
 * jon@hexoc.com
 * http://www.hexoc.com
 *
 * http://github.com/jonsowman/cusf-standalone-predictor
 *
 * This file contains all of the prediction javascript functions
 * that are explicitly related to Google Map manipulation
 *
 */

// Initialise the map canvas with (lat, long, zoom)
function initMap(centre_lat, centre_lon, zoom_level) {
    //
    // LEAFLET MAP SETUP
    //
    // Setup a basic Leaflet map
    // Default coordinate format state (decimal degrees)
    if(!window.coordFormat){ window.coordFormat = 'dd'; }
    map = L.map('map_canvas').setView([centre_lat, centre_lon], zoom_level);

    // Add OSM Map Layer
    var osm_map = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);

    // Open Topo
    var osm_topo_map = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://wiki.openstreetmap.org/wiki/OpenTopoMap">OpenTopoMap</a> contributors'
    });

    // Add ESRI Satellite Map layers.
    var esrimapLink = 
    '<a href="http://www.esri.com/">Esri</a>';
    var esriwholink = 
    'i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community';
    var esri_sat_map = L.tileLayer(
    'http://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', 
    {
        attribution: '&copy; '+esrimapLink+', '+esriwholink,
        maxZoom: 18,
    });

    var map_layers = {'OSM':osm_map, 'ESRI Satellite':esri_sat_map, 'OpenTopoMap':osm_topo_map};

    map.addControl(new L.Control.Layers(map_layers, null, {position: 'topleft'}));

    // Map scale
    L.control.scale({imperial: false, metric: true}).addTo(map);


}

// Convert decimal degrees to Degrees Minutes Seconds string
function decToDMS(dec, type){
    var d = Math.floor(Math.abs(dec));
    var minFloat = (Math.abs(dec) - d) * 60;
    var m = Math.floor(minFloat);
    var secFloat = (minFloat - m) * 60;
    var s = secFloat.toFixed(1); // 0.1 秒まで
    if(s === '60.0'){ s = '0.0'; m += 1; }
    if(m === 60){ m = 0; d += 1; }
    var hemi = '';
    if(type === 'lat') hemi = dec >= 0 ? 'N' : 'S';
    else if(type === 'lon') hemi = dec >= 0 ? 'E' : 'W';
    return d + '°' + m + "'" + s + '"' + hemi;
}

// Enable or disable user control of the map canvas, including scrolling,
// zooming and clicking
function enableMap(map, state) {
    if ( state != false && state != true) {
        appendDebug("Unrecognised map state");
    } else if (state == false) {
        map.draggable = false;
        map.disableDoubleClickZoom = true;
        map.scrollwheel = false;
        map.navigationControl = false;
    } else if (state == true ) {
        map.draggable = true;
        map.disableDoubleClickZoom = false;
        map.scrollwheel = false;
        map.navigationControl = true;
    }
}

// This should be called on a "mousemove" event handler on the map canvas
// and will update scenario information display
function showMousePos(LatLng) {
    var curr_lat = LatLng.lat;
    var curr_lon = LatLng.lng;
    if(window.coordFormat && window.coordFormat === 'dms'){
        $("#cursor_lat").html(decToDMS(curr_lat, 'lat'));
        $("#cursor_lon").html(decToDMS(curr_lon, 'lon'));
    } else {
        $("#cursor_lat").html(curr_lat.toFixed(4));
        $("#cursor_lon").html(curr_lon.toFixed(4));
    }
    // if we have a prediction displayed
    // show range from launch and land:
    if ( (map_items['launch_marker'] != null) && (hourly_mode == false)) {
        var launch_pt = map_items['launch_marker'].getLatLng();
        var land_pt = map_items['land_marker'].getLatLng();
        var range_launch = distHaversine(launch_pt, LatLng, 1);
        var range_land = distHaversine(land_pt, LatLng, 1);
        $("#cursor_pred_launchrange").html(range_launch);
        $("#cursor_pred_landrange").html(range_land);
    }
    
}

// Helper: format single coordinate according to current format
function formatCoord(value, type){
    if(window.coordFormat === 'dms'){
        return decToDMS(value, type);
    }
    return value.toFixed(4);
}

// Helper: format pair like (lat, lon)
function formatCoordPair(lat, lon){
    return '('+formatCoord(lat,'lat')+', '+formatCoord(lon,'lon')+')';
}

// Update titles / tooltips of existing markers to reflect format change
function updateCoordinateFormat(){
    // Click marker (launch selection before prediction)
    if(typeof clickMarker !== 'undefined' && clickMarker){
        try {
            var ll = clickMarker.getLatLng ? clickMarker.getLatLng() : null;
            if(ll){
                var t = 'Currently selected launch location ' + formatCoordPair(ll.lat, ll.lng);
                clickMarker.options.title = t;
                if(clickMarker._tooltip){ clickMarker.setTooltipContent(t); }
            }
        } catch(e){}
    }
    // Prediction markers stored in map_items
    if(typeof map_items !== 'undefined'){
        ['launch_marker','land_marker','pop_marker'].forEach(function(key){
            var mk = map_items[key];
            if(!mk) return;
            try {
                var lat, lon;
                if(mk.getLatLng){ // Leaflet
                    var ll2 = mk.getLatLng();
                    lat = ll2.lat; lon = ll2.lng;
                } else if(mk.getPosition){ // Google Maps v3 style
                    var gp = mk.getPosition();
                    lat = gp.lat(); lon = gp.lng();
                } else if(mk.position){ // Fallback
                    lat = mk.position.lat(); lon = mk.position.lng();
                }
                if(lat !== undefined){
                    var baseTitle;
                    if(key === 'launch_marker') baseTitle = '離陸地点 ';
                    else if(key === 'land_marker') baseTitle = '予測着地点 ';
                    else if(key === 'pop_marker') baseTitle = 'バースト ';
                    // Attempt to extract existing time text after )
                    var extra = '';
                    if(mk.options && mk.options.title){
                        var idx = mk.options.title.indexOf(')');
                        if(idx !== -1){ extra = mk.options.title.substring(idx+1); }
                    } else if(mk.getTitle){
                        var ot = mk.getTitle();
                        if(ot){
                            var idx2 = ot.indexOf(')');
                            if(idx2 !== -1){ extra = ot.substring(idx2+1); }
                        }
                    }
                    var newTitle = baseTitle + formatCoordPair(lat, lon) + (extra || '');
                    if(mk.setTitle) mk.setTitle(newTitle); // Google
                    if(mk.options){ mk.options.title = newTitle; }
                    if(mk._tooltip){ mk.setTooltipContent(newTitle); }
                }
            } catch(e){}
        });
    }
    // Ehime variant markers
    if(typeof ehime_predictions !== 'undefined' && ehime_predictions){
        for(var k in ehime_predictions){
            var ep = ehime_predictions[k];
            if(!ep || !ep.marker) continue;
            try {
                var llv = ep.marker.getLatLng ? ep.marker.getLatLng() : null;
                if(llv){
                    var title = (ep.label ? ep.label + ' ' : '') + formatCoordPair(llv.lat, llv.lng);
                    ep.marker.options.title = title;
                    if(ep.marker._tooltip){ ep.marker.setTooltipContent(title); }
                }
            } catch(e){}
        }
    }
    // Update popup coordinate lines (landing, burst, etc.)
    if(typeof updateAllPopups === 'function'){
        updateAllPopups();
    }
}

function updateAllPopups(){
    function rewritePopup(marker){
        if(!marker || !marker.getLatLng || !marker.getPopup) return;
        var pop = marker.getPopup();
        if(!pop) return;
        var ll = marker.getLatLng();
        var latStr = formatCoord(ll.lat,'lat');
        var lonStr = formatCoord(ll.lng,'lon');
        var content = pop.getContent();
        if(!content) return;

        var isElem = (typeof content === 'object' && content.nodeType);
        var html = isElem ? content.innerHTML : content;
        if(typeof html !== 'string') return;

        var labels = ['着地点:','位置:','緯度経度:','<b>予測着地点:</b>'];
        labels.forEach(function(label){
            var idx = html.indexOf(label);
            if(idx !== -1){
                var start = idx + label.length;
                var end = html.indexOf('<', start);
                if(end === -1) end = html.length;
                var replacement = label + ' ' + latStr + ', ' + lonStr;
                html = html.substring(0, idx) + replacement + html.substring(end);
            }
        });
        try {
            var baseIdx = html.indexOf('BASE着地点:');
            if(baseIdx !== -1 && typeof ehime_predictions !== 'undefined' && ehime_predictions){
                var baseLL = null;
                for(var k in ehime_predictions){
                    var ep = ehime_predictions[k];
                    if(ep && ep.label === 'BASE' && ep.results && ep.results.landing){ baseLL = ep.results.landing.latlng; break; }
                }
                var startB = baseIdx + 'BASE着地点:'.length;
                var endB = html.indexOf('<', startB);
                if(endB === -1) endB = html.length;
                var repB = 'BASE着地点: ';
                if(baseLL){
                    repB += formatCoord(baseLL.lat,'lat') + ', ' + formatCoord(baseLL.lng,'lon');
                } else { repB += '-'; }
                html = html.substring(0, baseIdx) + repB + html.substring(endB);
            }
        } catch(e){}

        if(isElem){
            content.innerHTML = html;
        } else {
            pop.setContent(html);
        }
        
        if(pop.isOpen && pop.isOpen()){
            marker.closePopup();
            marker.bindPopup(pop).openPopup();
        } else {
            marker.bindPopup(pop);
        }
    }
    // Standard map_items markers
    if(typeof map_items !== 'undefined'){
        ['land_marker','pop_marker','launch_marker'].forEach(function(k){ rewritePopup(map_items[k]); });
    }
    // Ehime variant markers
    if(typeof ehime_predictions !== 'undefined' && ehime_predictions){
        for(var k in ehime_predictions){
            rewritePopup(ehime_predictions[k].marker);
            // If variant has layers with launch/burst markers
            var layers = ehime_predictions[k].layers;
            if(layers){ rewritePopup(layers.launch_marker); rewritePopup(layers.burst_marker); }
        }
    }
    // Hourly landing markers
    if(typeof hourly_predictions !== 'undefined' && hourly_predictions){
        for(var h in hourly_predictions){
            var layers = hourly_predictions[h].layers;
            if(layers && layers.landing_marker){ rewritePopup(layers.landing_marker); }
        }
    }
}

// Read the latitude and longitude currently in the launch card and plot
// a marker there with hover information
function plotClick() {
    // Clear the old marker
    clearMapItems();
    // Get the new values from the form
    click_lat = parseFloat($("#lat").val());
    click_lon = parseFloat($("#lon").val());
    // Make sure the data is valid before we try and do anything with it
    if ( isNaN(click_lat) || isNaN(click_lon) ) return;
    var click_pt = new L.LatLng(click_lat, click_lon);

    // var launch_icon = new google.maps.MarkerImage(launch_img,
    //     new google.maps.Size(10, 10),
    //     new google.maps.Point(0, 0),
    //     new google.maps.Point(5, 5)
    // );

    launch_icon = L.icon({
        iconUrl: launch_img,
        iconSize: [10,10],
        iconAnchor: [5,5]
    });

    clickIconTitle = 'Currently selected launch location ' + formatCoordPair(click_lat, click_lon);

    clickMarker = L.marker(click_pt,{ title:clickIconTitle, icon: launch_icon })
        .bindTooltip(clickIconTitle,{permanent:false,direction:'right'})
        .addTo(map);

    map_items['clickMarker'] = clickMarker;
    map.setView(click_pt, 8);
}

// Given a GLatLng object, write the latitude and longitude to the launch card
function setFormLatLon(LatLng) {
    appendDebug("Trying to set the form lat long");
    $("#lat").val(LatLng.lat.toFixed(4));
    $("#lon").val(LatLng.lng.toFixed(4));
    // Remove the event handler so another click doesn't register
    setLatLonByClick(false);
    // Change the dropdown to read "other"
    SetSiteOther();
    // Plot the new marker for launch location
    appendDebug("Plotting the new launch location marker");
    plotClick();
}

// Enable or disable an event handler which, when a mouse click is detected
// on the map canvas, will write the coordinates of the clicked place to the
// launch card
function setLatLonByClick(state) {
    if ( state == true ) {
        // Check this listener doesn't already exist
        if (!clickListener) {
            appendDebug("Enabling the set with click listener");
            clickListener = map.on('click', function(event) {
                appendDebug("Got a click from user, setting values into form");
                $("#error_window").fadeOut();
                setFormLatLon(event.latlng);
            });
        }
        // Tell the user what to do next
        throwError("Now click your desired launch location on the map");
    } else if ( state == false ) {
        appendDebug("Removing the set with click listener");
        map.off('click',clickListener);
        clickListener = null;
    } else {
        appendDebug("Unrecognised state for setLatLonByClick");
    }
}

// An associative array exists globally containing all objects we have placed
// onto the map canvas - this function clears all of them
function clearMapItems() {
    cursorPredHide();
    if( getAssocSize(map_items) > 0 ) {
        appendDebug("Clearing previous map trace");
        for( i in map_items ) {
            try {
                var item = map_items[i];
                if (!item) continue;
                if (Array.isArray(item)) {
                    item.forEach(function (layer) {
                        if (!layer) return;
                        if (typeof layer.remove === 'function') {
                            layer.remove();
                        } else if (map && typeof map.removeLayer === 'function') {
                            try { map.removeLayer(layer); } catch (_e) {}
                        }
                    });
                    continue;
                }
                if (typeof item.remove === 'function') {
                    item.remove();
                } else if (map && typeof map.removeLayer === 'function') {
                    try { map.removeLayer(item); } catch (_e2) {}
                }
            } catch (_err) {}
        }
    }
    map_items = [];

    // Clear hourly prediction data too
    if( getAssocSize(hourly_predictions) > 0 ) {
        appendDebug("Clearing hourly prediction data.");
        for( i in hourly_predictions) {
            for (j in hourly_predictions[i]['layers']){
                try {
                    if (hourly_predictions[i]['layers'][j] && typeof hourly_predictions[i]['layers'][j].remove === 'function') {
                        hourly_predictions[i]['layers'][j].remove();
                    } else if (map && typeof map.removeLayer === 'function') {
                        map.removeLayer(hourly_predictions[i]['layers'][j]);
                    }
                } catch (_e3) {}
            }
        }
    }

    if(hourly_polyline){
        try {
            if (typeof hourly_polyline.remove === 'function') hourly_polyline.remove();
            else if (map && typeof map.removeLayer === 'function') map.removeLayer(hourly_polyline);
        } catch (_e4) {}
        hourly_polyline = null;
    }

    // Clear Ehime variant markers if present
    if(typeof ehime_predictions !== 'undefined' && ehime_predictions){
        for (var k in ehime_predictions){
            var ep = ehime_predictions[k];
            if(ep){
                // メイン着地マーカー
                if(ep.marker){ try { ep.marker.remove(); } catch(e) {} }
                // 経路/発射/破裂など一時レイヤ (toggleEhimeVariantPath で生成)
                if(ep.layers){
                    try {
                        if(ep.layers.flight_path && ep.layers.flight_path.remove) ep.layers.flight_path.remove();
                        else if (map && typeof map.removeLayer === 'function') map.removeLayer(ep.layers.flight_path);
                        if(ep.layers.launch_marker && ep.layers.launch_marker.remove) ep.layers.launch_marker.remove();
                        else if (map && typeof map.removeLayer === 'function') map.removeLayer(ep.layers.launch_marker);
                        if(ep.layers.burst_marker && ep.layers.burst_marker.remove) ep.layers.burst_marker.remove();
                        else if (map && typeof map.removeLayer === 'function') map.removeLayer(ep.layers.burst_marker);
                    } catch(_e){}
                    // 参照クリア
                    delete ep.layers.flight_path;
                    delete ep.layers.launch_marker;
                    delete ep.layers.burst_marker;
                }
            }
        }
        if(typeof ehime_variant_total !== 'undefined'){
            ehime_predictions = {};
            ehime_variant_total = 0;
            // Reset info row if it exists
            if(document.getElementById('ehime_completed')){
                $('#ehime_completed').text('0');
                $('#ehime_total').text('0');
                $('#ehime_mean').text('-');
                $('#ehime_max_dev').text('-');
                $('#ehime_dlcsv').hide();
            }
        }
    }
    // Intentionally do not clear landing_history_markers here so that past
    // landing markers persist on the map between predictions.
}

// The Haversine formula to calculate the distance across the surface between
// two points on the Earth
distHaversine = function(p1, p2, precision) {
  var R = 6371; // earth's mean radius in km
  var dLat  = rad(p2.lat - p1.lat);
  var dLong = rad(p2.lng - p1.lng);

  var a = Math.sin(dLat/2) * Math.sin(dLat/2) +
          Math.cos(rad(p1.lat)) * Math.cos(rad(p2.lat)) * Math.sin(dLong/2) * Math.sin(dLong/2);
  var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  var d = R * c;
  if ( precision == null ) {
      return d.toFixed(3);
  } else {
      return d.toFixed(precision);
  }
}


// MJ: Commented out until we can find an equivalent geocoding API.
// Given a latitude, longitude, and a field to write the result to,
// find the name of the place using Google "reverse Geocode" API feature
// function rvGeocode(lat, lon, fillField) {
//     var geocoder = new google.maps.Geocoder();
//     var latlng = new google.maps.LatLng(parseFloat(lat), parseFloat(lon));
//     var coded = "Unnamed";
//     geocoder.geocode({'latLng': latlng}, function(results, status) {
//         if ( status == google.maps.GeocoderStatus.OK ) {
//             // Successfully got rv-geocode information
//             appendDebug("Got a good response from the geocode server");
//             coded = results[1].address_components[1].short_name;
//         } else {
//             appendDebug("The rv-geocode failed: " + status);
//         }
//         // Now write the value to the field
//         $("#"+fillField+"").val(coded);
//     });
// }
