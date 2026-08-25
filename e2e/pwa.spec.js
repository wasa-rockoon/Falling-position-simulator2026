const { test, expect } = require('@playwright/test');

test('PWAシェルは更新後も一度だけ起動しオフライン再読込できる', async ({ page, context }) => {
    const pageErrors = [];
    let mainFrameNavigations = 0;
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('framenavigated', (frame) => { if (frame === page.mainFrame()) mainFrameNavigations += 1; });
    await context.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') await route.continue();
        else await route.abort('blockedbyclient');
    });

    await page.goto('/?pwa=1');
    await page.evaluate(async () => {
        const registration = await navigator.serviceWorker.ready;
        if (!registration.active) throw new Error('Service Worker did not activate');
    });
    const cacheNames = await page.evaluate(() => caches.keys());
    expect(cacheNames.filter((name) => name.startsWith('wasa-predictor-app-'))).toHaveLength(1);
    expect(cacheNames.filter((name) => name === 'wasa-predictor-tiles-v1').length).toBeLessThanOrEqual(1);

    await context.setOffline(true);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('#map_canvas')).toBeVisible();
    expect(mainFrameNavigations).toBeLessThanOrEqual(2);
    expect(pageErrors).toEqual([]);
});
