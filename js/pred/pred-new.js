/*
 * CUSF Landing Prediction Version 3
 * Mark Jessop 2019
 * vk5qi@rfhead.net
 *
 * http://github.com/jonsowman/cusf-standalone-predictor
 *
 */


function initLaunchCard(){
    // Initialise the time/date on the launch card.

    // var today = new Date();

    // $('#year').val(today.getFullYear());
    // $('#day').val(today.getDate());
    // var month = today.getMonth()+1;
    // $("#month").val(month).change();
    // $('#hour').val(today.getHours());
    // $('#min').val(today.getMinutes());
    // $('#sec').val(today.getSeconds());

    // Use local JST (UTC+9) for display, but keep backend in UTC.
    var todayUtc = moment.utc();
    var todayJst = todayUtc.clone().utcOffset(9 * 60); // JST offset +09:00

    // Always refresh to current JST when page (re)loads unless URL params override later.
    $('#year').val(todayJst.year());
    $('#day').val(todayJst.date());
    var month = todayJst.month()+1;
    $("#month").val(month).change();
    $('#hour').val(todayJst.hours());
    $('#min').val(todayJst.minutes());
}

function resolveTawhiriApiUrl(){
    var apiSourceEl = $('#api_source');
    var customUrlEl = $('#api_custom_url');
    if(!apiSourceEl.length){
        return "https://api.v2.sondehub.org/tawhiri";
    }

    var source = apiSourceEl.val() || 'sondehub';
    if(source === 'local'){
        return '/api/v1/';
    }

    if(source === 'custom'){
        var customUrl = (customUrlEl.val() || '').trim();
        if(!customUrl){
            throwError('カスタムAPI URLを入力してください。');
            return null;
        }
        return customUrl;
    }

    return "https://api.v2.sondehub.org/tawhiri";
}

function toggleCustomApiInput(){
    var source = $('#api_source').val();
    var input = $('#api_custom_url');
    if(!input.length){
        return;
    }
    if(source === 'custom'){
        input.show();
    } else {
        input.hide();
    }
}

function requestPredictionWithApiValidation(run_settings, extra_settings, requestedSource){
    // local選択時のみ、2026用プロキシ配信かを確認してから実行する。
    // 条件を満たさない場合はSondeHubへ自動フォールバックする。
    if(requestedSource !== 'local'){
        tawhiriRequest(run_settings, extra_settings);
        return;
    }

    $.getJSON('/__server-info')
        .done(function(info){
            if(info && info.app === 'Falling-position-simulator2026'){
                tawhiriRequest(run_settings, extra_settings);
                return;
            }

            $('#api_source').val('sondehub');
            toggleCustomApiInput();
            tawhiri_api = 'https://api.v2.sondehub.org/tawhiri';
            try {
                var u1 = new URL(window.location.href);
                u1.searchParams.set('api_source', 'sondehub');
                u1.searchParams.delete('api_custom_url');
                history.replaceState({}, 'CUSF / SondeHub Predictor', u1.href);
            } catch(_e1) {}
            appendDebug('Localhost接続を検証できなかったためSondeHubへ切替');
            throwError('Localhost接続には2026のcors-proxy経由が必要です。SondeHubへ自動切替しました。');
            tawhiriRequest(run_settings, extra_settings);
        })
        .fail(function(){
            $('#api_source').val('sondehub');
            toggleCustomApiInput();
            tawhiri_api = 'https://api.v2.sondehub.org/tawhiri';
            try {
                var u2 = new URL(window.location.href);
                u2.searchParams.set('api_source', 'sondehub');
                u2.searchParams.delete('api_custom_url');
                history.replaceState({}, 'CUSF / SondeHub Predictor', u2.href);
            } catch(_e2) {}
            appendDebug('Localhost接続検証に失敗したためSondeHubへ切替');
            throwError('Localhost接続には2026のcors-proxy経由が必要です。SondeHubへ自動切替しました。');
            tawhiriRequest(run_settings, extra_settings);
        });
}

function shouldValidateSondeHubTimeWindow(apiSource){
    // SondeHub公開APIの運用レンジに合わせて時刻制限を適用する。
    // local/customは過去データ再現用途があるため、ここでは制限しない。
    return apiSource === 'sondehub';
}


function runPrediction(){
    // Read the user-supplied parameters and request a prediction.
    $('#error_window').hide();

    if (typeof validateAllFields === 'function' && !validateAllFields()) {
        throwError('入力値に不正があります。赤字の項目を修正してください。');
        if (typeof showToast === 'function') {
            showToast('入力値を確認してください', 'warning', 2200);
        }
        return;
    }
    if (typeof saveLastSettings === 'function') {
        saveLastSettings();
    }

    // Always clear previous prediction artifacts first.
    clearMapItems();
    var run_settings = {};
    var extra_settings = {};
    run_settings.profile = $('#flight_profile').val();
    run_settings.pred_type = $('#prediction_type').val();
    var requestedApiSource = $('#api_source').val() || 'sondehub';
    var ehime_mode = (run_settings.pred_type === 'ehime');
    var fall_mode = (run_settings.pred_type === 'fall');
    
    // Grab date values
    var year = $('#year').val();
    var month = $('#month').val();
    var day = $('#day').val();
    var hour = $('#hour').val();
    var minute = $('#min').val();

    // 入力は JST (UTC+9) 想定。UTC に変換して保持。
    // Months are zero-indexed in Javascript.
    var launch_time_local = moment.tz ? moment.tz([year, month-1, day, hour, minute, 0, 0], 'Asia/Tokyo') : moment([year, month-1, day, hour, minute, 0, 0]).utcOffset(9*60);
    var launch_time = launch_time_local.clone().utc();
    run_settings.launch_datetime = launch_time.format();
    extra_settings.launch_moment = launch_time;

    // SondeHub利用時のみ、公開API向けの時刻制限を適用する。
    if(shouldValidateSondeHubTimeWindow(requestedApiSource)){
        if(launch_time < (moment.utc().subtract(12, 'hours'))){
            throwError("Launch time too old (outside of model time range).");
            return;
        }
        if(launch_time > (moment.utc().add(7, 'days'))){
            throwError("Launch time too far into the future (outside of model time range).");
            return;
        }
    }

    // Grab other launch settings.
    run_settings.launch_latitude = parseFloat($('#lat').val());
    run_settings.launch_longitude = parseFloat($('#lon').val());
    // Handle negative longitudes - Tawhiri wants longitudes between 0-360
    if (run_settings.launch_longitude < 0.0){
        run_settings.launch_longitude += 360.0
    }
    run_settings.launch_altitude = parseFloat($('#initial_alt').val());
    run_settings.ascent_rate = parseFloat($('#ascent').val());

    if (run_settings.profile == "standard_profile"){
        run_settings.burst_altitude = parseFloat($('#burst').val());
        run_settings.descent_rate = parseFloat($('#drag').val());
    } else {
        run_settings.float_altitude = parseFloat($('#burst').val());
        run_settings.stop_datetime = launch_time.add(1, 'days').format();
    }

    // FALL モード: 入力は開始高度(= burst) と下降速度のみ。API に対し極端な高速上昇 + 直後バースト設定を与える。
    if(fall_mode){
        // ユーザー入力の開始高度
        var start_alt = parseFloat($('#initial_alt').val());
        var descent_rate = parseFloat($('#drag').val());
        if(isNaN(start_alt) || isNaN(descent_rate)){
            throwError('落下モード: 高度/下降速度が不正');
            return;
        }
    // 最小オーバーヘッド: 1m だけ上昇 (API 仕様的に 0 差より安定)
    var ASCENT_BUFFER = 1; // m
        run_settings.fall_user_start_alt = start_alt; // 後段再調整用に保存
        run_settings.launch_altitude = start_alt;              // 実際の開始高度
    run_settings.burst_altitude = start_alt + ASCENT_BUFFER; // 1m 上昇後すぐ下降
    run_settings.ascent_rate = 1; // 1m / 1 m/s = 約1秒相当
        run_settings.descent_rate = descent_rate;
        run_settings.profile = 'standard_profile'; // 強制
    }

    // 愛媛モード: 表示上の許容範囲やマージン情報を計算（API送信値はそのまま）
    if(ehime_mode){
        var asc = run_settings.ascent_rate;
        var desc = run_settings.descent_rate;
        if(!isNaN(asc)){
            $('#ehime_ascent_range').text((asc-1).toFixed(2)+ ' ～ ' + (asc+1).toFixed(2) + ' m/s');
        } else {
            $('#ehime_ascent_range').text('N/A');
        }
        if(!isNaN(desc)){
            $('#ehime_descent_range').text((desc-3).toFixed(2)+ ' ～ ' + (desc+3).toFixed(2) + ' m/s');
        } else {
            $('#ehime_descent_range').text('N/A');
        }
        if(!isNaN(run_settings.burst_altitude)){
            var b = run_settings.burst_altitude;
            var upper = (b * 1.10).toFixed(0);
            var lower = (b * 0.80).toFixed(0);
            $('#ehime_burst_margin').text(lower + ' m ～ ' + upper + ' m');
        } else {
            $('#ehime_burst_margin').text('N/A');
        }
    }


    // Update the URL with the supplied parameters.
    url = new URL(window.location.href);
    // Should probably clear all these parameters before setting them again?
    if (time_was_now){
        url.searchParams.set('launch_datetime','now');
    }else {
        url.searchParams.set('launch_datetime', run_settings.launch_datetime);
    }
    url.searchParams.set('launch_latitude', run_settings.launch_latitude);
    url.searchParams.set('launch_longitude', run_settings.launch_longitude);
    url.searchParams.set('launch_altitude', run_settings.launch_altitude);
    url.searchParams.set('ascent_rate', run_settings.ascent_rate);
    url.searchParams.set('profile', run_settings.profile);
    url.searchParams.set('prediction_type', run_settings.pred_type);
    if (run_settings.profile == "standard_profile"){
        url.searchParams.set('burst_altitude', run_settings.burst_altitude);
        url.searchParams.set('descent_rate', run_settings.descent_rate);
    } else {
        url.searchParams.set('float_altitude', run_settings.float_altitude);
    }

    var apiSource = $('#api_source').val() || 'sondehub';
    url.searchParams.set('api_source', apiSource);
    if(apiSource === 'custom'){
        var customUrl = ($('#api_custom_url').val() || '').trim();
        if(customUrl){
            url.searchParams.set('api_custom_url', customUrl);
        }
    } else {
        url.searchParams.delete('api_custom_url');
    }

    // Update browser URL.
    history.replaceState(
        {},
        'CUSF / SondeHub Predictor',
        url.href
    );

    var selectedApiUrl = resolveTawhiriApiUrl();
    if(!selectedApiUrl){
        return;
    }
    tawhiri_api = selectedApiUrl;
    appendDebug('Using API: ' + tawhiri_api);


    // Run the request
    requestPredictionWithApiValidation(run_settings, extra_settings, requestedApiSource);

}

// Prediction type change: toggle Ehime info row
$(document).on('change', '#prediction_type', function(){
    if($(this).val()==='ehime'){
        $('#ehime_info_row').show();
    ensureEhimePanelVisible();
    expandEhimePanel && expandEhimePanel();
    refreshEhimePanel();
    // Show mobile nav button if mobile UI loaded
    var ehBtn = document.getElementById('mobile_nav_ehime');
    if(ehBtn){ ehBtn.style.display='block'; }
    if(window.__mobileUI){ window.__mobileUI.showEhimePanel && window.__mobileUI.showEhimePanel(); }
    // 自動実行を行わず、ユーザーの「予測を実行」ボタン押下を待つ。
    // 以前の結果が残っていると紛らわしいため表示値をリセット。
    $('#ehime_completed').text('0');
    $('#ehime_total').text('0');
    $('#ehime_mean').text('-');
    $('#ehime_max_dev').text('-');
    $('#ehime_ascent_range').text('-');
    $('#ehime_descent_range').text('-');
    $('#ehime_burst_margin').text('-');
    $('#ehime_dlcsv').hide();
    } else {
        $('#ehime_info_row').hide();
    $('#ehime_dlcsv').hide();
    // 完全に非表示へ（他モード時は占有しない）
    var panel = $('#ehime_panel');
    if(panel.length){
        panel.hide();
        panel.removeClass('ehime-collapsed');
        $('#ehime_panel_close').text('折り畳む');
        $('#ehime_panel_toggle').text('«');
    }
    }
    // 落下モード UI 切替
    updateFallModeUI();
});

// Tawhiri API URL. Refer to API docs here: https://tawhiri.readthedocs.io/en/latest/api.html
// Habitat Tawhiri Instance
//var tawhiri_api = "https://predict.cusf.co.uk/api/v1/";
// Sondehub Tawhiri Instance
var tawhiri_api = "https://api.v2.sondehub.org/tawhiri";
// Approximately how many hours into the future the model covers.
var MAX_PRED_HOURS = 169;
// Ehime mode storage
var ehime_current = null;
var ehime_predictions = {}; // variant_id -> {settings, status, results, marker}
var ehime_variant_total = 0;
var ehime_mean_marker = null;
var ehime_dispersion_circle = null;
var ehime_burst_circle = null;
// (Removed visual summary overlays as per request)
var ehime_mean_marker = null; // kept for compatibility but unused
var ehime_dispersion_circle = null; // unused
var ehime_burst_circle = null; // unused
// Ehime panel DOM helper
function ensureEhimePanelVisible(){
    if($('#prediction_type').val()==='ehime'){
        $('#ehime_panel').show();
    }
}
function hideEhimePanel(){
    // Switch to collapsed state rather than full hide
    var panel = $('#ehime_panel');
    if(!panel.length) return;
    if(!panel.hasClass('ehime-collapsed')){
        panel.addClass('ehime-collapsed');
        $('#ehime_panel_close').text('展開');
        $('#ehime_panel_toggle').text('»');
        $('#ehime_panel_toggle').show();
    }
}
$(document).on('click','#ehime_panel_close',function(){ hideEhimePanel(); });
// Toggle button inside panel when collapsed
$(document).on('click','#ehime_panel_toggle', function(){
    var panel = $('#ehime_panel');
    if(panel.hasClass('ehime-collapsed')){
        panel.removeClass('ehime-collapsed');
        $('#ehime_panel_close').text('折り畳む');
        $('#ehime_panel_toggle').text('«');
    } else {
        hideEhimePanel();
    }
});
// If user re-selects Ehime mode, ensure expanded
function expandEhimePanel(){
    var panel = $('#ehime_panel');
    panel.show();
    if(panel.hasClass('ehime-collapsed')){
        panel.removeClass('ehime-collapsed');
        $('#ehime_panel_close').text('折り畳む');
        $('#ehime_panel_toggle').text('«');
    }
}

// 落下モード UI 制御: 参照しない入力を無効化・視覚的無効化
function updateFallModeUI(){
    var fall = ($('#prediction_type').val()==='fall');
    var disableIds = ['#ascent','#burst','#flight_profile'];
    if(fall){
        // 強制プロファイル
        $('#flight_profile').val('standard_profile');
        disableIds.forEach(function(id){ $(id).prop('disabled',true).addClass('fall-disabled'); });
        $('#burst-calc-show').hide();
        var cell = $('#initial_alt').closest('tr').find('td:first');
        if(!cell.data('orig')){ cell.data('orig', cell.text()); }
        if(cell.text().indexOf('落下開始高度')===-1){ cell.text(cell.data('orig')+' (落下開始高度)'); }
    } else {
        disableIds.forEach(function(id){ $(id).prop('disabled',false).removeClass('fall-disabled'); });
        $('#burst-calc-show').show();
        var cell = $('#initial_alt').closest('tr').find('td:first');
        if(cell.data('orig')){ cell.text(cell.data('orig')); }
    }
}

// 初期呼び出し (DOM ready タイミングで pred.js などから呼ばれない場合対策)
$(function(){ updateFallModeUI(); });
$(function(){
    toggleCustomApiInput();
    $(document).on('change', '#api_source', function(){
        toggleCustomApiInput();
    });
});

function buildEhimeVariantRow(idx, variant_id, entry, variant_index){
    var base = ehime_current && ehime_current.base ? ehime_current.base : null;
    var diff_parts = [];
    if(base && entry && entry.settings){
        if(entry.settings.ascent_rate !== base.ascent_rate){ diff_parts.push('A'+(entry.settings.ascent_rate>base.ascent_rate?'+':'-')); }
        if(entry.settings.descent_rate !== base.descent_rate){ diff_parts.push('D'+(entry.settings.descent_rate>base.descent_rate?'+':'-')); }
        if(entry.settings.burst_altitude !== base.burst_altitude){
            var ratio = entry.settings.burst_altitude / base.burst_altitude;
            diff_parts.push('B'+(ratio>1?'+':'-'));
        }
    }
    if(entry.label==='BASE'){ diff_parts = ['-']; }
    var color = '#cccccc';
    if(typeof variant_index !== 'undefined' && ehime_variant_total>0){
        color = ConvertRGBtoHex(evaluate_cmap((variant_index+1)/(ehime_variant_total+1), 'turbo'));
    }
    var statusClass = 'ehime-status-'+entry.status;
    var lat='-', lon='-', ascent='-', descent='-', burst='-', flight='-';
        var landsea='-';
    if(entry.results && entry.results.landing){
        lat = entry.results.landing.latlng.lat.toFixed(4);
        lon = entry.results.landing.latlng.lng.toFixed(4);
            try {
                var ll = entry.results.landing.latlng;
                var flag = (typeof LandSea!=='undefined') ? LandSea.isLand(ll.lat, ll.lng) : null;
                if(flag===null){ landsea='判定中'; }
                else landsea = flag ? '陸' : '海';
                entry.landsea = landsea;
            } catch(e){ landsea='?'; }
    }
    if(entry.settings){
        if(entry.settings.ascent_rate!=null) ascent = entry.settings.ascent_rate.toFixed(2);
        if(entry.settings.descent_rate!=null) descent = entry.settings.descent_rate.toFixed(2);
        if(entry.settings.burst_altitude!=null) burst = entry.settings.burst_altitude.toFixed(0);
    }
    if(entry.results && entry.results.launch && entry.results.landing){
        var dur = (entry.results.landing.datetime.unix() - entry.results.launch.datetime.unix())/60.0;
        if(!isNaN(dur)) flight = dur.toFixed(0);
    }
    var trClass = (entry.label==='BASE')? 'ehime-row-base': '';
    var seaCellClass = statusClass + (landsea==='海' ? ' ehime-landsea-sea' : '');
    return '<tr data-vid="'+variant_id+'" class="'+trClass+'">'
        +'<td>'+(idx+1)+'</td>'
        +'<td><span class="ehime-color-swatch" style="background:'+color+'"></span></td>'
        +'<td>'+entry.label+'</td>'
        +'<td>'+diff_parts.join(' ')+'</td>'
        +'<td>'+lat+'</td>'
        +'<td>'+lon+'</td>'
        +'<td>'+ascent+'</td>'
        +'<td>'+descent+'</td>'
        +'<td>'+burst+'</td>'
        +'<td>'+flight+'</td>'
        +'<td class="'+seaCellClass+'">'+landsea+'</td>'
        +'</tr>';
}

function refreshEhimePanel(){
    if($('#prediction_type').val()!=='ehime') return;
    ensureEhimePanelVisible();
    var tbody = [];
    var keys = Object.keys(ehime_predictions);
    keys.sort(function(a,b){
        var ia = parseInt(a.split('_')[1]);
        var ib = parseInt(b.split('_')[1]);
        return ia-ib;
    });
    keys.forEach(function(k){
        var entry = ehime_predictions[k];
        tbody.push(buildEhimeVariantRow(parseInt(k.split('_')[1]), k, entry, parseInt(k.split('_')[1])));
    });
    $('#ehime_variants_table tbody').html(tbody.join(''));
    // Summary
    var completed = Object.values(ehime_predictions).filter(p=>p.status==='ok');
    $('#ehime_panel_completed').text(completed.length);
    $('#ehime_panel_total').text(ehime_variant_total);
    if(completed.length>0){
        var sumLat=0,sumLon=0; completed.forEach(p=>{sumLat+=p.results.landing.latlng.lat; sumLon+=p.results.landing.latlng.lng;});
        var meanLat = (sumLat/completed.length).toFixed(4);
        var meanLon = (sumLon/completed.length).toFixed(4);
        $('#ehime_panel_mean').text(meanLat+", "+meanLon);
        // max dev already computed in updateEhimeSummaryFromStore; reuse element text
        $('#ehime_panel_maxdev').text($('#ehime_max_dev').text());
    } else {
        $('#ehime_panel_mean').text('-');
        $('#ehime_panel_maxdev').text('-');
    }
        // Build mobile card list
        var mobileWrap = document.getElementById('ehime_variants_mobile');
        if(mobileWrap){
            var isMobileCards = window.matchMedia && matchMedia('(max-width:600px)').matches;
            if(isMobileCards){
                var cards = [];
                keys.forEach(function(k){
                    var entry = ehime_predictions[k];
                    var idx = parseInt(k.split('_')[1]);
                    var color = '#ccc';
                    if(ehime_variant_total>0){
                        color = ConvertRGBtoHex(evaluate_cmap((idx+1)/(ehime_variant_total+1), 'turbo'));
                    }
                    var baseClass = entry.label==='BASE' ? ' base':' ';
                    var statusClass = ' '+(entry.status==='pending'?'pending':(entry.status==='error'?'error':'ok'));
                    var lat='-', lon='-', landsea='-';
                    var flight='-', ascent='-', descent='-', burst='-';
                    if(entry.results && entry.results.landing){
                        lat = entry.results.landing.latlng.lat.toFixed(4);
                        lon = entry.results.landing.latlng.lng.toFixed(4);
                    }
                    if(entry.landsea){ landsea = entry.landsea; }
                    if(entry.settings){
                        if(entry.settings.ascent_rate!=null) ascent = entry.settings.ascent_rate.toFixed(2);
                        if(entry.settings.descent_rate!=null) descent = entry.settings.descent_rate.toFixed(2);
                        if(entry.settings.burst_altitude!=null) burst = entry.settings.burst_altitude.toFixed(0);
                    }
                    if(entry.results && entry.results.launch && entry.results.landing){
                        var dur = (entry.results.landing.datetime.unix() - entry.results.launch.datetime.unix())/60.0;
                        if(!isNaN(dur)) flight = dur.toFixed(0);
                    }
                    // Diff markers
                    var diff=[];
                    if(ehime_current && ehime_current.base){
                        var base=ehime_current.base;
                        if(entry.settings){
                            if(entry.settings.ascent_rate !== base.ascent_rate) diff.push('A'+(entry.settings.ascent_rate>base.ascent_rate?'+':'-'));
                            if(entry.settings.descent_rate !== base.descent_rate) diff.push('D'+(entry.settings.descent_rate>base.descent_rate?'+':'-'));
                            if(entry.settings.burst_altitude !== base.burst_altitude){
                                var ratio = entry.settings.burst_altitude/base.burst_altitude; diff.push('B'+(ratio>1?'+':'-'));
                            }
                        }
                    }
                    if(entry.label==='BASE'){ diff=['-']; }
                    var landseaClass = landsea==='海' ? ' landsea-sea':'';
                    var html = '<div class="ehime-card'+baseClass+statusClass+'" data-vid="'+k+'">'
                        +'<div><span class="swatch" style="background:'+color+'"></span><span class="label">'+entry.label+'</span> <span style="font-size:10px;">['+diff.join(' ')+']</span></div>'
                        +'<div class="meta">'
                        +'<span>上昇:'+ascent+'</span>'
                        +'<span>下降:'+descent+'</span>'
                        +'<span>破裂:'+burst+'</span>'
                        +'<span>飛行:'+flight+'m</span>'
                        +'<span>着地:'+lat+','+lon+'</span>'
                        +'<span class="'+landseaClass+'">'+landsea+'</span>'
                        +'</div>'
                        +'</div>';
                    cards.push(html);
                });
                mobileWrap.innerHTML = cards.join('');
                // Click: pan to marker
                mobileWrap.querySelectorAll('.ehime-card').forEach(function(card){
                    card.addEventListener('click', function(){
                        var vid = this.getAttribute('data-vid');
                        if(ehime_predictions[vid] && ehime_predictions[vid].marker){
                            var m = ehime_predictions[vid].marker;
                            map.setView(m.getLatLng(), Math.max(map.getZoom(), 9));
                            if(m.openPopup) m.openPopup();
                        }
                    });
                });
            }
        }
}

// Row click: pan/zoom to marker & open popup
$(document).on('click','#ehime_variants_table tbody tr', function(){
    var vid = $(this).data('vid');
    if(ehime_predictions[vid] && ehime_predictions[vid].marker){
        var m = ehime_predictions[vid].marker;
        map.setView(m.getLatLng(), Math.max(map.getZoom(), 9));
        if(m.openPopup) m.openPopup();
    }
});

// Generate CSV for Ehime variant landing points (called on demand)
function buildEhimeLandingCSV(){
    if(typeof ehime_predictions === 'undefined') return '';
    var completed = Object.values(ehime_predictions).filter(p=>p.status==='ok' && p.results && p.results.landing);
    if(completed.length===0) return '';
    var header = [
        'label','landing_lat','landing_lon','ascent_rate','descent_rate','burst_altitude','launch_time_JST','landing_time_JST','flight_time_min'
    ];
    var rows = [header.join(',')];
    completed.forEach(function(p){
        var lat = p.results.landing.latlng.lat;
        var lon = p.results.landing.latlng.lng;
        var ascent = (p.settings && p.settings.ascent_rate!=null)?p.settings.ascent_rate:'';
        var descent = (p.settings && p.settings.descent_rate!=null)?p.settings.descent_rate:'';
        var burst = (p.settings && p.settings.burst_altitude!=null)?p.settings.burst_altitude:'';
        var launchTime = p.results.launch && p.results.launch.datetime ? p.results.launch.datetime.clone().utcOffset(9*60).format('YYYY-MM-DD HH:mm') : '';
        var landingTime = p.results.landing && p.results.landing.datetime ? p.results.landing.datetime.clone().utcOffset(9*60).format('YYYY-MM-DD HH:mm') : '';
        var flightMinutes = '';
        if(p.results.launch && p.results.landing && p.results.launch.datetime && p.results.landing.datetime){
            flightMinutes = (p.results.landing.datetime.diff(p.results.launch.datetime,'minutes')).toFixed(0);
        }
        var cols = [p.label, lat.toFixed(5), lon.toFixed(5), ascent, descent, burst, launchTime, landingTime, flightMinutes];
        // Escape any commas (shouldn't be present) & quote if needed
        cols = cols.map(function(c){
            if(typeof c === 'string' && c.indexOf(',')!==-1){ return '"'+c.replace(/"/g,'""')+'"'; }
            return c;
        });
        rows.push(cols.join(','));
    });
    return rows.join('\n');
}

function updateEhimeCSVLink(){
    var link = $('#ehime_dlcsv');
    if(link.length===0) return; // Not present
    // Only show if prediction_type is ehime
    if($('#prediction_type').val()!=='ehime'){ link.hide(); return; }
    var hasData = Object.values(ehime_predictions).some(p=>p.status==='ok');
    if(hasData){
        link.show();
    } else {
        link.hide();
    }
}

// Click handler to trigger CSV build & download (use the clicked link for user-gesture reliability)
$(document).on('click','#ehime_dlcsv', function(e){
    var csv = buildEhimeLandingCSV();
    if(!csv){
        e.preventDefault();
        alert('まだ着地点データがありません。予測完了後に再度お試しください。');
        return;
    }
    var blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
    var url = URL.createObjectURL(blob);
    // Build filename (例: Ehime_着地点一覧_20250907_1530JST_34.123N_132.456E.csv)
    var baseEntry = null;
    try { baseEntry = Object.values(ehime_predictions).find(p=>p.label==='BASE' && p.results && p.results.launch && p.results.launch.datetime); } catch(_e) {}
    var launchMoment = baseEntry ? baseEntry.results.launch.datetime.clone() : moment();
    launchMoment.utcOffset(9*60);
    var ts = launchMoment.format('YYYYMMDD_HHmm');
    var latlonPart = '';
    try {
        if(baseEntry && baseEntry.results.launch && baseEntry.results.launch.latlng){
            var ll = baseEntry.results.launch.latlng;
            var latAbs = Math.abs(ll.lat).toFixed(3);
            var lonAbs = Math.abs(ll.lng).toFixed(3);
            var latHem = ll.lat>=0 ? 'N':'S';
            var lonHem = ll.lng>=0 ? 'E':'W';
            latlonPart = '_'+latAbs+latHem+'_'+lonAbs+lonHem;
        }
    } catch(_e) {}
    var ascPart = '', descPart = '';
    try {
        if(baseEntry && baseEntry.settings){
            var ascVal = Number(baseEntry.settings.ascent_rate);
            var descVal = Number(baseEntry.settings.descent_rate);
            if(!isNaN(ascVal)) ascPart = '_ASC'+ascVal.toFixed(2);
            if(!isNaN(descVal)) descPart = '_DES'+descVal.toFixed(2);
        }
    } catch(_e) {}
    var filename = 'Ehime_着地点一覧_'+ts+'JST'+ascPart+descPart+latlonPart+'.csv';
    // Set attributes on the actual clicked link and allow default navigation
    try {
        this.href = url;
        this.setAttribute('download', filename);
        // Cleanup later to avoid revoking before the browser starts the download
        var linkEl = this;
        setTimeout(function(){
            try { URL.revokeObjectURL(url); } catch(_e){}
            // Remove attributes to keep DOM clean and avoid stale href on next click
            try { linkEl.removeAttribute('href'); linkEl.removeAttribute('download'); } catch(__e){}
        }, 10000);
    } catch(err){
        // Fallback: prevent default and open a temporary link
        e.preventDefault();
        var a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        setTimeout(function(){ URL.revokeObjectURL(url); a.remove(); }, 10000);
    }
});

function tawhiriRequest(settings, extra_settings){
    // Request a prediction via the Tawhiri API.
    // Settings must be as per the API docs above.

    if(settings.pred_type=='single' ){
        hourly_mode = false;
        $.get( tawhiri_api, settings )
            .done(function( data ) {
                processTawhiriResults(data, settings);
            })
            .fail(function(data) {
                var prediction_error = "Prediction failed. Tawhiri may be under heavy load, please try again. ";
                if(data.hasOwnProperty("responseJSON"))
                {
                    prediction_error += data.responseJSON.error.description;
                }

                throwError(prediction_error);
            })
            .always(function(data) {
                //throwError("test.");
                //console.log(data);
            });
    } else if (settings.pred_type=='fall') {
        // シングルだが後処理で下降部分のみ抽出
        hourly_mode = false;
        $.get( tawhiri_api, settings )
            .done(function(data){
                processTawhiriResults(data, settings, true); // fall flag
            })
            .fail(function(data){
                var prediction_error = '落下モード予測失敗。再試行してください。';
                if(data.hasOwnProperty('responseJSON')){
                    prediction_error += data.responseJSON.error.description;
                }
                throwError(prediction_error);
            });
    } else if (settings.pred_type=='ehime') {
        // Custom multi-variant prediction set for Ehime mode
        if(settings.profile != 'standard_profile'){
            throwError('愛媛モードは標準フライトプロファイルのみ対応');
            return;
        }
        runEhimePredictions(settings, extra_settings);
    } else {
        // For Multiple predictions, we do things a bit differently.
        hourly_mode = true;
        // First up clear off anything on the map.
        clearMapItems();

        // Also clean up any hourly prediction data.
        hourly_predictions = {};

        var current_hour = 0;
        var time_step = 24;

        if(settings.pred_type=='daily'){
            time_step = 24;
        } else if (settings.pred_type=='1_hour'){
            time_step = 1;
        } else if (settings.pred_type=='3_hour'){
            time_step = 3;
        } else if (settings.pred_type=='6_hour'){
            time_step = 6;
        } else if (settings.pred_type=='12_hour'){
            time_step = 12;
        } else {
            throwError("Invalid time step.");
            return;
        }

    if(settings.profile != "standard_profile"){
            throwError("Hourly/Daily predictions are only available for the standard flight profile.");
            return;
        }

        // Loop to advance time until end of prediction window
        while(current_hour < MAX_PRED_HOURS){
            // Update launch time
            var current_moment = moment(extra_settings.launch_moment).add(current_hour, 'hours');

            // Setup entries in the hourly prediction data store.
            hourly_predictions[current_hour] = {};
            hourly_predictions[current_hour]['layers'] = {};
            hourly_predictions[current_hour]['settings'] = {...settings};
            hourly_predictions[current_hour]['settings']['launch_datetime'] = current_moment.format();
            
            // Copy our current settings for passing into the requst.
            var current_settings = {...hourly_predictions[current_hour]['settings']};

            $.get( {url:tawhiri_api, 
                data: current_settings, 
                current_hour: current_hour} )
                .done(function( data ) {
                    processHourlyTawhiriResults(data, current_settings, this.current_hour);
                })
                .fail(function(data) {
                    var prediction_error = "Prediction failed. Tawhiri may be under heavy load, please try again. ";
                    if(data.hasOwnProperty("responseJSON"))
                    {
                        prediction_error += data.responseJSON.error.description;
                    }

                    // Silently handle failed predictions, which are most likely
                    // because the prediction time was too far into the future.
                    delete hourly_predictions[this.current_hour]
                    //throwError(prediction_error);
                })
                .always(function(data) {
                    //throwError("test.");
                    //console.log(data);
                });

            current_hour += time_step;

        }

            // Generate prediction number and information to pass onwards to plotting
            // Run async get call, pass in prediction details.

            // Need new processing functions to plot just the landing spot, and then somehow a line between them?
            

    }
}

// Generate and run multiple variant predictions for Ehime mode
function runEhimePredictions(base_settings, extra_settings){
    // Clear previous map items & state
    clearMapItems();
    ehime_predictions = {};
    ehime_current = { base: base_settings };

    var asc_base = base_settings.ascent_rate;
    var desc_base = base_settings.descent_rate;
    var burst_base = base_settings.burst_altitude; // only standard_profile
    // Calculate variant values
    var asc_min = asc_base - 1.0;
    var asc_max = asc_base + 1.0;
    var desc_min = desc_base - 3.0;
    var desc_max = desc_base + 3.0;
    var burst_low = burst_base * 0.8;
    var burst_high = burst_base * 1.10;

    // Build variant list (13 variants: base + singles + paired extremes)
    var variants = [];
    function addVariant(a,d,b,label){
        variants.push({ascent_rate:a, descent_rate:d, burst_altitude:b, label:label});
    }
    addVariant(asc_base, desc_base, burst_base, 'BASE');
    addVariant(asc_min, desc_base, burst_base, 'ASC-');
    addVariant(asc_max, desc_base, burst_base, 'ASC+');
    addVariant(asc_base, desc_min, burst_base, 'DES-');
    addVariant(asc_base, desc_max, burst_base, 'DES+');
    addVariant(asc_base, desc_base, burst_low,  'BURST-');
    addVariant(asc_base, desc_base, burst_high, 'BURST+');
    addVariant(asc_min, desc_min, burst_base,   'A-D-');
    addVariant(asc_max, desc_max, burst_base,   'A+D+');
    addVariant(asc_min, desc_base, burst_low,   'A-B-');
    addVariant(asc_max, desc_base, burst_high,  'A+B+');
    addVariant(asc_base, desc_min, burst_low,   'D-B-');
    addVariant(asc_base, desc_max, burst_high,  'D+B+');

    ehime_variant_total = variants.length;
    $('#ehime_total').text(ehime_variant_total);
    $('#ehime_completed').text(0);
    $('#ehime_mean').text('-');
    $('#ehime_max_dev').text('-');

    // Launch all requests
    variants.forEach(function(v, idx){
        var v_settings = {...base_settings};
        v_settings.ascent_rate = v.ascent_rate;
        v_settings.descent_rate = v.descent_rate;
        v_settings.burst_altitude = v.burst_altitude;
        // Unique label for marker & internal key
        var variant_id = 'ehime_'+idx;
        ehime_predictions[variant_id] = {settings:v_settings, status:'pending', label:v.label};
        $.get( tawhiri_api, v_settings )
            .done(function(data){
                processEhimeResult(data, v_settings, variant_id, idx);
            })
            .fail(function(data){
                ehime_predictions[variant_id].status='error';
                // Continue; do not throw global error.
                updateEhimeSummaryFromStore();
            });
    });
    updateEhimeCSVLink(); // ensure link hidden until data arrives
    expandEhimePanel();
    refreshEhimePanel();
}

function processEhimeResult(data, settings, variant_id, variant_index){
    if(data.hasOwnProperty('error')){
        ehime_predictions[variant_id].status='error';
        updateEhimeSummaryFromStore();
        return;
    }
    var prediction_results = parsePrediction(data.prediction);
    ehime_predictions[variant_id].status='ok';
    ehime_predictions[variant_id].results = prediction_results;

    // Plot base path for BASE only once
    if(ehime_predictions[variant_id].label==='BASE'){
        // Pass settings so popups can show conditions
        plotStandardPrediction(prediction_results, settings);
        // Set standard CSV/KML links to BASE flight path (same as single mode)
        try {
            var _base_url = tawhiri_api + "?" + $.param(settings);
            var _csv_url = _base_url + "&format=csv";
            var _kml_url = _base_url + "&format=kml";
            $("#dlcsv").attr("href", _csv_url).removeAttr('download');
            $("#dlkml").attr("href", _kml_url).removeAttr('download');
        } catch(_e){}
        // Update run time/model if available
        try {
            if(data && data.metadata && data.request){
                var run_time = moment.utc(data.metadata.complete_datetime).clone().utcOffset(9*60).format('YYYY-MM-DD HH:mm');
                var dataset = moment.utc(data.request.dataset).format("YYYYMMDD-HH");
                $("#run_time").html(run_time);
                $("#dataset").html(dataset);
            }
        } catch(__e){}
    }

    // Plot landing marker for each variant
    plotEhimeLandingMarker(variant_id, variant_index);
    updateEhimeSummaryFromStore();
    updateEhimeCSVLink();
    refreshEhimePanel();
    refreshEhimePanel();
    // After BASE result arrives, refresh popups so non-BASE markers can show BASE coordinates
    try {
        if(ehime_predictions[variant_id] && ehime_predictions[variant_id].label==='BASE' && typeof updateAllPopups==='function'){
            updateAllPopups();
        }
    } catch(_e){}
}

function plotEhimeLandingMarker(variant_id, variant_index){
    var entry = ehime_predictions[variant_id];
    if(!entry.results) return;
    var landing = entry.results.landing;
    var launch = entry.results.launch;
    var color = ConvertRGBtoHex(evaluate_cmap((variant_index+1)/(ehime_variant_total+1), 'turbo'));
    var marker = new L.CircleMarker(landing.latlng, {
        radius: (entry.label==='BASE')?6:4,
        fillOpacity: 1.0,
        zIndexOffset: 1200,
        fillColor: color,
        stroke: true,
        weight: 1,
        color: '#000000'
    }).addTo(map);
    // Build condition difference description vs BASE
    var base = ehime_current && ehime_current.base ? ehime_current.base : null;
    var diff_desc = [];
    if(base){
        if(entry.settings.ascent_rate !== base.ascent_rate){
            diff_desc.push('上昇'+ (entry.settings.ascent_rate>base.ascent_rate?'+':'-') + '1 m/s');
        }
        if(entry.settings.descent_rate !== base.descent_rate){
            diff_desc.push('下降'+ (entry.settings.descent_rate>base.descent_rate?'+':'-') + '3 m/s');
        }
        if(entry.settings.burst_altitude !== base.burst_altitude){
            var ratio = entry.settings.burst_altitude / base.burst_altitude;
            if(ratio>1){ diff_desc.push('破裂+10%'); } else { diff_desc.push('破裂-20%'); }
        }
    }
    var desc_line = diff_desc.length? ('変更: '+diff_desc.join(', ')) : '変更: なし (基準)';
    // Show BASE landing for non-BASE entries. If BASE not ready yet, show placeholder '-'.
    var base_line = '';
    if(entry.label !== 'BASE'){
        var baseLL = null;
        try {
            for(var k in ehime_predictions){
                var ep = ehime_predictions[k];
                if(ep && ep.label==='BASE' && ep.results && ep.results.landing){ baseLL = ep.results.landing.latlng; break; }
            }
        } catch(_e){}
        if(baseLL){
            base_line = 'BASE着地点: '+(typeof formatCoord==='function'? (formatCoord(baseLL.lat,'lat')+', '+formatCoord(baseLL.lng,'lon')) : (baseLL.lat.toFixed(4)+', '+baseLL.lng.toFixed(4)))+'<br/>';
        } else {
            base_line = 'BASE着地点: -<br/>';
        }
    }
    var popup_html = '<b>'+entry.label+'</b><br/>'+
        desc_line + '<br/>'+
        '着地点: '+(typeof formatCoord==='function'? formatCoord(landing.latlng.lat,'lat')+', '+formatCoord(landing.latlng.lng,'lon') : (landing.latlng.lat.toFixed(4)+', '+landing.latlng.lng.toFixed(4)))+'<br/>'+
        base_line+
        '上昇:'+entry.settings.ascent_rate.toFixed(2)+' m/s / 下降:'+entry.settings.descent_rate.toFixed(2)+' m/s<br/>'+
        '破裂高度:'+entry.settings.burst_altitude.toFixed(0)+' m<br/>'+
    '離陸:'+launch.datetime.clone().utcOffset(9*60).format('HH:mm')+' JST<br/>'+
    '落下時刻:'+(landing && landing.datetime ? landing.datetime.clone().utcOffset(9*60).format('HH:mm')+' JST' : '不明');
    marker.bindPopup(popup_html);
    ehime_predictions[variant_id].marker = marker;

    // 表示制御ポリシー調整 (要件):
    //  - 毎時タイプ (hourly) と同様にクリックで経路表示/非表示をトグル
    //  - ダブルクリックでは「ポップアップは残し、飛行経路のみ消去」
    //  - BASE バリアントは既存挙動を保持 (変更禁止)
    if(entry.label === 'BASE'){
        marker.on('click', function(){ toggleEhimeVariantPath(variant_id); });
    } else {
        attachEhimeVariantClickHandlers(marker, variant_id);
    }
}

// 愛媛モード: バリアント飛行経路の表示/非表示トグル
function toggleEhimeVariantPath(variant_id){
    var entry = ehime_predictions[variant_id];
    if(!entry || entry.status!=='ok' || !entry.results) return;

    // BASE バリアントは最初に標準描画済みなので未登録なら既存グローバルを紐付け
    if(entry.label==='BASE' && (!entry.layers || !entry.layers.flight_path)){
        entry.layers = entry.layers || {};
        if(map_items['path_polyline']) entry.layers.flight_path = map_items['path_polyline'];
        if(map_items['launch_marker']) entry.layers.launch_marker = map_items['launch_marker'];
        if(map_items['pop_marker']) entry.layers.burst_marker = map_items['pop_marker'];
    }

    // 既に表示中 -> 削除
    if(entry.layers && entry.layers.flight_path){
        if(entry.layers.flight_path.remove) entry.layers.flight_path.remove();
        if(entry.layers.launch_marker && entry.layers.launch_marker.remove) entry.layers.launch_marker.remove();
        if(entry.layers.burst_marker && entry.layers.burst_marker.remove) entry.layers.burst_marker.remove();
        delete entry.layers.flight_path;
        delete entry.layers.launch_marker;
        delete entry.layers.burst_marker;
        return;
    }

    // 新規表示
    entry.layers = entry.layers || {};
    var res = entry.results;
    // アイコンは単一予測と同じ
    var launch_icon = L.icon({ iconUrl: launch_img, iconSize:[10,10], iconAnchor:[5,5] });
    var burst_icon  = L.icon({ iconUrl: burst_img,  iconSize:[16,16], iconAnchor:[8,8] });
    // 発射マーカー
    var launch_marker = L.marker(res.launch.latlng, {
        title: '離陸地点 ('+res.launch.latlng.lat.toFixed(4)+', '+res.launch.latlng.lng.toFixed(4)+')',
        icon: launch_icon
    }).addTo(map);
    // 破裂マーカー
    var burst_marker = L.marker(res.burst.latlng, {
        title: 'バースト ('+res.burst.latlng.lat.toFixed(4)+', '+res.burst.latlng.lng.toFixed(4)+' 高度 '+res.burst.latlng.alt.toFixed(0)+')',
        icon: burst_icon
    }).addTo(map);
    // 経路ポリライン（黒、標準と同じスタイル）
    var path_polyline = L.polyline(res.flight_path, { weight:3, color:'#000000' }).addTo(map);
    entry.layers.flight_path = path_polyline;
    entry.layers.launch_marker = launch_marker;
    entry.layers.burst_marker = burst_marker;
}

// Ehime 非BASEバリアント: シングルクリック=トグル, ダブルクリック=経路削除+ポップアップ維持
function attachEhimeVariantClickHandlers(marker, variant_id){
    var clickTimer = null;
    var SINGLE_DELAY = 250; // ダブルクリック判定待ち (ms)

    marker.on('click', function(e){
        // detail>1 (ブラウザが連続クリック回数提供) の場合はダブルクリックハンドラに任せる
        if(e.originalEvent && e.originalEvent.detail > 1){ return; }
        if(clickTimer){ clearTimeout(clickTimer); }
        clickTimer = setTimeout(function(){
            toggleEhimeVariantPath(variant_id);
            clickTimer = null;
        }, SINGLE_DELAY);
    });

    marker.on('dblclick', function(e){
        if(clickTimer){ clearTimeout(clickTimer); clickTimer = null; }
        var entry = ehime_predictions[variant_id];
        if(entry && entry.layers && entry.layers.flight_path){
            try { if(entry.layers.flight_path.remove) entry.layers.flight_path.remove(); } catch(_e){}
            try { if(entry.layers.launch_marker && entry.layers.launch_marker.remove) entry.layers.launch_marker.remove(); } catch(_e){}
            try { if(entry.layers.burst_marker && entry.layers.burst_marker.remove) entry.layers.burst_marker.remove(); } catch(_e){}
            delete entry.layers.flight_path;
            delete entry.layers.launch_marker;
            delete entry.layers.burst_marker;
        }
        // ポップアップを開いたままにする (未開なら開く)
        try { marker.openPopup(); } catch(_e){}
        // 地図のデフォルトダブルクリックズームを抑制 (Leaflet doubleClickZoom オプション有効時)
        if(e.originalEvent && e.originalEvent.preventDefault){ e.originalEvent.preventDefault(); }
        L.DomEvent.stopPropagation(e);
    });
}

function updateEhimeSummaryFromStore(){
    var completed = Object.values(ehime_predictions).filter(p=>p.status==='ok');
    $('#ehime_completed').text(completed.length);
    if(completed.length === 0){ refreshEhimePanel(); updateEhimeCSVLink(); return; }
    var sumLat=0,sumLon=0; completed.forEach(p=>{sumLat+=p.results.landing.latlng.lat; sumLon+=p.results.landing.latlng.lng;});
    var meanLat = sumLat / completed.length;
    var meanLon = sumLon / completed.length;
    $('#ehime_mean').text(meanLat.toFixed(4)+', '+meanLon.toFixed(4));
    var maxDev = 0; completed.forEach(p=>{ var d = distHaversine({lat:meanLat,lng:meanLon},{lat:p.results.landing.latlng.lat,lng:p.results.landing.latlng.lng},2); if(d>maxDev) maxDev = d; });
    $('#ehime_max_dev').text(parseFloat(maxDev).toFixed(2));
    updateEhimeCSVLink();
    refreshEhimePanel();
}
function processTawhiriResults(data, settings, fall_only){
    // Process results from a Tawhiri run.

    if(data.hasOwnProperty('error')){
        // The prediction API has returned an error.
        throwError("Predictor returned error: "+ data.error.description)
    } else {

        var prediction_results = parsePrediction(data.prediction);
        if(fall_only){
            // 上昇区間を除去し、ユーザー指定開始高度へアルティチュードを平行移動
            try {
                var userStartAlt = settings.fall_user_start_alt;
                var descentPath = data.prediction[1].trajectory || [];
                if(descentPath.length>0){
                    var first = descentPath[0];
                    var _lonf=first.longitude; if(_lonf>180)_lonf=_lonf-360.0;
                    var altOffset = first.altitude - userStartAlt; // 減算で開始高度を合わせる
                    var fp=[]; // ポリライン用 (lat,lon,alt)
                    var fp_time=[]; // CSV 用 (lat,lon,alt,datetimeUTC)
                    descentPath.forEach(function(item){
                        var _lat=item.latitude; var _lon=item.longitude; if(_lon>180)_lon=_lon-360.0;
                        var adjAlt = item.altitude - altOffset; if(adjAlt < 0) adjAlt = 0;
                        fp.push([_lat,_lon,adjAlt]);
                        // 各ポイント UTC 時刻を保持 (moment 形式)
                        fp_time.push({lat:_lat, lon:_lon, alt:adjAlt, datetime: moment.utc(item.datetime)});
                    });
                    prediction_results.flight_path = fp;
                    prediction_results.flight_path_time = fp_time; // 追加: 時刻付き配列 (落下のみ CSV 用)
                    // launch 再構成 (開始高度=ユーザー指定)
                    prediction_results.launch = {latlng:L.latLng([first.latitude,_lonf,userStartAlt]), datetime: moment.utc(first.datetime)};
                    // burst は落下専用のダミー (開始点と同じ)
                    prediction_results.burst = prediction_results.launch;
                    // landing altitude もオフセット適用 (地表近似なので 0 に留める)
                    var landingLL = prediction_results.landing.latlng;
                    prediction_results.landing.latlng = L.latLng([landingLL.lat, landingLL.lng, Math.max(0, landingLL.alt - altOffset)]);
                    prediction_results.flight_time = prediction_results.landing.datetime.diff(prediction_results.launch.datetime,'seconds');
                    prediction_results.profile = 'fall_only';
                }
            } catch(e){ appendDebug('落下モード変換失敗: '+e); }
        }

        var extended_results = prediction_results;
        // If Ehime mode, apply burst-altitude margin stats (display only)
        if(settings.pred_type === 'ehime'){
            ehime_current = { base: settings, result: prediction_results };
            // Compute center (landing) and spec ring radii based on ascent/descent variance
            // For simplicity, treat ascent/descent variance as instantaneous speed bands and not re-simulate.
            // Record for UI summary after plotting.
        }
    if(fall_only){
        plotFallOnlyPrediction(extended_results, settings);
    } else {
        plotStandardPrediction(extended_results, settings);
    }
        if(settings.pred_type === 'ehime'){
            updateEhimeSummary([extended_results]);
        }

        writePredictionInfo(settings, data.metadata, data.request, fall_only ? extended_results : null);
        
    }

    //console.log(data);

}

// Update Ehime mode statistical summary (currently single prediction placeholder)
function updateEhimeSummary(predictionArray){
    // predictionArray: array of prediction result objects
    $('#ehime_total').text(predictionArray.length);
    $('#ehime_completed').text(predictionArray.length);
    // Compute mean landing lat/lon
    var sumLat=0, sumLon=0;
    predictionArray.forEach(p=>{sumLat += p.landing.latlng.lat; sumLon += p.landing.latlng.lng;});
    var meanLat = sumLat / predictionArray.length;
    var meanLon = sumLon / predictionArray.length;
    $('#ehime_mean').text(meanLat.toFixed(4)+', '+meanLon.toFixed(4));
    // Max deviation distance from mean (km)
    var maxDev = 0;
    predictionArray.forEach(p=>{
        var d = distHaversine({lat:meanLat,lng:meanLon}, {lat:p.landing.latlng.lat,lng:p.landing.latlng.lng}, 2);
        if(d > maxDev) maxDev = d;
    });
    $('#ehime_max_dev').text(maxDev.toFixed(2));
}

function parsePrediction(prediction){
    // Convert a prediction in the Tawhiri API format to a Polyline.

    var flight_path = [];
    var launch = {};
    var burst = {};
    var landing = {};

    var ascent =  prediction[0].trajectory;
    var descent =  prediction[1].trajectory;

    // Add the ascent track to the flight path array.
    ascent.forEach(function (item, index){
        var _lat = item.latitude;
        // Correct for API giving us longitudes outside [-180, 180]
        var _lon = item.longitude;
        if (_lon > 180.0){
            _lon = _lon - 360.0;
        }

        flight_path.push([_lat, _lon, item.altitude]);
    });

    // Add the Descent or Float track to the flight path array.
    descent.forEach(function (item, index){
        var _lat = item.latitude;
        var _lon = item.longitude;
        // Correct for API giving us longitudes outside [-180, 180]
        if (_lon > 180.0){
            _lon = _lon - 360.0;
        }

        flight_path.push([_lat, _lon, item.altitude]);
    });

    // Populate the launch, burst and landing points
    var launch_obj = ascent[0];
    var _lon = launch_obj.longitude;
    if (_lon > 180.0){
        _lon = _lon - 360.0;
    }
    launch.latlng = L.latLng([launch_obj.latitude, _lon, launch_obj.altitude]);
    launch.datetime = moment.utc(launch_obj.datetime);

    var burst_obj = descent[0];
    var _lon = burst_obj.longitude;
    if (_lon > 180.0){
        _lon = _lon - 360.0;
    }
    burst.latlng = L.latLng([burst_obj.latitude, _lon, burst_obj.altitude]);
    burst.datetime = moment.utc(burst_obj.datetime);

    var landing_obj = descent[descent.length - 1];
    var _lon = landing_obj.longitude;
    if (_lon > 180.0){
        _lon = _lon - 360.0;
    }
    landing.latlng = L.latLng([landing_obj.latitude, _lon, landing_obj.altitude]);
    landing.datetime = moment.utc(landing_obj.datetime);

    var profile = null;
    if(prediction[1].stage == 'descent'){
        profile = 'standard_profile';
    } else {
        profile = 'float_profile';
    }

    var flight_time = landing.datetime.diff(launch.datetime, 'seconds');

    return {'flight_path': flight_path, 'launch': launch, 'burst': burst, 'landing':landing, 'profile': profile, 'flight_time': flight_time};
}

function plotStandardPrediction(prediction, settings){
    appendDebug("Flight data parsed, creating map plot...");
    // 単一タイプ描画時: 既存 Ehime バリアント表示を完全クリア (残存経路対策)
    // settings.pred_type が 'ehime' でない場合、Ehime 由来レイヤを除去
    if(settings && settings.pred_type !== 'ehime'){
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
    if ( f_minutes < 10 ) f_minutes = "0"+f_minutes;
    flighttime = f_hours + "hr" + f_minutes;
    $("#cursor_pred_range").html(range);
    $("#cursor_pred_time").html(flighttime);
    cursorPredShow();

    // Make some nice icons
    var launch_icon = L.icon({
        iconUrl: launch_img,
        iconSize: [10,10],
        iconAnchor: [5,5]
    });

    var land_icon = L.icon({
        iconUrl: land_img,
        iconSize: [10,10],
        iconAnchor: [5,5]
    });

    var burst_icon = L.icon({
        iconUrl: burst_img,
        iconSize: [16,16],
        iconAnchor: [8,8]
    });


    var launch_marker = L.marker(
        launch.latlng,
        {
            title: '離陸地点 ('+launch.latlng.lat.toFixed(4)+', '+launch.latlng.lng.toFixed(4)+') 時刻 ' 
            + launch.datetime.clone().utcOffset(9*60).format("HH:mm") + " JST",
            icon: launch_icon
        }
    ).addTo(map);
    // Build condition popup (launch)
    var cond_html = '';
    if(settings){
        if(settings.profile==='standard_profile'){
            cond_html += '<b>上昇速度:</b> '+settings.ascent_rate+' m/s<br/>';
            cond_html += '<b>下降速度:</b> '+settings.descent_rate+' m/s<br/>';
            cond_html += '<b>破裂高度:</b> '+settings.burst_altitude+' m<br/>';
        } else {
            cond_html += '<b>上昇速度:</b> '+settings.ascent_rate+' m/s<br/>';
            cond_html += '<b>滞留高度:</b> '+settings.float_altitude+' m<br/>';
        }
    }
    var launch_popup = '<b>離陸地点</b><br/>'+cond_html+
        '<b>離陸時刻:</b> '+launch.datetime.clone().utcOffset(9*60).format('YYYY-MM-DD HH:mm')+' JST';
    launch_marker.bindPopup(launch_popup);
    
    var land_marker = L.marker(
        landing.latlng,
        {
            title: '予測着地点 ('+landing.latlng.lat.toFixed(4)+', '+landing.latlng.lng.toFixed(4)+') 時刻 ' 
            + landing.datetime.clone().utcOffset(9*60).format("HH:mm") + " JST",
            icon: land_icon
        }
    ).addTo(map);
    var land_popup = '<b>着地点</b><br/>'+
        '緯度経度: '+(typeof formatCoord==='function'? formatCoord(landing.latlng.lat,'lat')+', '+formatCoord(landing.latlng.lng,'lon') : (landing.latlng.lat.toFixed(4)+', '+landing.latlng.lng.toFixed(4)))+'<br/>'+
        (settings && settings.profile==='standard_profile' ? '<b>上昇/下降:</b> '+settings.ascent_rate+' / '+settings.descent_rate+' m/s<br/>' : '')+
        (settings && settings.profile==='standard_profile' ? '<b>破裂高度:</b> '+settings.burst_altitude+' m<br/>' : (settings?'<b>滞留高度:</b> '+settings.float_altitude+' m<br/>':''))+
        '<b>着地時刻:</b> '+landing.datetime.clone().utcOffset(9*60).format('YYYY-MM-DD HH:mm')+' JST';
    land_marker.bindPopup(land_popup);

    var pop_marker = L.marker(
        burst.latlng,
        {
            title: 'バースト ('+burst.latlng.lat.toFixed(4)+', '+burst.latlng.lng.toFixed(4)+ 
            ' 高度 ' + burst.latlng.alt.toFixed(0) + ') 時刻 ' 
            + burst.datetime.clone().utcOffset(9*60).format("HH:mm") + " JST",
            icon: burst_icon
        }
    ).addTo(map);
    var burst_popup = '<b>破裂地点</b><br/>'+
        '緯度経度: '+(typeof formatCoord==='function'? formatCoord(burst.latlng.lat,'lat')+', '+formatCoord(burst.latlng.lng,'lon') : (burst.latlng.lat.toFixed(4)+', '+burst.latlng.lng.toFixed(4)))+'<br/>'+
        '<b>破裂高度:</b> '+burst.latlng.alt.toFixed(0)+' m<br/>'+
        (settings && settings.profile==='standard_profile' ? '<b>上昇/下降:</b> '+settings.ascent_rate+' / '+settings.descent_rate+' m/s<br/>' : '')+
        '<b>破裂時刻:</b> '+burst.datetime.clone().utcOffset(9*60).format('YYYY-MM-DD HH:mm')+' JST';
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

    // Pan to the new position
    map.setView(launch.latlng,8)

    return true;
}

// 落下のみモード描画
function plotFallOnlyPrediction(prediction, settings){
    appendDebug('落下のみモード: 下降経路を描画');
    clearMapItems();
    var launch = prediction.launch; // 開始点 (元バースト位置)
    var landing = prediction.landing;
    var range = distHaversine(launch.latlng, landing.latlng, 1);
    var flighttime = '';
    var f_hours = Math.floor(prediction.flight_time / 3600);
    var f_minutes = Math.floor(((prediction.flight_time % 86400) % 3600) / 60);
    if ( f_minutes < 10 ) f_minutes = '0'+f_minutes;
    flighttime = f_hours + 'hr' + f_minutes;
    $("#cursor_pred_range").html(range);
    $("#cursor_pred_time").html(flighttime);
    cursorPredShow();

    var launch_icon = L.icon({ iconUrl: launch_img, iconSize:[10,10], iconAnchor:[5,5]});
    var land_icon   = L.icon({ iconUrl: land_img,   iconSize:[10,10], iconAnchor:[5,5]});

    var launch_marker = L.marker(launch.latlng, {title:'落下開始 ('+launch.latlng.lat.toFixed(4)+', '+launch.latlng.lng.toFixed(4)+') 高度 '+launch.latlng.alt.toFixed(0)+'m JST '+launch.datetime.clone().utcOffset(9*60).format('HH:mm'), icon:launch_icon}).addTo(map);
    var land_marker = L.marker(landing.latlng, {title:'着地点 ('+landing.latlng.lat.toFixed(4)+', '+landing.latlng.lng.toFixed(4)+') JST '+landing.datetime.clone().utcOffset(9*60).format('HH:mm'), icon:land_icon}).addTo(map);

    var launch_popup = '<b>落下開始</b><br/>'+
        '位置: '+(typeof formatCoord==='function'? formatCoord(launch.latlng.lat,'lat')+', '+formatCoord(launch.latlng.lng,'lon') : (launch.latlng.lat.toFixed(4)+', '+launch.latlng.lng.toFixed(4)))+'<br/>'+
        '<b>開始高度:</b> '+launch.latlng.alt.toFixed(0)+' m<br/>'+
        '<b>開始時刻:</b> '+launch.datetime.clone().utcOffset(9*60).format('YYYY-MM-DD HH:mm')+' JST<br/>'+
        '<b>下降速度:</b> '+ (settings.descent_rate!=null?settings.descent_rate:'?') +' m/s';
    launch_marker.bindPopup(launch_popup);
    var land_popup = '<b>着地点</b><br/>'+
        '緯度経度: '+(typeof formatCoord==='function'? formatCoord(landing.latlng.lat,'lat')+', '+formatCoord(landing.latlng.lng,'lon') : (landing.latlng.lat.toFixed(4)+', '+landing.latlng.lng.toFixed(4)))+'<br/>'+
        '<b>着地高度:</b> '+landing.latlng.alt.toFixed(0)+' m<br/>'+
        '<b>下降時間:</b> '+flighttime+'<br/>'+
        '<b>着地時刻:</b> '+landing.datetime.clone().utcOffset(9*60).format('YYYY-MM-DD HH:mm')+' JST';
    land_marker.bindPopup(land_popup);

    var path_polyline = L.polyline(prediction.flight_path, {weight:3, color:'#4444aa', dashArray:'4,4'}).addTo(map);
    map_items['launch_marker'] = launch_marker;
    map_items['land_marker'] = land_marker;
    map_items['path_polyline'] = path_polyline;
    map.setView(launch.latlng, 8);
}


// Populate and enable the download CSV, KML and Pan To links, and write the 
// time the prediction was run and the model used to the Scenario Info window
function writePredictionInfo(settings, metadata, request, fall_results) {
    // populate the download links

    // Create the API URLs based on the current prediction settings
    if(fall_results){
        // クライアント側 CSV/KML (簡易) を生成: 下降のみ
        // flight_path_time が存在する場合はそこから UTC 時刻を出力
        var header = 'lat,lon,alt_m,datetime_UTC';
        var csvLines=[header];
        if(Array.isArray(fall_results.flight_path_time)){
            fall_results.flight_path_time.forEach(function(pt){
                var dt = pt.datetime ? pt.datetime.clone().utc().format('YYYY-MM-DD HH:mm:ss') : '';
                csvLines.push(pt.lat.toFixed(6)+','+pt.lon.toFixed(6)+','+pt.alt.toFixed(1)+','+dt);
            });
        } else {
            // 後方互換: 時刻情報が無い場合は空欄
            fall_results.flight_path.forEach(function(p){ csvLines.push(p[0].toFixed(6)+','+p[1].toFixed(6)+','+p[2].toFixed(1)+','); });
        }
        var csvBlob=new Blob([csvLines.join('\n')],{type:'text/csv'});
        var csvUrl=URL.createObjectURL(csvBlob);
        // 命名規則: FallOnly_YYYYMMDD_HHmmJST_<LAT><N/S>_<LON><E/W>_ALT<startAlt>m.csv
        try {
            var launchJst = fall_results.launch && fall_results.launch.datetime ? fall_results.launch.datetime.clone().utcOffset(9*60) : moment();
            var tsJst = launchJst.format('YYYYMMDD_HHmm');
            var lat = fall_results.launch && fall_results.launch.latlng ? fall_results.launch.latlng.lat : 0;
            var lon = fall_results.launch && fall_results.launch.latlng ? fall_results.launch.latlng.lng : 0;
            var latPart = Math.abs(lat).toFixed(3)+(lat>=0?'N':'S');
            var lonPart = Math.abs(lon).toFixed(3)+(lon>=0?'E':'W');
            var startAlt = fall_results.launch && fall_results.launch.latlng && fall_results.launch.latlng.alt!=null ? Math.round(fall_results.launch.latlng.alt) : 0;
            var fname = 'FallOnly_'+tsJst+'JST_'+latPart+'_'+lonPart+'_ALT'+startAlt+'m.csv';
            $('#dlcsv').attr('href', csvUrl).attr('download', fname);
        } catch(_e){
            $('#dlcsv').attr('href', csvUrl).attr('download', 'FallOnly.csv');
        }
        // 簡易 KML
        var kmlPts=fall_results.flight_path.map(function(p){return p[1]+','+p[0]+','+p[2];}).join(' ');
        var kml='<?xml version="1.0" encoding="UTF-8"?>\n'+
            '<kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><name>Fall Only Descent</name><LineString><coordinates>'+kmlPts+'</coordinates></LineString></Placemark></Document></kml>';
        var kmlBlob=new Blob([kml],{type:'application/vnd.google-earth.kml+xml'});
        var kmlUrl=URL.createObjectURL(kmlBlob);
        $("#dlkml").attr("href", kmlUrl).attr('download','fall_only.kml');
    } else {
        _base_url = tawhiri_api + "?" + $.param(settings) 
        _csv_url = _base_url + "&format=csv";
        _kml_url = _base_url + "&format=kml";
        $("#dlcsv").attr("href", _csv_url).removeAttr('download');
        $("#dlkml").attr("href", _kml_url).removeAttr('download');
    }
    $("#panto").click(function() {
            map.panTo(map_items['launch_marker'].getLatLng());
            //map.setZoom(7);
    });

    var run_time = moment.utc(metadata.complete_datetime).clone().utcOffset(9*60).format('YYYY-MM-DD HH:mm');
    var dataset = moment.utc(request.dataset).format("YYYYMMDD-HH");


    $("#run_time").html(run_time);
    $("#dataset").html(dataset);
}


function processHourlyTawhiriResults(data, settings, current_hour){
    // Process results from a Tawhiri run.

    if(data.hasOwnProperty('error')){
        // The prediction API has returned an error.
        throwError("Predictor returned error: "+ data.error.description)
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

function plotMultiplePrediction(prediction, current_hour){

    var launch = prediction.launch;
    var landing = prediction.landing;
    var burst = prediction.burst;


    // Make some nice icons
    var launch_icon = L.icon({
        iconUrl: launch_img,
        iconSize: [10,10],
        iconAnchor: [5,5]
    });


    if(!map_items.hasOwnProperty("launch_marker")){
        var launch_marker = L.marker(
            launch.latlng,
            {
                title: '離陸地点 ('+launch.latlng.lat.toFixed(4)+', '+launch.latlng.lng.toFixed(4)+')',
                icon: launch_icon
            }
        ).addTo(map);

        map_items['launch_marker'] = launch_marker;
    }

    var iconColour = ConvertRGBtoHex(evaluate_cmap((current_hour/MAX_PRED_HOURS), 'turbo'));
    var land_marker= new L.CircleMarker(landing.latlng, {
        radius: 5,
        fillOpacity: 1.0,
        zIndexOffset: 1000,
        fillColor: iconColour,
        stroke: true,
        weight: 1,
        color: "#000000",
    title: '<b>離陸時刻(JST): </b>' + launch.datetime.clone().utcOffset(9*60).format('YYYY-MM-DD HH:mm') + '<br/>' + '予測着地点 ('+landing.latlng.lat.toFixed(4)+', '+landing.latlng.lng.toFixed(4)+')',
        current_hour: current_hour // Added in so we can extract this when we get a click event.
    }).addTo(map);

    var _base_url = tawhiri_api + "?" + $.param(hourly_predictions[current_hour]['settings']) 
    var _csv_url = _base_url + "&format=csv";
    var _kml_url = _base_url + "&format=kml";

    var predict_description =  '<b>離陸時刻(JST): </b>' + launch.datetime.clone().utcOffset(9*60).format('YYYY-MM-DD HH:mm') + '<br/>' + 
    '<b>予測着地点:</b> '+(typeof formatCoord==='function'? formatCoord(landing.latlng.lat,'lat')+', '+formatCoord(landing.latlng.lng,'lon') : (landing.latlng.lat.toFixed(4)+', '+landing.latlng.lng.toFixed(4)))+ '</br>' +
    '<b>着地時刻(JST): </b>' + landing.datetime.clone().utcOffset(9*60).format('YYYY-MM-DD HH:mm') + '<br/>' +
    '<b>ダウンロード: </b> <a href="'+_kml_url+'" target="_blank">KML</a>  <a href="'+_csv_url+'" target="_blank">CSV</a></br>';

    var landing_popup = new L.popup(
        { autoClose: false, 
            closeOnClick: false, 
        }).setContent(predict_description);
    land_marker.bindPopup(landing_popup);
    land_marker.on('click', showHideHourlyPrediction);

    hourly_predictions[current_hour]['layers']['landing_marker'] = land_marker;
    hourly_predictions[current_hour]['landing_latlng'] = landing.latlng;

    // Generate polyline latlons.
    landing_track = [];
    landing_track_complete = true;
    for (i in hourly_predictions){
        if(hourly_predictions[i]['landing_latlng']){
            landing_track.push(hourly_predictions[i]['landing_latlng']);
        }else{
            landing_track_complete = false;
        }
    }
    // If we dont have any undefined elements, plot.
    if(landing_track_complete){
        if(hourly_polyline){
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

        for (i in hourly_predictions){
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

function showHideHourlyPrediction(e){

    // Extract the current hour from the marker options.
    var current_hour = e.target.options.current_hour;
    var current_pred = hourly_predictions[current_hour]['results'];
    var landing = current_pred.landing;
    var launch = current_pred.launch;
    var burst = current_pred.burst;
    

    if(hourly_predictions[current_hour]['layers'].hasOwnProperty('flight_path')){
        // Flight path layer already exists, remove it and the burst icon.
        hourly_predictions[current_hour]['layers']['flight_path'].remove()
        hourly_predictions[current_hour]['layers']['pop_marker'].remove()
        delete hourly_predictions[current_hour]['layers'].flight_path;
        delete hourly_predictions[current_hour]['layers'].pop_marker;

    } else {
        // We need to make new icons.

        var burst_icon = L.icon({
            iconUrl: burst_img,
            iconSize: [16,16],
            iconAnchor: [8,8]
        });

        var pop_marker = L.marker(
            burst.latlng,
            {
                title: 'Balloon burst ('+burst.latlng.lat.toFixed(4)+', '+burst.latlng.lng.toFixed(4)+ 
                ' at altitude ' + burst.latlng.alt.toFixed(0) + ') at ' 
                + burst.datetime.clone().utcOffset(9*60).format("HH:mm") + " JST",
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
    // _base_url = tawhiri_api + "?" + $.param(settings) 
    // _csv_url = _base_url + "&format=csv";
    // _kml_url = _base_url + "&format=kml";


    // $("#dlcsv").attr("href", _csv_url);
    // $("#dlkml").attr("href", _kml_url);
    // $("#panto").click(function() {
    //         map.panTo(map_items['launch_marker'].getLatLng());
    //         //map.setZoom(7);
    // });

    var run_time = moment.utc(metadata.complete_datetime).clone().utcOffset(9*60).format('YYYY-MM-DD HH:mm');
    var dataset = moment.utc(request.dataset).format("YYYYMMDD-HH");


    $("#run_time").html(run_time);
    $("#dataset").html(dataset);
}
