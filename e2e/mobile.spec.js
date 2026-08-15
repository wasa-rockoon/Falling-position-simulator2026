const { test, expect } = require('./fixture-app');

test('モバイルで主要ダイアログが画面内に収まりキーボードで閉じられる', async ({ app }) => {
    const { page } = app;
    await app.setBaseSettings('single');
    await expect(page.locator('#input_form')).toHaveClass(/mobile-panel-open/);

    await page.locator('#run_auto_search_btn').click();
    const autoDialog = page.getByRole('dialog', { name: /放球自動探索/ });
    await expect(autoDialog).toBeVisible();
    const box = await autoDialog.boundingBox();
    const viewport = page.viewportSize();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
    await page.keyboard.press('Escape');
    await expect(autoDialog).toBeHidden();
    await expect(page.locator('#run_auto_search_btn')).toBeFocused();

    await page.locator('#open_gas_calculator_btn').click();
    await expect(page.getByRole('dialog', { name: 'ガス・破裂高度計算' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#gas_calculator_modal')).toBeHidden();
    await expect(page.locator('#open_gas_calculator_btn')).toBeFocused();
});
