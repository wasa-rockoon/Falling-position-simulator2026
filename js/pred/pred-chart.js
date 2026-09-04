/*
 * RESULTSグラフ表示: 高度・水平風速を同じ系列選択で最大5件比較する。
 */
(function (root) {
    'use strict';

    var core = root.PredictionChartCore;
    var registry = core ? new core.SeriesRegistry({ maxStored: 20, maxVisible: 5 }) : null;
    var altitudeChart = null;
    var windChart = null;

    function element(id) {
        return root.document ? root.document.getElementById(id) : null;
    }

    function report(error, context) {
        if (typeof root.reportNonFatalError === 'function') root.reportNonFatalError(error, context);
        else if (root.console && root.console.error) root.console.error(context, error);
    }

    function openChartView(anchorId) {
        if (root.AppShell && typeof root.AppShell.switchTab === 'function') root.AppShell.switchTab('results');
        if (root.ResultsWorkspace && typeof root.ResultsWorkspace.activate === 'function') root.ResultsWorkspace.activate('charts');
        root.setTimeout(function () {
            var anchor = element(anchorId);
            if (anchor && typeof anchor.scrollIntoView === 'function') anchor.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 0);
    }

    function toggleChart() {
        openChartView('chart_container');
    }

    function toggleWindChart() {
        openChartView('wind_chart_container');
    }

    function selectedSeries() {
        return registry ? registry.visibleItems() : [];
    }

    function renderSeriesSelector() {
        var container = element('chart_series_selector');
        if (!container || !registry) return;
        var items = registry.snapshot();
        container.replaceChildren();
        if (!items.length) {
            var empty = root.document.createElement('p');
            empty.className = 'chart-series-empty';
            empty.textContent = '予測を実行すると系列を選択できます。';
            container.appendChild(empty);
            return;
        }
        var visibleCount = items.filter(function (item) { return item.visible; }).length;
        items.forEach(function (item) {
            var label = root.document.createElement('label');
            label.className = 'chart-series-option';
            var checkbox = root.document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = item.visible;
            checkbox.disabled = !item.visible && visibleCount >= registry.maxVisible;
            checkbox.setAttribute('aria-label', item.label + 'をグラフに表示');
            var dot = root.document.createElement('span');
            dot.className = 'chart-series-color';
            dot.style.backgroundColor = item.color;
            var text = root.document.createElement('span');
            text.textContent = item.label;
            label.appendChild(checkbox);
            label.appendChild(dot);
            label.appendChild(text);
            checkbox.addEventListener('change', function () {
                var result = registry.setVisible(item.id, checkbox.checked);
                if (!result.ok) {
                    checkbox.checked = item.visible;
                    if (root.showToast) root.showToast('同時に表示できる系列は5件までです。', 'warning', 2400);
                    return;
                }
                renderAll();
            });
            container.appendChild(label);
        });
    }

    function setEmptyState(canvasId, emptyId, empty) {
        var canvas = element(canvasId);
        var placeholder = element(emptyId);
        if (canvas) {
            canvas.hidden = empty;
            var shell = canvas.closest ? canvas.closest('.chart-canvas-shell') : canvas.parentElement;
            if (shell) shell.hidden = empty;
        }
        if (placeholder) placeholder.hidden = !empty;
    }

    function commonOptions(xTitle, yTitle) {
        return {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            parsing: false,
            scales: {
                x: { type: 'linear', position: 'bottom', title: { display: true, text: xTitle }, beginAtZero: true },
                y: { type: 'linear', title: { display: true, text: yTitle }, beginAtZero: true }
            },
            plugins: {
                legend: { display: true, position: 'bottom', labels: { boxWidth: 14, usePointStyle: true } },
                tooltip: { mode: 'nearest', intersect: false }
            },
            interaction: { mode: 'nearest', axis: 'x', intersect: false }
        };
    }

    function renderAltitude(items) {
        var canvas = element('altitude_chart');
        var datasets = items.filter(function (item) { return item.altitude.length; }).map(function (item) {
            return {
                label: item.label,
                data: item.altitude,
                borderColor: item.color,
                backgroundColor: item.color,
                fill: false,
                pointRadius: 0,
                pointHoverRadius: 3,
                borderWidth: 2,
                tension: 0.12
            };
        });
        setEmptyState('altitude_chart', 'altitude_chart_empty', datasets.length === 0);
        if (altitudeChart) { altitudeChart.destroy(); altitudeChart = null; }
        if (!canvas || !datasets.length || typeof root.Chart !== 'function') return;
        altitudeChart = new root.Chart(canvas.getContext('2d'), {
            type: 'line',
            data: { datasets: datasets },
            options: commonOptions('経過時間（分）', '高度（m）')
        });
    }

    function renderWind(items) {
        var canvas = element('wind_chart');
        var datasets = items.filter(function (item) { return item.wind.length; }).map(function (item) {
            return {
                label: item.label,
                data: item.wind,
                borderColor: item.color,
                backgroundColor: item.color,
                pointRadius: 1.2,
                pointHoverRadius: 4,
                showLine: true,
                borderWidth: 1.5,
                fill: false,
                tension: 0.1
            };
        });
        setEmptyState('wind_chart', 'wind_chart_empty', datasets.length === 0);
        if (windChart) { windChart.destroy(); windChart = null; }
        if (!canvas || !datasets.length || typeof root.Chart !== 'function') return;
        var options = commonOptions('水平風速（m/s）', '高度（m）');
        options.plugins.tooltip.callbacks = {
            label: function (context) {
                return context.dataset.label + ': 高度 ' + context.parsed.y.toFixed(0) + ' m / 風速 ' + context.parsed.x.toFixed(1) + ' m/s';
            }
        };
        windChart = new root.Chart(canvas.getContext('2d'), { type: 'scatter', data: { datasets: datasets }, options: options });
    }

    function renderAll() {
        var items = selectedSeries();
        renderSeriesSelector();
        renderAltitude(items);
        renderWind(items);
    }

    function updatePredictionCharts(tawhiriPrediction, options) {
        if (!registry) {
            report(new Error('PredictionChartCore is not loaded'), 'charts.core');
            return [];
        }
        try {
            var snapshot = registry.upsert(tawhiriPrediction, options || {});
            renderAll();
            return snapshot;
        } catch (error) {
            report(error, 'charts.update');
            return registry.snapshot();
        }
    }

    function updateAltitudeChart(tawhiriPrediction, options) {
        return updatePredictionCharts(tawhiriPrediction, options);
    }

    function updateWindChart(tawhiriPrediction, options) {
        return updatePredictionCharts(tawhiriPrediction, options);
    }

    function clearPredictionCharts() {
        if (registry) registry.clear();
        renderAll();
    }

    root.toggleChart = toggleChart;
    root.toggleWindChart = toggleWindChart;
    root.updatePredictionCharts = updatePredictionCharts;
    root.updateAltitudeChart = updateAltitudeChart;
    root.updateWindChart = updateWindChart;
    root.clearPredictionCharts = clearPredictionCharts;
    root.PredictionCharts = {
        update: updatePredictionCharts,
        clear: clearPredictionCharts,
        render: renderAll,
        getSeries: function () { return registry ? registry.snapshot() : []; },
        activate: function () { openChartView('chart_container'); }
    };

    if (root.AppShell && typeof root.AppShell.registerInitializer === 'function') {
        root.AppShell.registerInitializer('prediction-charts', renderAll, 60);
    }
}(typeof globalThis !== 'undefined' ? globalThis : this));
