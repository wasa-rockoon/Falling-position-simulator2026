/* Hourly and daily prediction result controller. */
function processHourlyTawhiriResults(data, settings, current_hour, requestContext) {
    // Process results from a Tawhiri run.

    if (data.hasOwnProperty('error')) {
        // The prediction API has returned an error.
        var apiError = new Error(data.error.description || "Predictor returned error");
        persistPredictionRunBoundary(requestContext, { status: 'failed', error: apiError });
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

    var _base_url = getPredictionRequestBaseUrl(requestContext) + "?" + $.param(hourly_predictions[current_hour]['settings'])
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
