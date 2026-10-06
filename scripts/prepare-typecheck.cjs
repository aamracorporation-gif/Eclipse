'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const appRoot = path.join(root, 'app');
process.env.EXPO_ROUTER_APP_ROOT = appRoot;

// Use the generator shipped with the installed Expo Router version. Do not
// widen Href or suppress TypeScript errors to work around stale route caches.
const { getTypedRoutesDeclarationFile } = require('expo-router/build/typed-routes/generate');
const { default: requireContext } = require('expo-router/build/testing-library/require-context-ponyfill');
const { EXPO_ROUTER_CTX_IGNORE } = require('expo-router/_ctx-shared');
const context = requireContext(appRoot, true, EXPO_ROUTER_CTX_IGNORE);
const declarations = getTypedRoutesDeclarationFile(context);
assert.equal(typeof declarations, 'string', 'Expo Router did not generate route declarations.');
for (const route of ['/box-office', '/auth/callback', '/workers/add']) {
  assert.ok(declarations.includes(route), `Generated route declarations are missing ${route}.`);
}
const output = path.join(root, '.expo', 'types');
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(output, 'router.d.ts'), declarations);

// The standalone preview imports a generated card extracted from the real
// ticket screen. Generate that input without rewriting visual QA artifacts.
const preview = spawnSync(process.execPath, [path.join(__dirname, 'qa/build-sales-preview.cjs'), '--card-only'], {
  cwd: root,
  stdio: 'inherit',
});
if (preview.error) throw preview.error;
assert.equal(preview.status, 0, 'Visual QA card generation failed.');
console.log('Prepared current Expo route types and visual QA card.');
