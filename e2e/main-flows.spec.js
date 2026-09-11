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
    const landingCoordinate = page.locator('#pos_list_body [data-coordinate-lat]').first();
    await expect(landingCoordinate).not.toContainText('°');
    await page.locator('#coord_format_toggle').click();
    await expect(landingCoordinate).toContainText('°');
    await page.locator('#coord_format_toggle').click();
    await expect(landingCoordinate).not.toContainText('°');
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

    await page.locator('[data-results-view="history"]').click();
    const commonHistory = page.locator('.run-history-item').first();
    await commonHistory.getByRole('button', { name: '地図表示' }).click();
    await expect(page.locator('.history-ehime-landing-marker')).toHaveCount(13);
    await expect(page.locator('.history-ehime-flight-path')).toHaveCount(0);
    const copiedRunId = await page.evaluate(async (runId) => {
        const record = await window.RunRepository.get(runId);
        const copy = JSON.parse(JSON.stringify(record));
        copy.id = `${runId}_color_copy`;
        await window.HistoryController.showRecord(copy);
        return copy.id;
    }, await commonHistory.getAttribute('data-run-id'));
    await expect(page.locator('.history-ehime-landing-marker')).toHaveCount(26);
    await expect.poll(() => page.evaluate(() => {
        const colors = new Set();
        window.map.eachLayer((layer) => {
            if (layer.options && layer.options.className === 'history-ehime-landing-marker') colors.add(layer.options.color);
        });
        return colors.size;
    })).toBe(2);
    await page.evaluate((runId) => window.HistoryController.hide(runId), copiedRunId);
    await expect(page.locator('.history-ehime-landing-marker')).toHaveCount(13);
    await page.evaluate(() => {
        let marker = null;
        window.map.eachLayer((layer) => {
            if (!marker && layer.options && layer.options.className === 'history-ehime-landing-marker') marker = layer;
        });
        if (!marker) throw new Error('Ehime history landing marker was not found');
        marker.fire('click');
    });
    await expect(page.locator('.history-ehime-flight-path')).toHaveCount(1);
    await page.evaluate(() => {
        let marker = null;
        window.map.eachLayer((layer) => {
            if (!marker && layer.options && layer.options.className === 'history-ehime-landing-marker') marker = layer;
        });
        if (!marker) throw new Error('Ehime history landing marker was not found');
        marker.fire('click');
    });
    await expect(page.locator('.history-ehime-flight-path')).toHaveCount(0);
    await commonHistory.getByRole('button', { name: '地図から消す' }).click();
    await page.locator('[data-results-view="overview"]').click();

    await page.locator('#coord_format_toggle').click();
    await page.evaluate(() => {
        const prediction = Object.values(window.ehime_predictions || {})
            .find((entry) => entry && entry.label === 'ASC-' && entry.marker);
        if (!prediction) throw new Error('ASC- marker was not created');
        prediction.marker.openPopup();
    });
    await expect(page.locator('.leaflet-popup-content')).toContainText('緯度経度:');
    await expect(page.locator('.leaflet-popup-content')).toContainText('°');
    await page.locator('#coord_format_toggle').click();
    await expect(page.locator('.leaflet-popup-content')).not.toContainText('°');

    const legacyHistory = page.locator('#ehime_history_panel');
    await legacyHistory.locator('.ehime-history-replay').first().evaluate((button) => button.click());
    await expect.poll(() => page.evaluate(() => Boolean(window.currentEhimeReplayHistoryId))).toBe(true);
    await expect(page.locator('#clear_replayed_history')).toBeVisible();
    await page.locator('#clear_replayed_history').click();
    await expect.poll(() => page.evaluate(() => Boolean(window.currentEhimeReplayHistoryId))).toBe(false);
    await expect.poll(() => page.evaluate(() => Object.keys(window.ehime_predictions || {}).length)).toBe(0);
});

test('愛媛13条件の実行中に地点を変えると取消になり履歴を削除できる', async ({ app }) => {
    const { page } = app;
    app.setPredictionDelay(500);
    await app.setBaseSettings('ehime');
    await page.locator('#run_pred_btn').click();
    await expect.poll(() => page.evaluate(async () => (await window.RunRepository.getActive('ehime_ensemble')).length)).toBe(1);

    await page.locator('#site').selectOption({ label: '大月町総合グラウンド' });
    await expect.poll(() => page.evaluate(async () => (await window.RunRepository.getActive('ehime_ensemble')).length)).toBe(0);
    await page.locator('.sidebar-tab[data-panel="panel-results"]').click();
    await page.locator('[data-results-view="history"]').click();
    const history = page.locator('.run-history-item').first();
    await expect(history.locator('.run-status-badge')).toHaveText('取消');
    const remove = history.getByRole('button', { name: '削除', exact: true });
    await expect(remove).toBeEnabled();
    await remove.click();
    await history.getByRole('button', { name: 'もう一度押して削除' }).click();
    await expect(history).toBeHidden();
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
    await expect(page.locator('#gas_cylinder_process')).toHaveValue('adiabatic');
    const gasVolumeBeforeProcessChange = await page.locator('#gas_result_volume').textContent();
    const burstBeforeProcessChange = await page.locator('#gas_result_burst').textContent();
    await page.locator('#gas_cylinder_process').selectOption('polytropic');
    await expect(page.locator('#gas_result_volume')).toHaveText(gasVolumeBeforeProcessChange);
    await expect(page.locator('#gas_result_burst')).toHaveText(burstBeforeProcessChange);
    await page.locator('#gas_cylinder_process').selectOption('adiabatic');
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
    await expect(page.locator('#uncertainty_color_mode')).toHaveValue('rgb');
    await expect(page.locator('#uncertainty_show_ellipse')).not.toBeChecked();
    await page.locator('#uncertainty_analysis_mode').selectOption('empirical-2024-2025');
    await expect(page.locator('#uncertainty_empirical_note')).toBeVisible();
    await expect(page.locator('#uncertainty_empirical_note')).toContainText('上昇速度は平均＋10.65%');
    await expect(page.locator('#uncertainty_empirical_note')).toContainText('鉛直気流影響シナリオ');
    await expect(page.locator('#uncertainty_burst_calibration_field')).toBeVisible();
    await expect(page.locator('#uncertainty_burst_calibration_method')).toHaveValue('sphereDiameter');
    await expect(page.locator('#uncertainty_empirical_note')).toContainText('球近似・直径');
    await expect(page.locator('#uncertainty_empirical_note')).toContainText('平均−6.82%・1σ＝7.08%');
    await expect(page.locator('#uncertainty_distribution')).toHaveValue('normal');
    await expect(page.locator('#uncertainty_distribution')).toBeDisabled();
    await expect(page.locator('#uncertainty_ascent_cv')).toHaveValue('20.35');
    await expect(page.locator('#uncertainty_descent_cv')).toHaveValue('26.76');
    await expect(page.locator('#uncertainty_burst_cv')).toHaveValue('7.08');
    await page.locator('#uncertainty_burst_calibration_method').selectOption('ellipsoidLength');
    await expect(page.locator('#uncertainty_empirical_note')).toContainText('楕円体・長さ');
    await expect(page.locator('#uncertainty_empirical_note')).toContainText('平均＋15.28%・1σ＝8.00%');
    await expect(page.locator('#uncertainty_burst_cv')).toHaveValue('8');
    await expect(page.locator('#uncertainty_estimate')).toContainText('上昇 n=8 / 下降 n=7 / 破裂 n=9');
    await page.locator('#uncertainty_analysis_mode').selectOption('probabilistic');
    await expect(page.locator('#uncertainty_distribution')).toBeEnabled();
    await expect(page.locator('#uncertainty_empirical_note')).toBeHidden();
    await expect(page.locator('#uncertainty_ascent_cv')).toHaveValue('10');
    await expect(page.locator('#uncertainty_descent_cv')).toHaveValue('15');
    await expect(page.locator('#uncertainty_burst_cv')).toHaveValue('12');
    await page.locator('#uncertainty_show_ellipse').check();
    await page.locator('#uncertainty_select_none').click();
    await page.locator('#uncertainty_min_samples').fill('4');
    await page.locator('#uncertainty_batch_size').fill('4');
    await page.locator('#uncertainty_max_samples').fill('8');
    await page.locator('#uncertainty_call_limit').fill('9');
    await page.locator('#uncertainty_start').click();
    await expect(page.locator('#uncertainty_status')).toHaveText('完了', { timeout: 20_000 });
    await expect(page.locator('#uncertainty_map_view')).toBeEnabled();
    const beforeColorCalls = app.apiCalls.length;
    await page.locator('#uncertainty_color_mode').selectOption('ascentRate');
    await expect(page.locator('#uncertainty_color_legend')).toContainText('4.00');
    await expect(page.locator('#uncertainty_color_legend')).toContainText('6.00');
    const savedSample = await page.evaluate(() => window.UncertaintyAnalysis.getState().siteRuns[0].observations[0]);
    expect(savedSample.flightTimeSec).toBe(7200);
    expect(savedSample.landingTimeUtc).toBeTruthy();
    expect(savedSample.flightPath.length).toBe(6);
    expect(app.apiCalls.length).toBe(beforeColorCalls);
    await page.locator('#uncertainty_color_mode').selectOption('rgb');
    await expect(page.locator('#uncertainty_color_legend')).toContainText('R＝上昇');
    await expect(page.locator('#uncertainty_color_legend')).toContainText('偏差0で白');
    const central = await page.evaluate(() => window.UncertaintyAnalysis.getState().siteRuns[0].centralObservation);
    expect(central.isCentral).toBe(true);
    expect(central.ascentRate).toBe(5);
    expect(app.apiCalls.length).toBe(beforeColorCalls);
    await page.locator('#uncertainty_color_mode').selectOption('ascentRate');
    await page.locator('#uncertainty_show_density').check();
    await page.locator('#uncertainty_map_view').click();
    await expect(page.locator('#uncertainty_modal')).toBeHidden();
    await expect.poll(() => page.evaluate(() => window.UncertaintyAnalysis.getState().siteRuns[0].observations.filter((row) => !row.error).length)).toBe(8);
    await expect.poll(() => page.evaluate(() => window.UncertaintyAnalysis.isMapVisible())).toBe(true);
    const samplePosition = await page.evaluate(() => {
        let sample;
        window.map.eachLayer(layer => {
            const popup = layer.getPopup && layer.getPopup();
            const content = popup && popup.getContent();
            if (!sample && content && content.textContent && content.textContent.includes('/ サンプル ')) sample = layer;
        });
        if (!sample) throw new Error('Sample marker not found');
        window.map.setView(sample.getLatLng(), 13, { animate: false });
        const point = window.map.latLngToContainerPoint(sample.getLatLng());
        const rect = window.map.getContainer().getBoundingClientRect();
        return { x: rect.left + point.x, y: rect.top + point.y };
    });
    await page.mouse.click(samplePosition.x, samplePosition.y);
    await expect(page.locator('.leaflet-popup-content')).toContainText('着地予定時刻（JST）');
    await expect(page.locator('.leaflet-popup-content')).toContainText('2時間 0分 0秒');
    await expect.poll(() => page.evaluate(() => {
        let found = false;
        window.map.eachLayer(layer => {
            const tip = layer.getTooltip && layer.getTooltip();
            if (tip && String(tip.getContent()).includes('の飛行経路')) found = layer.options.color === '#000000';
        });
        return found;
    })).toBe(true);
    await page.locator('#open_uncertainty_btn').click();
    await page.locator('#uncertainty_map_clear').click();
    await expect.poll(() => page.evaluate(() => window.UncertaintyAnalysis.isMapVisible())).toBe(false);
    await page.locator('#uncertainty_map_view').click();
    await expect.poll(() => page.evaluate(() => window.UncertaintyAnalysis.isMapVisible())).toBe(true);
    const replayRunId = await page.evaluate(() => window.UncertaintyAnalysis.getState().runId);
    await page.evaluate(() => window.UncertaintyAnalysis.hideMap({ source: 'test' }));
    await page.evaluate((runId) => window.HistoryController.show(runId), replayRunId);
    await expect.poll(() => page.evaluate((runId) => window.HistoryController.isVisible(runId), replayRunId)).toBe(true);
    await expect(page.locator('#uncertainty_color_mode')).toHaveValue('rgb');
    const replayDetails = await page.evaluate(() => {
        let central = null;
        let sample = null;
        window.map.eachLayer(layer => {
            const popup = layer.getPopup && layer.getPopup();
            const content = popup && popup.getContent();
            const text = content && content.textContent || '';
            if (text.includes('基準値の予測')) central = { radius: layer.options.radius, fillColor: layer.options.fillColor, text };
            if (!sample && text.includes('/ サンプル ')) sample = { fillColor: layer.options.fillColor, text };
        });
        return { central, sample };
    });
    expect(replayDetails.central).toMatchObject({ radius: 9, fillColor: '#ff0000' });
    expect(replayDetails.sample.fillColor).toMatch(/^rgb\(/);
    expect(replayDetails.sample.text).toContain('着地予定時刻（JST）');
    expect(replayDetails.sample.text).toContain('飛行時間');
    expect(replayDetails.sample.text).toContain('基準値から');
    const secondRunId = await page.evaluate(async (runId) => {
        const source = await window.RunRepository.get(runId);
        const copy = window.RunRecord.clone(source);
        copy.id = runId + '_copy';
        copy.title = '不確実性解析（別履歴）';
        copy.createdAt = new Date(Date.now() + 1000).toISOString();
        copy.updatedAt = copy.createdAt;
        await window.RunRepository.save(copy);
        return copy.id;
    }, replayRunId);
    await page.evaluate(() => document.querySelector('[data-results-view="history"]').click());
    await page.evaluate((runId) => window.HistoryController.show(runId), replayRunId);
    await page.evaluate(() => window.ResultsWorkspace.refreshHistory());
    const firstHistory = page.locator(`.run-history-item[data-run-id="${replayRunId}"]`);
    const secondHistory = page.locator(`.run-history-item[data-run-id="${secondRunId}"]`);
    await expect(firstHistory.locator('button').filter({ hasText: '地図から消す' })).toHaveCount(1);
    await page.evaluate((runId) => {
        const card = document.querySelector(`.run-history-item[data-run-id="${runId}"]`);
        Array.from(card.querySelectorAll('button')).find(button => button.textContent === '地図表示').click();
    }, secondRunId);
    await expect(page.locator('.run-history-item button[aria-pressed="true"]')).toHaveCount(1);
    await expect(page.locator(`.run-history-item[data-run-id="${replayRunId}"] button`).filter({ hasText: /^地図表示$/ })).toHaveCount(1);
    await expect(page.locator(`.run-history-item[data-run-id="${secondRunId}"] button`).filter({ hasText: '地図から消す' })).toHaveCount(1);
});

test('愛媛実験GO基準の27条件を実行して12海里判定を確定する', async ({ app }) => {
    const { page } = app;
    await app.setBaseSettings('single');
    await page.locator('#open_uncertainty_btn').click();
    await page.locator('#uncertainty_select_none').click();
    await page.locator('#uncertainty_analysis_mode').selectOption('ehime-go');
    await expect(page.locator('#uncertainty_ascent_cv')).toBeDisabled();
    await expect(page.locator('#uncertainty_min_samples')).toBeDisabled();
    await expect(page.locator('#uncertainty_estimate')).toContainText('27条件');
    await expect(page.locator('#uncertainty_estimate')).toContainText('12 NM（22.224 km）');
    await page.locator('#uncertainty_start').click();
    await expect(page.locator('#uncertainty_status')).toHaveText('完了', { timeout: 30_000 });
    const result = await page.evaluate(() => {
        const run = window.UncertaintyAnalysis.getState().siteRuns[0];
        return {
            cap: run.cap,
            samples: run.observations.length,
            central: run.centralObservation && run.centralObservation.goLabel,
            assessment: run.goAssessment
        };
    });
    expect(result.cap).toBe(26);
    expect(result.samples).toBe(26);
    expect(result.central).toBe('基準値');
    expect(['go', 'no-go', 'indeterminate']).toContain(result.assessment.status);
    expect(result.assessment.expected).toBe(27);
    expect(result.assessment.coastLimitKm).toBe(22.224);
    expect(app.apiCalls.length).toBe(27);
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

test('範囲外の日付でも年・月・日の入力欄幅を保つ', async ({ app }) => {
    const { page } = app;
    const yearBefore = await page.locator('#year').boundingBox();
    const dayBefore = await page.locator('#day').boundingBox();
    await page.locator('#year').fill('9999');
    await page.locator('#day').fill('99');
    await expect(page.locator('#valid_year')).toBeVisible();
    await expect(page.locator('#valid_day')).toBeVisible();
    await expect(page.locator('#year')).toHaveValue('9999');
    await expect(page.locator('#day')).toHaveValue('99');
    const yearAfter = await page.locator('#year').boundingBox();
    const dayAfter = await page.locator('#day').boundingBox();
    expect(yearAfter.width).toBeGreaterThan(50);
    expect(dayAfter.width).toBeGreaterThan(50);
    expect(Math.abs(yearAfter.width - yearBefore.width)).toBeLessThan(2);
    expect(Math.abs(dayAfter.width - dayBefore.width)).toBeLessThan(2);
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
