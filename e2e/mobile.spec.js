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

    await expect(page.locator('#open_gas_calculator_btn')).toBeDisabled();
    await expect(page.locator('#mobile_nav_gas')).toBeDisabled();
});
