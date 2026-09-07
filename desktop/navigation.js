'use strict';
function isSimulator(value) { try { const url = new URL(value); return url.origin === 'http://localhost:3100'; } catch (_) { return false; } }
function allowedExternal(value) { try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; } catch (_) { return false; } }
module.exports = { isSimulator, allowedExternal };
