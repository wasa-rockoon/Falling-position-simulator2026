const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function read(relative) {
    return fs.readFileSync(path.join(root, relative), 'utf8');
}

function runtimeScripts() {
    const html = read('index.html');
    return [...html.matchAll(/<script[^>]+src="([^"]+)"/g)]
        .map((match) => match[1])
        .filter((source) => !/^https?:/i.test(source));
}

function applicationRuntimeScripts() {
    return runtimeScripts().filter((source) => /^(?:js\/(?:core|pred|calc)\/|js\/colour-map\.js$)/.test(source));
}

test('index declares Japanese UTF-8 and contains no inline scripts', () => {
    const html = read('index.html');
    assert.match(html, /<html\s+lang="ja">/);
    assert.match(html, /<meta\s+charset="utf-8">/);
    assert.doesNotMatch(html, /<script(?:\s[^>]*)?>\s*[^<\s]/);
});

test('index element IDs are unique', () => {
    const html = read('index.html');
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
    const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
    assert.deepEqual(duplicates, []);
});

test('core UI modules load before feature modules', () => {
    const html = read('index.html');
    const notifications = html.indexOf('js/core/app-notifications.js');
    const shell = html.indexOf('js/core/app-shell.js');
    const prediction = html.indexOf('js/pred/pred-new.js');
    assert.ok(notifications >= 0 && shell > notifications && prediction > shell);
});

test('application code does not use blocking dialogs or empty catch', () => {
    const files = [
        'js/core/app-storage.js',
        'js/core/app-notifications.js',
        'js/core/app-shell.js',
        'js/pred/auto-search.js',
        'js/pred/ehime-enhancements.js',
        'js/pred/launch-window.js',
        'js/pred/log-overlay.js',
        'js/pred/pred-collaborate.js',
        'js/pred/pred-map.js',
        'js/pred/pred-new.js',
        'js/pred/pred-ui.js',
        'js/calc/calc.js',
        'js/calc/gas-calculator-ui.js',
        'js/colour-map.js'
    ];
    for (const file of files) {
        const source = read(file);
        assert.doesNotMatch(source, /\balert\s*\(/, file);
        assert.doesNotMatch(source, /\b(?:confirm|prompt)\s*\(/, file);
        assert.doesNotMatch(source, /catch\s*\([^)]*\)\s*\{\s*\}/, file);
    }
});

test('runtime feature initialization is centralized in AppShell', () => {
    const scripts = applicationRuntimeScripts();
    const domReadyOwners = scripts.filter((file) => /DOMContentLoaded/.test(read(file)));
    const jqueryReadyOwners = scripts.filter((file) => /\$\s*\(\s*(?:function\s*\(|document\s*\)\.ready)/.test(read(file)));
    assert.deepEqual(domReadyOwners, ['js/core/app-shell.js']);
    assert.deepEqual(jqueryReadyOwners, []);
    assert.match(read('js/core/app-shell.js'), /registerInitializer/);
});

test('pred-new has no duplicate named function declarations', () => {
    const source = read('js/pred/pred-new.js');
    const names = [...source.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g)].map((match) => match[1]);
    const duplicates = [...new Set(names.filter((name, index) => names.indexOf(name) !== index))];
    assert.deepEqual(duplicates, []);
});

test('the shared notification implementation is not overwritten by feature code', () => {
    for (const file of applicationRuntimeScripts().filter((source) => !source.startsWith('js/core/'))) {
        assert.doesNotMatch(read(file), /(?:window|root|globalThis)\.showToast\s*=(?!=)/, file);
    }
});

test('launch-window UI initialization is idempotent', () => {
    const source = read('js/pred/launch-window.js');
    assert.match(source, /var _launchWindowUIInitialized = false;/);
    assert.match(source, /if \(_launchWindowUIInitialized\) return;/);
});

test('planning feature UI stays consistent and exposes map results', () => {
    const html = read('index.html');
    const predictorCss = read('css/predictor.css');
    const uncertaintyTemplate = read('js/pred/uncertainty-template.js');
    const uncertaintySource = read('js/pred/uncertainty-analysis.js');
    const autoSearchSource = read('js/pred/auto-search.js');

    assert.match(html, /id="run_auto_search_btn" class="feature-action-btn"/);
    assert.match(html, /id="popout_metrics_btn" class="panel-icon-button"/);
    assert.match(html, /id="auto_results_count"/);
    assert.match(html, /id="auto_download_btn"[^>]*>CSV出力</);
    assert.match(predictorCss, /\.auto-results-list[\s\S]*max-height:[^;]+;[\s\S]*overflow-y:\s*auto/);
    assert.match(uncertaintyTemplate, /button\.textContent = '不確実性解析'/);
    assert.doesNotMatch(uncertaintyTemplate, /適応的不確実性解析/);
    assert.match(uncertaintyTemplate, /id="uncertainty_map_view"/);
    assert.match(uncertaintySource, /mapLayerControl\.addOverlay/);
    assert.match(uncertaintySource, /root\.L\.circleMarker/);
    assert.match(uncertaintySource, /root\.L\.circle/);
    assert.match(autoSearchSource, /state\.results\.length > 0\) downloadResultsCsv\(\)/);
});
test('single prediction forwards its request context to the result info writer', () => {
    const source = read('js/pred/pred-new.js');
    assert.match(source, /writePredictionInfo\(settings, data\.metadata, data\.request, fall_only \? extended_results : null, requestContext\);/);
    assert.match(source, /function writePredictionInfo\(settings, metadata, request, fall_results, requestContext\)/);
});
test('uncertainty analysis owns and restores its JST launch datetime', () => {
    const template = read('js/pred/uncertainty-template.js');
    const analysis = read('js/pred/uncertainty-analysis.js');
    assert.match(template, /id="uncertainty_launch_date" type="date"/);
    assert.match(template, /id="uncertainty_launch_time" type="time"/);
    assert.match(template, /id="uncertainty_sync_datetime"/);
    assert.match(analysis, /core\.jstDateTimeToUtcIso\(element\('uncertainty_launch_date'\)\.value, element\('uncertainty_launch_time'\)\.value\)/);
    assert.match(analysis, /setLaunchDateTime\(state\.baseSettings\.launch_datetime\)/);
});
test('uncertainty spatial layers can be combined independently', () => {
    const template = read('js/pred/uncertainty-template.js');
    const analysis = read('js/pred/uncertainty-analysis.js');
    for (const id of ['uncertainty_show_points', 'uncertainty_show_ellipse', 'uncertainty_show_density']) {
        assert.match(template, new RegExp(`id="${id}"`));
    }
    assert.match(analysis, /addOverlay\(uncertaintyEllipseLayer, '不確実性: 95%楕円'\)/);
    assert.match(analysis, /addOverlay\(uncertaintyDensityLayer, '不確実性: 密度等高線'\)/);
    assert.match(analysis, /root\.L\.polygon\(summary\.ellipse95\.coordinates/);
    assert.match(analysis, /root\.L\.polyline\(level\.segments/);
});