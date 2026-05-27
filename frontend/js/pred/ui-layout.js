/*
 * UIレイアウト制御
 * - SETTINGS/RESULTS の表示導線を統一
 * - 既存IDを保持したまま表示モードを切替
 */

(function () {
    var compactObserver = null;

    function isMobileViewport() {
        return window.matchMedia('(max-width: 768px)').matches;
    }

    function textOf(selector, fallback) {
        var value = $.trim($(selector).text() || '');
        if (!value || value === '?' || value === '??') {
            return fallback;
        }
        return value;
    }

    function updateCompactSummary() {
        var runTime = textOf('#run_time', '-');
        var range = textOf('#cursor_pred_range', '-');
        var dataset = textOf('#dataset', '-');

        $('#compact_run_time').text(runTime);
        $('#compact_range').text(range);
        $('#compact_dataset').text(dataset);
    }

    function bindCompactSummaryObserver() {
        if (!window.MutationObserver) {
            return;
        }

        if (compactObserver) {
            compactObserver.disconnect();
        }

        compactObserver = new MutationObserver(function () {
            updateCompactSummary();
        });

        ['run_time', 'cursor_pred_range', 'dataset'].forEach(function (id) {
            var node = document.getElementById(id);
            if (!node) {
                return;
            }
            compactObserver.observe(node, {
                childList: true,
                characterData: true,
                subtree: true
            });
        });
    }

    function setActiveTab(mode) {
        var ids = ['#ui_tab_settings', '#ui_tab_results', '#ui_tab_both', '#ui_tab_map'];
        ids.forEach(function (id) {
            $(id).removeClass('is-active');
        });
        if (mode === 'settings') $('#ui_tab_settings').addClass('is-active');
        if (mode === 'results') $('#ui_tab_results').addClass('is-active');
        if (mode === 'both') $('#ui_tab_both').addClass('is-active');
        if (mode === 'map') $('#ui_tab_map').addClass('is-active');
    }

    function applyLayoutMode(mode) {
        if (isMobileViewport()) {
            $('#ui_dock').hide();
            return;
        }

        $('#ui_dock').show();
        $('#scenario_info').show();

        if (mode === 'settings') {
            $('#input_form').show();
            $('#scenario_info').removeClass('info-compact');
            setActiveTab('settings');
            return;
        }

        if (mode === 'results') {
            $('#input_form').hide();
            $('#scenario_info').removeClass('info-compact');
            setActiveTab('results');
            return;
        }

        if (mode === 'map') {
            $('#input_form').hide();
            $('#scenario_info').removeClass('info-compact');
            setActiveTab('map');
            return;
        }

        // both (default)
        $('#input_form').show();
        $('#scenario_info').removeClass('info-compact');
        setActiveTab('both');
    }

    function bindLayoutEvents() {
        $('#ui_tab_settings').on('click', function () {
            applyLayoutMode('settings');
        });
        $('#ui_tab_results').on('click', function () {
            applyLayoutMode('results');
        });
        $('#ui_tab_both').on('click', function () {
            applyLayoutMode('both');
        });
        $('#ui_tab_map').on('click', function () {
            applyLayoutMode('map');
        });

        // 既存導線との整合: フォーム表示切替リンクを押した後もタブ表示を追従
        $('#showHideForm').on('click', function () {
            setTimeout(function () {
                var formVisible = $('#input_form').is(':visible');
                if (formVisible) {
                    setActiveTab('both');
                    $('#scenario_info').removeClass('info-compact');
                } else {
                    setActiveTab('results');
                    $('#scenario_info').removeClass('info-compact');
                }
            }, 10);
        });

        $(window).on('resize', function () {
            if (isMobileViewport()) {
                $('#ui_dock').hide();
            } else {
                $('#ui_dock').show();
            }
            updateCompactSummary();
        });
    }

    $(function () {
        bindLayoutEvents();
        bindCompactSummaryObserver();
        updateCompactSummary();
        applyLayoutMode('both');
    });
})();
