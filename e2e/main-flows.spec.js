const { test, expect } = require('./fixture-app');

test('通常予測を固定APIで実行し結果を描画する', async ({ app }) => {
    const { page } = app;
    await app.setBaseSettings('single');
    await page.locator('#run_pred_btn').click();
    await expect(page.locator('#results_status_badge')).toHaveText('完了');
    await page.locator('.sidebar-tab[data-panel="panel-results"]').click();
    await expect(page.locator('#cursor_pred_links')).toBeVisible();
    await expect(page.locator('#cursor_pred_range')).not.toHaveText('');
    await expect(page.locator('#error_window')).toBeHidden();
    expect(app.apiCalls.filter((url) => url.includes('/api/v1/'))).toHaveLength(1);
});

test('愛媛13条件を完了し複数系列を保存する', async ({ app }) => {
    const { page } = app;
    await app.setBaseSettings('ehime');
    await page.locator('#run_pred_btn').click();
    await expect(page.locator('#ehime_completed')).toHaveText('13', { timeout: 25_000 });
    await page.locator('.sidebar-tab[data-panel="panel-results"]').click();
    await expect(page.locator('#ehime_dlcsv')).toBeVisible();
    await expect.poll(() => app.apiCalls.filter((url) => url.includes('/api/v1/')).length).toBe(13);
    await expect(page.locator('#results_status_badge')).toHaveText('完了');

    const legacyHistory = page.locator('#ehime_history_panel');
    await legacyHistory.locator('.ehime-history-replay').first().evaluate((button) => button.click());
    await expect.poll(() => page.evaluate(() => Boolean(window.currentEhimeReplayHistoryId))).toBe(true);
    await expect(page.locator('#clear_replayed_history')).toBeVisible();
    await page.locator('#clear_replayed_history').click();
    await expect.poll(() => page.evaluate(() => Boolean(window.currentEhimeReplayHistoryId))).toBe(false);
    await expect.poll(() => page.evaluate(() => Object.keys(window.ehime_predictions || {}).length)).toBe(0);
});

test('自動探索を候補境界で中断し再開する', async ({ app }) => {
    const { page } = app;
    await app.setBaseSettings('single');
    app.setWeatherDelay(500);
    await page.locator('#run_auto_search_btn').click();
    await expect(page.locator('#auto_search_modal')).toBeVisible();
    await expect(page.locator('#auto_sites_container input')).not.toHaveCount(0);
    await expect(page.locator('#auto_sites_container .auto-site-option')).toHaveCount(await page.locator('#auto_sites_container input').count());
    await expect(page.locator('#auto_sites_container .auto-site-option').first()).toHaveCSS('display', 'grid');

    await page.locator('#auto_select_none').click();
    await page.locator('#auto_sites_container input').first().check();
    const startDate = await page.locator('#auto_start_date').inputValue();
    const startTime = await page.locator('#auto_start_time').inputValue();
    await page.locator('#auto_end_date').fill(startDate);
    await page.locator('#auto_end_time').fill(startTime);
    await page.locator('#auto_interval_min').fill('15');
    await page.locator('#auto_max_calls').fill('20');
    await page.locator('#auto_action_btn').click();
    await expect(page.locator('#auto_action_btn')).toHaveText('Phase 1 開始');
    await page.locator('#auto_action_btn').click();
    await expect.poll(() => page.evaluate(() => window.__autoSearch.getState().running)).toBe(true);
    await page.locator('#auto_cancel_btn').click();
    await expect.poll(() => page.evaluate(() => window.__autoSearch.getState().status), { timeout: 10_000 }).toBe('paused');
    await expect(page.locator('#auto_action_btn')).toContainText('再開');
    await page.locator('#auto_action_btn').click();
    await expect.poll(() => page.evaluate(() => window.__autoSearch.getState().phase)).toBe(2);
    await expect.poll(() => page.evaluate(() => window.__autoSearch.getState().status)).toBe('ready');
});

test('完了済み自動探索から新規探索へ戻れる', async ({ app }) => {
    const { page } = app;
    await page.evaluate(async () => {
        const snapshot = {
            version: 2,
            runId: 'e2e_completed_auto_search',
            phase: 4,
            status: 'completed',
            running: false,
            pauseRequested: false,
            mode: 'fast',
            queue: [],
            p1Passed: [],
            coarseCandidates: [],
            fineCandidates: [],
            results: [],
            matches: {},
            phaseIndex: 0,
            total: 0,
            done: 0,
            configuration: {
                startDate: '2026-09-01', startTime: '09:00', endDate: '2026-09-01', endTime: '09:00',
                interval: 15, seaThreshold: 75, rainThreshold: 1, windThreshold: 10,
                callLimit: 20, selectedSites: []
            },
            runSettings: {},
            requestConfig: { source: 'local', baseUrl: '/api/v1/', customUrl: '' },
            httpDiagnostics: { httpAttempts: 1, cacheHits: 0, retryCount: 0, failures: 0, lastLabel: '', lastError: null }
        };
        await window.RunRepository.save(window.RunRecord.create({
            id: snapshot.runId,
            type: 'auto_search',
            status: 'completed',
            title: '放球自動探索',
            output: { resumeSnapshot: snapshot, candidates: [] }
        }));
    });

    await page.locator('#run_auto_search_btn').click();
    await expect.poll(() => page.evaluate(() => window.__autoSearch.getState().status)).toBe('completed');
    await expect(page.locator('#auto_action_btn')).toHaveText('完了');
    await page.locator('#auto_new_search_btn').click();
    await expect.poll(() => page.evaluate(() => window.__autoSearch.getState().status)).toBe('idle');
    await expect.poll(() => page.evaluate(() => window.__autoSearch.getState().phase)).toBe(0);
    await expect(page.locator('#auto_action_btn')).toHaveText('条件確定・見積り');
    await expect(page.locator('#auto_new_search_btn')).toHaveText('新規探索');
});
test('自動探索履歴のCSVは保存された探索候補を出力する', async ({ app }) => {
    const { page } = app;
    await page.evaluate(async () => {
        const record = window.RunRecord.create({
            id: 'e2e_auto_search_csv',
            type: 'auto_search',
            status: 'completed',
            title: '放球自動探索',
            output: {
                candidates: [{
                    timeJst: '2026/08/27 13:25',
                    site: '南レク松軒山公園',
                    mode: 'full',
                    ascentRate: 5,
                    descentRate: 5,
                    burstAltitude: 30000,
                    seaPct: 85,
                    maxOffshoreKm: 8.65,
                    supportName: '柏島漁港',
                    supportDistanceKm: 9.4,
                    supportHasHistory: true
                }]
            }
        });
        await window.RunRepository.save(record);
    });

    await page.locator('.sidebar-tab[data-panel="panel-results"]').click();
    await page.locator('[data-results-view="history"]').click();
    const history = page.locator('.run-history-item[data-run-id="e2e_auto_search_csv"]');
    await expect(history).toBeVisible();
    await expect(history.getByRole('button', { name: '地図表示' })).toHaveCount(0);
    await expect(history.getByRole('button', { name: 'KML', exact: true })).toHaveCount(0);

    const downloadPromise = page.waitForEvent('download');
    await history.getByRole('button', { name: 'CSV', exact: true }).click();
    const download = await downloadPromise;
    const stream = await download.createReadStream();
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    const csv = Buffer.concat(chunks).toString('utf8');
    expect(csv).toContain('日時(JST),地点,探索モード');
    expect(csv).toContain('南レク松軒山公園,全候補精密探索（粗探索で除外しない）');
    expect(csv).toContain('85,8.7,柏島漁港,9.4,あり');
});
test('2026年版ガス計算を実行し予測条件へ反映する', async ({ app }) => {
    const { page } = app;
    await page.locator('#open_gas_calculator_btn').click();
    await expect(page.getByRole('dialog', { name: 'ガス・破裂高度計算' })).toBeVisible();
    await expect(page.locator('#gas_process_result_body tr')).toHaveCount(3);
    await expect(page.locator('#gas_burst_result_body tr')).toHaveCount(4);
    await expect(page.locator('#gas_burst_method')).toHaveValue('sphereDiameter');
    await page.locator('#gas_burst_method').selectOption('ellipsoidLength');
    await expect(page.locator('#gas_burst_result_body tr[data-burst-method="ellipsoidLength"]')).toHaveClass(/is-selected/);
    await expect(page.locator('#gas_burst_result_body tr[data-burst-method="sphereDiameter"]')).not.toHaveClass(/is-selected/);
    await page.locator('#gas_terminal_velocity').fill('6.25');
    await page.locator('#gas_cylinder_2_pressure').fill('12');
    await expect(page.locator('#gas_result_volume')).not.toHaveText('-');
    const expectedBurst = await page.locator('#gas_result_burst').textContent();
    await page.locator('#gas_apply_to_prediction').click();
    await expect(page.locator('#gas_calculator_modal')).toBeHidden();
    expect(Number(await page.locator('#drag').inputValue())).toBe(6.25);
    expect(Number(await page.locator('#burst').inputValue())).toBe(Math.round(Number.parseFloat(expectedBurst) * 1000));
    await page.locator('#open_gas_calculator_btn').click();
    await expect(page.locator('#gas_burst_method')).toHaveValue('ellipsoidLength');
    await page.keyboard.press('Escape');
});
test('不確実性解析を完了し密度等高線を地図表示する', async ({ app }) => {
    const { page } = app;
    await app.setBaseSettings('single');
    await page.locator('#open_uncertainty_btn').click();
    await expect(page.getByRole('dialog', { name: '不確実性解析' })).toBeVisible();
    await page.locator('#uncertainty_select_none').click();
    await page.locator('#uncertainty_min_samples').fill('4');
    await page.locator('#uncertainty_batch_size').fill('4');
    await page.locator('#uncertainty_max_samples').fill('8');
    await page.locator('#uncertainty_call_limit').fill('8');
    await page.locator('#uncertainty_start').click();
    await expect(page.locator('#uncertainty_status')).toHaveText('完了', { timeout: 20_000 });
    await expect(page.locator('#uncertainty_map_view')).toBeEnabled();
    await page.locator('#uncertainty_show_density').check();
    await page.locator('#uncertainty_map_view').click();
    await expect(page.locator('#uncertainty_modal')).toBeHidden();
    await expect.poll(() => page.evaluate(() => window.UncertaintyAnalysis.getState().siteRuns[0].observations.filter((row) => !row.error).length)).toBe(8);
    await expect.poll(() => page.evaluate(() => window.UncertaintyAnalysis.isMapVisible())).toBe(true);
    await page.locator('#open_uncertainty_btn').click();
    await page.locator('#uncertainty_map_clear').click();
    await expect.poll(() => page.evaluate(() => window.UncertaintyAnalysis.isMapVisible())).toBe(false);
    await page.locator('#uncertainty_map_view').click();
    await expect.poll(() => page.evaluate(() => window.UncertaintyAnalysis.isMapVisible())).toBe(true);
});

test('機能ウィンドウのヘルプを開いたまま自動探索を入力できる', async ({ app }) => {
    const { page } = app;
    await expect(page.locator('.form-actions .context-help-trigger')).toHaveCount(0);
    await page.locator('#run_auto_search_btn').click();
    await expect(page.locator('#auto_search_modal')).toBeVisible();
    await page.locator('#auto_search_modal [data-help-topic="autoSearch"]').click();
    await expect(page.locator('#context_help_panel')).toBeVisible();
    await expect(page.locator('#context_help_title')).toHaveText('放球自動探索');
    await expect(page.locator('#context_help_body')).toContainText('海率下限');
    await page.locator('#auto_start_time').fill('09:30');
    await expect(page.locator('#auto_start_time')).toHaveValue('09:30');
    await page.locator('#context_help_close').click();
    await expect(page.locator('#context_help_panel')).toBeHidden();
});

test('API接続先の選択欄を保ちながら公開用とローカル用の説明を確認できる', async ({ app }) => {
    const { page } = app;
    await page.setViewportSize({ width: 820, height: 900 });
    await expect(page.locator('#api_source')).toBeVisible();
    const selectBox = await page.locator('#api_source').boundingBox();
    expect(selectBox.width).toBeGreaterThan(100);
    await page.locator('.api-source-select-row [data-help-topic="apiSource"]').click();
    await expect(page.locator('#context_help_title')).toHaveText('API接続先');
    await expect(page.locator('#context_help_body')).toContainText('SondeHub (Public)');
    await expect(page.locator('#context_help_body')).toContainText('開発・現地PC');
});

test('範囲外のバースト高度でも入力値と入力欄幅を保つ', async ({ app }) => {
    const { page } = app;
    const before = await page.locator('#burst').boundingBox();
    await page.locator('#burst').fill('999999');
    await expect(page.locator('#valid_burst')).toBeVisible();
    await expect(page.locator('#burst')).toHaveValue('999999');
    const after = await page.locator('#burst').boundingBox();
    expect(after.width).toBeGreaterThan(100);
    expect(Math.abs(after.width - before.width)).toBeLessThan(2);
});

test('地図上の全結果消去は表と保存履歴を保持する', async ({ app }) => {
    const { page } = app;
    await app.setBaseSettings('single');
    await page.locator('#run_pred_btn').click();
    await expect(page.locator('#results_status_badge')).toHaveText('完了');
    await page.locator('.sidebar-tab[data-panel="panel-results"]').click();
    const rowCount = await page.locator('#pos_list_body tr').count();
    await page.locator('[data-results-view="history"]').click();
    const historyCount = await page.locator('.run-history-item').count();
    await page.locator('[data-results-view="overview"]').click();
    await page.locator('#clear_map_results_btn').click();
    await expect(page.locator('#pos_list_body tr')).toHaveCount(rowCount);
    await page.locator('[data-results-view="history"]').click();
    await expect(page.locator('.run-history-item')).toHaveCount(historyCount);
});
test('シナリオ概要はPCで既定表示されRESULTSへ戻せる', async ({ app }) => {
    const { page } = app;
    const summary = page.locator('#scenario_info_floating_container');
    const toggle = page.locator('#popout_metrics_btn');
    await expect(summary).toHaveClass(/floating-metrics-mode/);
    await expect(toggle).toHaveText('RESULTSへ戻す');
    await expect.poll(() => summary.evaluate((element) => element.parentElement === document.body)).toBe(true);
    await toggle.click();
    await expect(summary).not.toHaveClass(/floating-metrics-mode/);
    await expect(toggle).toHaveText('外に出す');
    await expect.poll(() => summary.evaluate((element) => element.parentElement && element.parentElement.id)).toBe('results_view_overview');
    await page.locator('.sidebar-tab[data-panel="panel-results"]').click();
    await toggle.click();
    await expect(summary).toHaveClass(/floating-metrics-mode/);
});

test('共通履歴の地図表示を解除でき、履歴削除時にも表示が残らない', async ({ app }) => {
    const { page } = app;
    await app.setBaseSettings('single');
    await page.locator('#run_pred_btn').click();
    await expect(page.locator('#results_status_badge')).toHaveText('完了');
    await page.locator('.sidebar-tab[data-panel="panel-results"]').click();
    await page.locator('[data-results-view="history"]').click();
    const history = page.locator('.run-history-item').first();
    await expect(history).toBeVisible();
    const runId = await history.getAttribute('data-run-id');

    await history.getByRole('button', { name: '地図表示' }).click();
    await expect(history.getByRole('button', { name: '地図から消す' })).toBeVisible();
    await expect.poll(() => page.evaluate((id) => window.HistoryController.isVisible(id), runId)).toBe(true);

    await history.getByRole('button', { name: '地図から消す' }).click();
    await expect(history.getByRole('button', { name: '地図表示' })).toBeVisible();
    await expect.poll(() => page.evaluate((id) => window.HistoryController.isVisible(id), runId)).toBe(false);

    await history.getByRole('button', { name: '地図表示' }).click();
    const downloadPromise = page.waitForEvent('download');
    await history.getByRole('button', { name: 'CSV', exact: true }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/.csv$/i);

    const remove = history.locator('.result-text-button-danger');
    await remove.click();
    await expect(remove).toHaveText('もう一度押して削除');
    await remove.click();
    await expect(history).toBeHidden();
    await expect.poll(() => page.evaluate((id) => window.HistoryController.isVisible(id), runId)).toBe(false);
});
