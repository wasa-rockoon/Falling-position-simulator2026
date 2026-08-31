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
        'js/pred/ehime-controller.js',
        'js/pred/prediction-renderer.js',
        'js/pred/hourly-controller.js',
        'js/pred/prediction-results-ui.js',
        'js/pred/pred-ui.js',
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

test('prediction runtime is split into bounded modules without duplicate declarations', () => {
    const files = ['js/pred/pred-new.js', 'js/pred/ehime-controller.js', 'js/pred/prediction-renderer.js', 'js/pred/hourly-controller.js', 'js/pred/prediction-results-ui.js'];
    const declarations = files.flatMap((file) => [...read(file).matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g)].map((match) => ({ name: match[1], file })));
    const duplicates = [...new Set(declarations.map((item) => item.name).filter((name, index, names) => names.indexOf(name) !== index))];
    assert.deepEqual(duplicates, []);
    assert.ok(read('js/pred/pred-new.js').split(/\r?\n/).length <= 1500);
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

    assert.match(html, /id="run_auto_search_btn" class="app-action-btn"/);
    assert.match(html, /id="popout_metrics_btn"/);
    assert.match(html, /id="results_view_overview"/);
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
    const source = read('js/pred/prediction-renderer.js');
    assert.match(source, /writePredictionInfo\(settings, data\.metadata, data\.request, fall_only \? extended_results : null, requestContext\);/);
    assert.match(source, /function writePredictionInfo\(settings, metadata, request, fall_results, requestContext\)/);
});
test('prediction workflows use the shared runner, variants and export services', () => {
    const html = read('index.html');
    const runnerIndex = html.indexOf('js/pred/prediction-runner.js');
    const variantsIndex = html.indexOf('js/pred/variant-profile-registry.js');
    const predictionIndex = html.indexOf('js/pred/pred-new.js');
    assert.ok(runnerIndex >= 0 && variantsIndex > runnerIndex && predictionIndex > variantsIndex);

    const launchWindow = read('js/pred/launch-window.js');
    const ehime = read('js/pred/ehime-controller.js');
    const autoSearch = read('js/pred/auto-search.js');
    const uncertainty = read('js/pred/uncertainty-analysis.js');
    assert.doesNotMatch(launchWindow, /\$\.get\(api_url/);
    assert.match(launchWindow, /showAutoSearchWeatherPreset/);
    assert.match(ehime, /VariantProfileRegistry\.buildEhime/);
    assert.doesNotMatch(ehime, /function addVariant/);
    assert.match(autoSearch, /PredictionRunner\.run/);
    assert.match(uncertainty, /PredictionRunner\.run/);

    for (const file of ['js/pred/auto-search.js', 'js/pred/uncertainty-analysis.js', 'js/pred/ehime-controller.js', 'js/pred/ehime-enhancements.js', 'js/pred/prediction-renderer.js']) {
        assert.doesNotMatch(read(file), /new Blob|URL\.createObjectURL/, file);
        assert.match(read(file), /ExportService/, file);
    }
});
test('overlapping planning features route to their consolidated workflows', () => {
    const html = read('index.html');
    const autoSearch = read('js/pred/auto-search.js');
    const launchWindow = read('js/pred/launch-window.js');
    const predictionEvents = read('js/pred/pred-event.js');
    const gasTemplate = read('js/calc/gas-calculator-template.js');
    const gasUi = read('js/calc/gas-calculator-ui.js');
    assert.doesNotMatch(html, /id="run_batch_btn"/);
    assert.match(html, /id="run_auto_search_btn"[^>]+showAutoSearchModal/);
    assert.doesNotMatch(html, /id="open_gas_calculator_btn"[^>]*disabled/);
    assert.match(html, new RegExp('js/calc/gas-calculator-ui\\.js'));
    assert.match(html, /id="launch_window_run_btn"[^>]*>時間帯を比較</);
    assert.doesNotMatch(html, /id="launch_window_panel"|id="burst-calc-wrapper"|js\/calc\/calc\.js/);
    assert.match(autoSearch, /function showAllSitesPreset/);
    assert.match(autoSearch, /function showWeatherComparisonPreset/);
    assert.match(launchWindow, /showAutoSearchWeatherPreset/);
    assert.match(predictionEvents, /GasCalculatorUI[.]open/);
    assert.match(gasTemplate, /id="gas_burst_method"/);
    assert.match(gasTemplate, /id="gas_parachute_preset"/);
    assert.match(gasTemplate, /id="gas_parachute_mass"[^>]*type="number"/);
    assert.match(gasTemplate, /id="gas_recovery_equipment_mass"[^>]*type="number"/);
    assert.match(gasTemplate, /value="sphereDiameter" selected/);
    assert.doesNotMatch(gasTemplate, /推奨破裂高度|直径（推奨）/);
    assert.match(gasUi, /selectedBurstKm/);
    assert.match(gasUi, /descent=el\('drag'\)/);
    assert.match(gasUi, /descent[.]value=String\(lastResult[.]inputs[.]terminalVelocityMps\)/);
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
test('bulk workflows can abort the active request before starting a new job', () => {
    const autoSearch = read('js/pred/auto-search.js');
    const uncertainty = read('js/pred/uncertainty-analysis.js');
    const ehime = read('js/pred/ehime-controller.js');
    assert.match(autoSearch, /cancelActiveRequests\(\)[\s\S]*activeAbortController[.]abort\(\)/);
    assert.match(autoSearch, /signal: activeSignal\(\)/);
    assert.match(autoSearch, /await activeRunPromise/);
    assert.match(autoSearch, /中止して新規探索/);
    assert.match(autoSearch, /showModal\(\{ skipRestore: true \}\)/);
    assert.match(uncertainty, /cancelActiveAnalysisRequests\(\)[\s\S]*activeAbortController[.]abort\(\)/);
    assert.match(uncertainty, /signal: activeAbortController \? activeAbortController[.]signal : null/);
    assert.match(uncertainty, /await runningPromise/);
    assert.match(uncertainty, /中止して新規解析/);
    assert.match(ehime, /signal: runtimeOptions[.]signal/);
});
test('bulk workflows share retry-inclusive workload control and resumable boundaries', () => {
    const html = read('index.html');
    const workloadIndex = html.indexOf('js/pred/workload-core.js');
    const autoIndex = html.indexOf('js/pred/auto-search.js');
    const uncertaintyIndex = html.indexOf('js/pred/uncertainty-analysis.js');
    assert.ok(workloadIndex >= 0 && autoIndex > workloadIndex && uncertaintyIndex > workloadIndex);

    const autoSearch = read('js/pred/auto-search.js');
    assert.match(autoSearch, /PredictionApi\.getClient\(\{[\s\S]*api\.open-meteo\.com/);
    assert.doesNotMatch(autoSearch, /root\.fetch\(url\.toString/);
    assert.match(autoSearch, /while \(current\.isSameOrBefore\(endUtc\)\)[\s\S]*sites\.forEach/);
    assert.match(autoSearch, /run13VariantEnsemble\([\s\S]*state\.requestContext[\s\S]*suppressRunRecord: true/);
    assert.match(autoSearch, /state\.status = 'partial'/);
    assert.match(autoSearch, /state\.phaseIndex \+= 1;[\s\S]*partialAtBoundary/);

    const uncertainty = read('js/pred/uncertainty-analysis.js');
    assert.match(uncertainty, /nextRunnableSiteIndex\(state\.currentSiteIndex\)/);
    assert.match(uncertainty, /state\.currentSiteIndex = \(siteIndex \+ 1\) % state\.siteRuns\.length/);
    assert.match(uncertainty, /run\.consecutiveErrors >= 3[\s\S]*run\.status = 'error'/);
    assert.match(uncertainty, /finishPartial\('budget'/);
    assert.match(uncertainty, /retryCount: state\.retryCount/);

    const apiClient = read('js/pred/pred-api-client.js');
    assert.match(apiClient, /maxMemoryEntries/);
    assert.match(apiClient, /_prunePersistentCache/);
    assert.match(apiClient, /client\.inFlight\.has\(key\)/);
});
