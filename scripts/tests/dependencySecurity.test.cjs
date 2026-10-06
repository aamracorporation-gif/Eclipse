'use strict';

const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const path = require('node:path');
const test = require('node:test');

// Exercise the installed dependencies, not a substitute implementation.
// Sources: GHSA-jqcg-44mw-7w3h and GHSA-pqg4-j6r4-53mv.
const root = path.resolve(__dirname, '../..');

for (const directory of ['.', 'backend']) {
  const fromPackage = createRequire(path.join(root, directory, 'package.json'));
  const proxyaddr = fromPackage('proxy-addr');

  test(`${directory}: mapped IPv6 trust does not trust arbitrary IPv4 clients`, () => {
    const trust = proxyaddr.compile(['::ffff:10.0.0.0/8']);
    assert.equal(trust('203.0.113.42', 0), false);
    assert.equal(trust('198.51.100.10', 0), false);
  });

  test(`${directory}: a broad IPv6 prefix does not trust unrelated IPv4 clients`, () => {
    const trust = proxyaddr.compile(['::/1']);
    assert.equal(trust('203.0.113.42', 0), false);
  });

  test(`${directory}: correctly configured IPv4 trust still works`, () => {
    for (const subnet of ['10.0.0.0/8', '::ffff:10.0.0.0/104']) {
      const trust = proxyaddr.compile([subnet]);
      assert.equal(trust('10.23.45.67', 0), true);
      assert.equal(trust('203.0.113.42', 0), false);
    }
  });
}

const fromRoot = createRequire(path.join(root, 'package.json'));
const { quote, parse } = fromRoot('shell-quote');

for (const separator of ['\n', '\r', '\u2028', '\u2029']) {
  test(`shell-quote: rejects line separator ${JSON.stringify(separator)} after comment`, () => {
    // Only inspect quoting; never launch a shell or execute a payload.
    assert.throws(
      () => quote(['echo', 'ok', { comment: 'note' }, `first${separator}second`]),
      TypeError,
    );
  });
}

test('shell-quote: ordinary arguments retain their round-trip behavior', () => {
  const args = ['echo', 'two words', 'single\'quote', 'double"quote', '$literal'];
  assert.deepEqual(parse(quote(args)), args);
});
