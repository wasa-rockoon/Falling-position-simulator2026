const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ResultsWorkspace = require('../js/core/results-workspace.js');

const root = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'css/predictor.css'), 'utf8');
const repository = fs.readFileSync(path.join(root, 'js/core/run-repository.js'), 'utf8');

test('RESULTS is split into overview, charts and common history views', () => {
    for (const id of ['results_view_overview', 'results_view_charts', 'results_view_history', 'run_history_list']) {
        assert.match(index, new RegExp(`id="${id}"`));
    }
    assert.match(index, /data-results-view="overview"/);
    assert.match(index, /data-results-view="charts"/);
    assert.match(index, /data-results-view="history"/);
    assert.match(css, /\.results-view-tabs/);
    assert.match(css, /[.]run-history-list/);
    assert.doesNotMatch(index, /愛媛気球実験の旧履歴/);
    assert.doesNotMatch(index, /id="run_history_refresh"/);
    assert.match(fs.readFileSync(path.join(root, 'js/core/results-workspace.js'), 'utf8'), /item[.]type !== 'auto_search'/);
});

test('diagnostics is global, form hiding is absent, and scenario summary can pop out', () => {
    const settingsStart = index.indexOf('id="panel-settings"');
    const settingsEnd = index.indexOf('<!-- /panel-settings -->');
    const diagnostics = index.indexOf('id="scenario_template"');
    assert.ok(diagnostics > settingsEnd, 'diagnostics must not be nested in SETTINGS');
    assert.ok(settingsStart >= 0 && settingsEnd > settingsStart);
    assert.doesNotMatch(index, /id="showHideForm"/);
    assert.match(index, /id="popout_metrics_btn"/);
    assert.match(index, /id="metrics_restore_anchor"/);
    assert.match(index, /id="diagnostics_toggle"/);
});

test('planning actions use one UI class and export labels are unambiguous', () => {
    for (const id of ['run_pred_btn', 'run_auto_search_btn', 'open_gas_calculator_btn', 'open_uncertainty_btn']) {
        assert.match(index, new RegExp(`id="${id}" class="[^"]*app-action-btn`));
    }
    assert.doesNotMatch(index, /id="run_batch_btn"/);
    assert.match(index, /id="open_gas_calculator_btn"[^>]*>ガス・破裂高度計算</);
    assert.doesNotMatch(index, /id="open_gas_calculator_btn"[^>]*disabled/);
    assert.doesNotMatch(index, /CSV再出力/);
    assert.match(index, />CSV出力</);
});

test('graphs have informative empty states and a five-series selector', () => {
    for (const id of ['chart_series_selector', 'altitude_chart_empty', 'wind_chart_empty', 'altitude_chart', 'wind_chart']) {
        assert.match(index, new RegExp(`id="${id}"`));
    }
    assert.match(index, /最大5系列/);
    assert.match(css, /\.chart-empty-state/);
});

test('RunRepository emits UI refresh events after every material history mutation', () => {
    for (const action of ['save', 'pin', 'remove', 'clear']) {
        assert.ok(repository.includes(`notifyChange('${action}'`), action);
    }
    assert.match(repository, /wasa:run-repository-change/);
});

test('history labels remain concise and Japanese', () => {
    assert.equal(ResultsWorkspace.typeLabel('uncertainty'), '不確実性解析');
    assert.equal(ResultsWorkspace.statusLabel('pause_requested'), '中断待ち');
    assert.equal(ResultsWorkspace.formatPercent(75), '75%');
    assert.equal(ResultsWorkspace.formatPercent(null), '-');
});
test('display clear preserves saved history and autosaved settings', () => {
    const source = fs.readFileSync(path.join(root, 'js/pred/ehime-enhancements.js'), 'utf8');
    const clearBody = source.match(/function clearAllPredictions\(\) \{([\s\S]*?)\n\}/)[1];
    assert.doesNotMatch(clearBody, /clearEhimeHistoryCache|RunRepository\.remove|localStorage\.removeItem/);
    assert.match(clearBody, /clearPredictionCharts/);
    assert.match(index, /保存履歴は保持/);
});
