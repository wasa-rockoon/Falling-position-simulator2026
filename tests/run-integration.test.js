const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('RunRecord foundation loads before prediction features', () => {
    const html = read('index.html');
    const storage = html.indexOf('js/core/app-storage.js');
    const errors = html.indexOf('js/core/app-errors.js');
    const records = html.indexOf('js/domain/run-record.js');
    const repository = html.indexOf('js/core/run-repository.js');
    const settings = html.indexOf('js/core/settings-repository.js');
    const context = html.indexOf('js/pred/request-context.js');
    const prediction = html.indexOf('js/pred/pred-new.js');
    assert.ok(storage >= 0 && errors > storage && records > errors);
    assert.ok(repository > records && settings > repository);
    assert.ok(context > settings && prediction > context);
});

test('all prediction workflows persist a common RunRecord type', () => {
    const prediction = read('js/pred/pred-new.js');
    const ehime = read('js/pred/ehime-controller.js');
    const autoSearch = read('js/pred/auto-search.js');
    const uncertainty = read('js/pred/uncertainty-analysis.js');
    assert.match(prediction, /startPredictionRunRecord\(run_settings, requestContext, 'single'/);
    assert.match(ehime, /startPredictionRunRecord\(base_settings, requestContext, 'ehime_ensemble'/);
    assert.match(autoSearch, /type:\s*'auto_search'/);
    assert.match(uncertainty, /type:\s*'uncertainty'/);
    assert.match(autoSearch, /RunRepository\.update\(state\.runId/);
    assert.match(uncertainty, /RunRepository\.update\(state\.runId/);
});

test('resumable workflows keep legacy snapshots and common repository fallback', () => {
    const autoSearch = read('js/pred/auto-search.js');
    const uncertainty = read('js/pred/uncertainty-analysis.js');
    for (const source of [autoSearch, uncertainty]) {
        assert.match(source, /resumeSnapshot/);
        assert.match(source, /RunRepository\.getActive/);
        assert.match(source, /await persist/);
    }
    assert.match(autoSearch, /jobStore\s*\?\s*await jobStore\.load\(\)\s*:\s*null/);
    assert.match(uncertainty, /jobStore\s*\?\s*await jobStore\.load\(\)\s*:\s*null/);
});

test('local API fallback preserves the run identity and records the actual endpoint', () => {
    const prediction = read('js/pred/pred-new.js');
    assert.match(prediction, /function createFallbackPredictionRequestContext/);
    assert.match(prediction, /runId:\s*previousContext && previousContext\.runId/);
    assert.match(prediction, /nextContext\.runRecordReady = ready\.then/);
    assert.match(prediction, /Local API validation failed; prediction continued with SondeHub\./);
});

test('legacy settings keys remain behind SettingsRepository autosave', () => {
    const repository = read('js/core/settings-repository.js');
    const predictionCommon = read('js/pred/pred-common.js');
    assert.match(repository, /predictor_presets/);
    assert.match(repository, /predictor_last_settings/);
    assert.match(predictionCommon, /SettingsRepository\.saveLastSettings/);
    assert.match(predictionCommon, /SettingsRepository\.getLastSettings/);
});
