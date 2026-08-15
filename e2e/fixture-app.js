const { test: base, expect } = require('@playwright/test');

function isoAt(base, minutes) {
    return new Date(new Date(base).getTime() + minutes * 60_000).toISOString();
}

function predictionResponse(requestUrl, sequence) {
    const url = new URL(requestUrl);
    const latitude = Number(url.searchParams.get('launch_latitude') || 33.13492);
    let longitude = Number(url.searchParams.get('launch_longitude') || 132.50477);
    if (longitude > 180) longitude -= 360;
    const altitude = Number(url.searchParams.get('launch_altitude') || 1.4);
    const ascent = Number(url.searchParams.get('ascent_rate') || 5);
    const descent = Number(url.searchParams.get('descent_rate') || 5);
    const burst = Number(url.searchParams.get('burst_altitude') || 30_000);
    const launch = url.searchParams.get('launch_datetime') || '2026-08-15T00:00:00.000Z';
    const variation = ((ascent - 5) * 0.004) - ((descent - 5) * 0.003) + ((burst - 30_000) / 2_000_000) + ((sequence % 7) - 3) * 0.0007;
    const landingLatitude = latitude - 0.2 + variation;
    const landingLongitude = longitude + 0.15 + variation * 0.7;
    const complete = isoAt(launch, 121);

    return {
        request: { dataset: launch },
        metadata: { complete_datetime: complete },
        prediction: [
            {
                stage: 'ascent',
                trajectory: [
                    { datetime: isoAt(launch, 0), latitude, longitude, altitude },
                    { datetime: isoAt(launch, 30), latitude: latitude - 0.03, longitude: longitude + 0.04, altitude: Math.max(altitude + 100, burst * 0.5) },
                    { datetime: isoAt(launch, 60), latitude: latitude - 0.08, longitude: longitude + 0.09, altitude: burst }
                ]
            },
            {
                stage: 'descent',
                trajectory: [
                    { datetime: isoAt(launch, 60), latitude: latitude - 0.08, longitude: longitude + 0.09, altitude: burst },
                    { datetime: isoAt(launch, 90), latitude: latitude - 0.14, longitude: longitude + 0.12, altitude: burst * 0.45 },
                    { datetime: isoAt(launch, 120), latitude: landingLatitude, longitude: landingLongitude, altitude: 0 }
                ]
            }
        ]
    };
}

function weatherResponse(requestUrl) {
    const url = new URL(requestUrl);
    const date = url.searchParams.get('start_date') || '2026-08-15';
    const time = [];
    const precipitation = [];
    const wind = [];
    for (let hour = 0; hour < 24; hour += 1) {
        time.push(`${date}T${String(hour).padStart(2, '0')}:00`);
        precipitation.push(0);
        wind.push(3.5);
    }
    return { hourly: { time, precipitation, wind_speed_10m: wind } };
}

async function setBaseSettings(page, predictionType = 'single') {
    await page.evaluate((type) => {
        const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
        const values = {
            year: now.getUTCFullYear(), month: now.getUTCMonth() + 1, day: now.getUTCDate(),
            hour: now.getUTCHours(), min: now.getUTCMinutes(), lat: 33.13492, lon: 132.50477,
            initial_alt: 1.4, ascent: 5, drag: 5, burst: 30000,
            flight_profile: 'standard_profile', prediction_type: type, api_source: 'local'
        };
        Object.entries(values).forEach(([id, value]) => {
            const element = document.getElementById(id);
            if (!element) throw new Error(`Missing fixture field: ${id}`);
            element.value = String(value);
            element.dispatchEvent(new Event('change', { bubbles: true }));
        });
    }, predictionType);
}

const test = base.extend({
    app: async ({ page }, use) => {
        const pageErrors = [];
        const localAssetFailures = [];
        const publicRequestsBlocked = [];
        const apiCalls = [];
        let predictionSequence = 0;
        let predictionDelayMs = 0;
        let weatherDelayMs = 0;

        page.on('pageerror', (error) => pageErrors.push(error.message));
        page.on('response', (response) => {
            const url = new URL(response.url());
            if ((url.hostname === 'localhost' || url.hostname === '127.0.0.1') && response.status() === 404) {
                localAssetFailures.push(url.pathname);
            }
        });

        await page.route('**/*', async (route) => {
            const request = route.request();
            const url = new URL(request.url());
            const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
            if (local && url.pathname.startsWith('/api/v1/')) {
                apiCalls.push(url.toString());
                predictionSequence += 1;
                if (predictionDelayMs) await new Promise((resolve) => setTimeout(resolve, predictionDelayMs));
                await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(predictionResponse(url, predictionSequence)) });
                return;
            }
            if (url.hostname === 'api.open-meteo.com') {
                apiCalls.push(url.toString());
                if (weatherDelayMs) await new Promise((resolve) => setTimeout(resolve, weatherDelayMs));
                await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(weatherResponse(url)) });
                return;
            }
            if (local) {
                await route.continue();
                return;
            }
            publicRequestsBlocked.push(url.toString());
            await route.abort('blockedbyclient');
        });

        await page.goto('/');
        await page.waitForFunction(() => Boolean(window.AppShell && window.PredictionRunner && document.getElementById('gas_calculator_modal') && document.getElementById('uncertainty_modal')));

        await use({
            page,
            apiCalls,
            publicRequestsBlocked,
            setPredictionDelay: (milliseconds) => { predictionDelayMs = milliseconds; },
            setWeatherDelay: (milliseconds) => { weatherDelayMs = milliseconds; },
            setBaseSettings: (type) => setBaseSettings(page, type)
        });

        expect(pageErrors, 'unhandled browser errors').toEqual([]);
        expect(localAssetFailures, 'same-origin asset 404 responses').toEqual([]);
    }
});

module.exports = { test, expect, setBaseSettings };
