const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('public documentation links resolve and no longer describe Phase 6 as unimplemented', () => {
    const readme = read('README.md');
    for (const link of readme.matchAll(/\]\(([^)#]+\.md)\)/g)) {
        assert.ok(fs.existsSync(path.join(root, link[1])), link[1]);
    }
    assert.doesNotMatch(readme, /ブラウザ E2E と CI は未導入/);
    assert.doesNotMatch(readme, /BigDataCloud \/ Overpass を沿岸/);
    assert.match(readme, /自動保存/);
    assert.match(readme, /海上率は「下限以上」/);
});

test('CI runs portable build, Node tests and fixture-backed Chromium E2E', () => {
    const workflow = read('.github/workflows/ci.yml');
    const packageJson = JSON.parse(read('package.json'));
    assert.equal(packageJson.scripts.build, 'npm run build:data && npm run build:sw && npm run check');
    assert.equal(packageJson.scripts['test:e2e'], 'playwright test');
    assert.match(workflow, /npm run build/);
    assert.match(workflow, /npm test/);
    assert.match(workflow, /playwright install --with-deps chromium/);
    assert.match(workflow, /npm run test:e2e/);
    assert.doesNotMatch(packageJson.scripts.build, /powershell/i);
});

test('manual acceptance covers the six major workflows and offline constraints', () => {
    const checklist = read('docs/MANUAL_CHECKLIST.md');
    for (const heading of ['通常予測', '愛媛13条件', '放球自動探索', 'ガス・破裂高度計算', '不確実性解析', '履歴・自動保存']) {
        assert.match(checklist, new RegExp(heading));
    }
    assert.match(checklist, /Offline/);
    assert.match(checklist, /公開Tawhiri\/Open-Meteo.*固定API/);
});
