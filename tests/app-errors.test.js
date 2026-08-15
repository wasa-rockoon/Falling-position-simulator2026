const test = require('node:test');
const assert = require('node:assert/strict');
const AppErrors = require('../js/core/app-errors.js');
const RunRecord = require('../js/domain/run-record.js');

test('diagnostic messages redact common credentials and bearer tokens', () => {
    const message = 'GET https://example.test/predict?api_key=secret-value&token=second Authorization: Bearer abc.def-123';
    const safe = AppErrors.sanitizeMessage(message);
    assert.doesNotMatch(safe, /secret-value|second|abc\.def-123/);
    assert.match(safe, /api_key=\[REDACTED\]/);
    assert.match(safe, /Bearer \[REDACTED\]/);
});

test('diagnostic messages and persisted run errors have a bounded size', () => {
    const huge = `failure ${'x'.repeat(5000)}`;
    const serialized = AppErrors.serialize(new Error(huge));
    assert.ok(serialized.technicalMessage.length <= AppErrors.MAX_DIAGNOSTIC_LENGTH + 13);
    assert.match(serialized.technicalMessage, /\[truncated\]$/);

    const record = RunRecord.create({
        type: 'single',
        status: 'failed',
        input: { api: { resolvedBaseUrl: 'https://example.test/?access_token=do-not-store' } },
        error: new Error(huge)
    });
    assert.doesNotMatch(record.input.api.resolvedBaseUrl, /do-not-store/);
    assert.ok(record.error.technicalMessage.length <= AppErrors.MAX_DIAGNOSTIC_LENGTH + 13);
});
