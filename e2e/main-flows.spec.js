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
});

test('自動探索を候補境界で中断し再開する', async ({ app }) => {
    const { page } = app;
    await app.setBaseSettings('single');
    app.setWeatherDelay(500);
    await page.locator('#run_auto_search_btn').click();
    await expect(page.locator('#auto_search_modal')).toBeVisible();
    await expect(page.locator('#auto_sites_container input')).not.toHaveCount(0);

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

test('ガス計算結果をSETTINGSへ反映する', async ({ app }) => {
    const { page } = app;
    await app.setBaseSettings('single');
    await page.locator('#open_gas_calculator_btn').click();
    await expect(page.getByRole('dialog', { name: 'ガス・破裂高度計算' })).toBeVisible();
    await expect(page.locator('#gas_result_volume')).not.toHaveText('-');
    await page.locator('#gas_ascent_rate').fill('5.5');
    await page.locator('#gas_apply_to_prediction').click();
    await expect(page.locator('#gas_calculator_modal')).toBeHidden();
    await expect(page.locator('#ascent')).toHaveValue('5.50');
    await expect(page.locator('#open_gas_calculator_btn')).toBeFocused();
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
});

test('共通履歴から地図再表示とCSV出力ができる', async ({ app }) => {
    const { page } = app;
    await app.setBaseSettings('single');
    await page.locator('#run_pred_btn').click();
    await expect(page.locator('#results_status_badge')).toHaveText('完了');
    await page.locator('.sidebar-tab[data-panel="panel-results"]').click();
    await page.locator('[data-results-view="history"]').click();
    const history = page.locator('.run-history-item').first();
    await expect(history).toBeVisible();
    await history.getByRole('button', { name: '地図表示' }).click();
    const downloadPromise = page.waitForEvent('download');
    await history.getByRole('button', { name: 'CSV', exact: true }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.csv$/i);
});
