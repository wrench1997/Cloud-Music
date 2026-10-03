const test = require('node:test');
const assert = require('node:assert/strict');
const { parseOAuthConfig, validateDesktopConfig, validateWebClientId } = require('../src/lib/google-config');

test('downloaded desktop JSON accepts a BOM and rejects malformed or oversized input with a useful error', () => {
  const config = parseOAuthConfig('\uFEFF{"installed":{"client_id":"desktop.apps.googleusercontent.com","client_secret":"desktop-secret"}}');
  assert.deepEqual(validateDesktopConfig(config), { clientId: 'desktop.apps.googleusercontent.com', clientSecret: 'desktop-secret' });
  for (const text of ['null', '[]', 'not-json', 'a'.repeat(65537)]) assert.throws(() => parseOAuthConfig(text), /配置|JSON/);
  assert.throws(() => validateDesktopConfig(null), /桌面应用/);
  assert.throws(() => validateDesktopConfig({ installed: { client_id: 'desktop.apps.googleusercontent.com', client_secret: {} } }), /桌面应用/);
});

test('web configuration extracts only the public ID and rejects desktop clients and unsafe URLs', () => {
  const clientId = 'web.apps.googleusercontent.com';
  assert.equal(validateWebClientId(` ${clientId} `), clientId);
  assert.equal(validateWebClientId(JSON.stringify({ web: { client_id: clientId, client_secret: 'must-not-be-saved' } })), clientId);
  for (const text of ['https://untrusted.example', '{"installed":{"client_id":"desktop.apps.googleusercontent.com"}}', '{"web":{"client_id":"web.apps.googleusercontent.com/redirect"}}']) {
    assert.throws(() => validateWebClientId(text), /Web 应用/);
  }
});
