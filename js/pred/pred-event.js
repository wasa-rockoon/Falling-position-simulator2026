/*
 * CUSF Landing Prediction Version 2
 * Jon Sowman 2010
 * jon@hexoc.com
 * http://www.hexoc.com
 *
 * http://github.com/jonsowman/cusf-standalone-predictor
 *
 * This file contains the event handlers used in the predictor, which are
 * numerous. They are divided into functions that setup handlers for each
 * part of the predictor, and a calling function
 *
 */

function setupEventHandlers() {
    EH_LaunchCard();
    EH_BurstCalc();
    EH_NOTAMSettings();
    EH_ScenarioInfo();
    EH_LocationSave();

    // Tipsylink tooltip class activation
    $(".tipsyLink").tipsy({fade: true});

    // Add the onmove event handler to the map canvas
    map.on('mousemove', function(event) {
        showMousePos(event.latlng.wrap());
    });
}

function EH_BurstCalc() {
    $('#burst-calc-show').off('click.gasCalculator').on('click.gasCalculator', function (event) {
        event.preventDefault();
        if (window.GasCalculatorUI && typeof window.GasCalculatorUI.open === 'function') window.GasCalculatorUI.open();
    });
    $('#burst-calc-show').off('keydown.gasCalculator').on('keydown.gasCalculator', function (event) {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); $(this).trigger('click'); }
    });    $('#burst-calc-show').hover(
        function () { $('#ascent,#burst').css('background-color', '#AACCFF'); },
        function () { $('#ascent,#burst').css('background-color', ''); }
    );
}

function EH_NOTAMSettings() {
    // Activate the checkbox 
    $("#notam-display").click(function() {
        if (document.modelForm.notams.checked){
            if (kmlLayer == null) kmlLayer = new google.maps.KmlLayer('http://www.habhub.org/kml_testing/notam_and_restrict.kml', {preserveViewport: true});
            kmlLayer.setMap(map);
	}
	else {
	    kmlLayer.setMap(null);
	}
    });
    // Activate the "notam settings" links
    $("#notam-settings-show").click(function() {
        $("#notam-settings-wrapper").show();
    });
    $("#notam-settings-close").click(function() {
        // Close the notam settings doing anything
        $("#notam-settings-wrapper").hide();
        $("#modelForm").show();
    });
}

function EH_LaunchCard() {
    // Activate the "Set with Map" link
    $("#setWithClick").click(function() {
        setLatLonByClick(true);
    });
    $("#setWithClick,#req_open").hover(
        function() {
            $("#lat,#lon").css("background-color", "#AACCFF");
        },
        function() {
            $("#lat,#lon").css("background-color", "");
        });
    // Launch card parameter onchange event handlers
    $("#lat").change(function() {
        plotClick();
    });
    $("#lon").change(function() {
        plotClick();
    });

    $("#site").change(function() {
        changeLaunchSite();
    });
}

function EH_ScenarioInfo() {
    // RESULTS内タブと診断ログは ResultsWorkspace が一元管理する。
    $("#closeErrorWindow").click(function() {
        $("#error_window").fadeOut();
    });

    $("#about_window_show").click(function() {
        var isMobile = window.matchMedia && window.matchMedia('(max-width: 768px)').matches;
        var viewportW = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
        var viewportH = Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0);

        $("#about_window").dialog({
            modal: true,
            width: isMobile ? Math.min(viewportW - 16, 640) : 600,
            height: isMobile ? Math.max(320, viewportH - 24) : Math.max(420, $(document).height() - 200),
            maxHeight: isMobile ? Math.max(320, viewportH - 24) : undefined,
            draggable: !isMobile,
            resizable: false,
            closeOnEscape: true,
            position: { my: 'center top+8', at: 'center top', of: window },
            buttons: {
                "閉じる": function() {
                    $(this).dialog('close');
                }
            },
            open: function() {
                // モバイル時に閉じる操作が見切れないよう、本文側を確実にスクロール可能にする。
                $(this).css({ 'overflow-y': 'auto' });
            }
        });
    });

    // 落下位置一覧の表示/非表示トグル
    $("#toggle_pos_list").click(function () {
        var el = $("#pos_list_container");
        if (el.is(":visible")) {
            el.hide();
            $(this).text("落下位置一覧を表示");
        } else {
            el.show();
            $(this).text("落下位置一覧を非表示");
        }
    });

    // Coordinate format toggle (Decimal <-> DMS)
    $("#coord_format_toggle").click(function(){
        if(window.coordFormat === 'dd'){
            window.coordFormat = 'dms';
            $(this).text('10進法表示').attr('title','緯度経度表示を 60 進法 から 10 進法 に切替');
        } else {
            window.coordFormat = 'dd';
            $(this).text('60進法表示').attr('title','緯度経度表示を 10 進法 から 60 進法 に切替');
        }
        // 直ちに表示更新 (直前のマウス位置は不明なので map 中心座標を使用)
        if(window.map){
            var c = window.map.getCenter();
            showMousePos(c);
            if(typeof updateCoordinateFormat === 'function'){
                updateCoordinateFormat();
            }
        }
    });
}

function EH_LocationSave() {
    // Location saving to cookies event handlers
    $("#req_sub_btn").click(function() {
        saveLocationToCookie();
    });
    $("#cookieLocations").click(function() {
        appendDebug("User requested locally saved launch sites");
        if ( constructCookieLocationsTable("cusf_predictor") ) {
            $("#location_save_local").fadeIn();
        }
    });
    $("#req_open").click(function() {
            var lat = $("#lat").val();
            var lon = $("#lon").val();
            $("#req_lat").val(lat);
            $("#req_lon").val(lon);
            $("#req_alt").val($("#initial_alt").val());
            appendDebug("Trying to reverse geo-code the launch point");
            // No Leaflet geocode equivalent, so commenting this out for now.
            //rvGeocode(lat, lon, "req_name");
            $("#location_save").fadeIn();
    })
    $("#req_close").click(function() {
            $("#location_save").fadeOut();
    });
    $("#locations_close").click(function() {
            $("#location_save_local").fadeOut();
    });
}
