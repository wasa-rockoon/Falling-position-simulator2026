const { test, expect } = require('./fixture-app');

test('モバイルで主要ダイアログが画面内に収まりキーボードで閉じられる', async ({ app }) => {
    const { page } = app;
    await app.setBaseSettings('single');
    await expect(page.locator('#input_form')).toHaveClass(/mobile-panel-open/);
    await expect(page.locator('#api_source')).toBeVisible();
    const apiBox = await page.locator('#api_source').boundingBox();
    expect(apiBox.width).toBeGreaterThan(180);
    await expect(page.locator('.api-source-select-row [data-help-topic="apiSource"]')).toBeVisible();

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

    await expect(page.locator('#mobile_nav_gas')).toBeEnabled();
    await page.locator('#mobile_nav_gas').click();
    const gasDialog = page.getByRole('dialog', { name: 'ガス・破裂高度計算' });
    await expect(gasDialog).toBeVisible();
    const gasBox = await gasDialog.boundingBox();
    expect(gasBox.x).toBeGreaterThanOrEqual(0);
    expect(gasBox.x + gasBox.width).toBeLessThanOrEqual(viewport.width + 1);
    await page.keyboard.press('Escape');
    await expect(gasDialog).toBeHidden();
});
