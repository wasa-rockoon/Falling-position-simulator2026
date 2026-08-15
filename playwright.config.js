const { defineConfig, devices } = require('@playwright/test');

const port = String(process.env.PLAYWRIGHT_PORT || 4173);
const baseURL = `http://localhost:${port}`;

module.exports = defineConfig({
    testDir: './e2e',
    fullyParallel: false,
    forbidOnly: Boolean(process.env.CI),
    retries: process.env.CI ? 1 : 0,
    workers: process.env.CI ? 1 : undefined,
    timeout: 45_000,
    expect: { timeout: 10_000 },
    reporter: process.env.CI ? [['line'], ['html', { open: 'never' }]] : 'line',
    use: {
        baseURL,
        acceptDownloads: true,
        serviceWorkers: 'block',
        trace: 'retain-on-failure'
    },
    webServer: {
        command: 'node cors-proxy.js',
        url: `${baseURL}/__server-info`,
        env: { ...process.env, PORT: port },
        reuseExistingServer: !process.env.CI,
        timeout: 30_000,
        stdout: 'ignore',
        stderr: 'pipe'
    },
    projects: [
        {
            name: 'chromium-desktop',
            testMatch: /main-flows\.spec\.js/,
            use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 768 } }
        },
        {
            name: 'chromium-mobile',
            testMatch: /mobile\.spec\.js/,
            use: { ...devices['Pixel 5'], serviceWorkers: 'block' }
        },
        {
            name: 'chromium-pwa',
            testMatch: /pwa\.spec\.js/,
            use: { ...devices['Desktop Chrome'], serviceWorkers: 'allow' }
        }
    ]
});
