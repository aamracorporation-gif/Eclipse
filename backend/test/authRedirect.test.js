const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_ANON_KEY = 'test-anon';
process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
const { createApp } = require('../src/app');

test('auth bridge works with Helmet CSP and keeps signup and recovery parameters', async () => {
  const server = createApp().listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const response = await fetch(`${origin}/auth/verify?token_hash=abc%2B123&type=signup`);
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-security-policy'), /script-src 'self'/);
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    assert.match(html, /src="\/auth\/open.js" defer/);
    assert.match(html, /eclipse:\/\/auth\/callback\?token_hash=abc%2B123&amp;type=signup/);
    assert.doesNotMatch(html, /<script>/);
    const script = await (await fetch(`${origin}/auth/open.js`)).text();
    for (const [hash, expected] of [
      ['', 'eclipse://auth/callback?token_hash=abc%2B123&type=signup'],
      ['#access_token=a&refresh_token=b&type=recovery', 'eclipse://auth/reset-password?token_hash=abc%2B123&type=signup&access_token=a&refresh_token=b&type=recovery'],
    ]) {
      const button = { getAttribute: () => 'eclipse://auth/callback?token_hash=abc%2B123&type=signup', href: '' };
      const window = { location: { hash, href: '' } };
      vm.runInNewContext(script, { URLSearchParams, window, document: { getElementById: id => id === 'openBtn' ? button : null } });
      assert.equal(button.href, expected);
      assert.equal(window.location.href, expected);
    }
    const malicious = await (await fetch(`${origin}/auth/verify?code=${encodeURIComponent('</script><img src=x onerror=alert(1)>')}`)).text();
    assert.doesNotMatch(malicious, /<img src=x/);
    const reset = await (await fetch(`${origin}/auth/reset-password?token_hash=example`)).text();
    assert.match(reset, /eclipse:\/\/auth\/reset-password\?token_hash=example&amp;type=recovery/);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
