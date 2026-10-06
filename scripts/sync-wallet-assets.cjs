'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

// The checked-in PNGs are the source of truth. This command never renders new
// art or changes signing/authorization code. CI uses --check; --write refreshes
// only the generated WALLET_ASSETS initializer and preserves every other export.
const mode = process.argv[2] || '--check';
assert.ok(['--check', '--write'].includes(mode), 'Use --check or --write.');
const root = path.resolve(__dirname, '..');
const file = path.join(root, 'supabase/functions/apple-wallet-generator/bundledAssets.ts');
const source = fs.readFileSync(file, 'utf8');
const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
assert.equal(ast.parseDiagnostics.length, 0, 'Cannot parse the generated Wallet module.');
const declarations = [];
function visit(node) {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'WALLET_ASSETS') {
    declarations.push(node);
  }
  ts.forEachChild(node, visit);
}
visit(ast);
assert.equal(declarations.length, 1, 'Expected one WALLET_ASSETS declaration.');
const initializer = declarations[0].initializer;
assert.ok(initializer && ts.isObjectLiteralExpression(initializer), 'Expected a literal Wallet asset map.');
const assets = Object.create(null);
for (const property of initializer.properties) {
  assert.ok(ts.isPropertyAssignment(property) && ts.isStringLiteral(property.name) && ts.isStringLiteral(property.initializer), 'Unexpected non-string Wallet asset.');
  const name = property.name.text;
  assert.ok(/^(?:strip_(?:general|vip|backstage|fastlane)|icon|logo)(?:@[23]x)?\.png$/.test(name), 'Unexpected Wallet asset name: ' + name);
  assert.ok(!(name in assets), 'Duplicate Wallet asset: ' + name);
  assets[name] = property.initializer.text;
}
const expected = [];
for (const base of ['strip_general', 'strip_vip', 'strip_backstage', 'strip_fastlane', 'icon', 'logo']) {
  for (const scale of [1, 2, 3]) expected.push(base + (scale === 1 ? '' : '@' + scale + 'x') + '.png');
}
assert.deepEqual(Object.keys(assets).sort(), [...expected].sort(), 'Wallet asset set is incomplete.');
const changed = [];
for (const name of expected) {
  const png = fs.readFileSync(path.join(root, 'assets/wallet-pass', name));
  assert.ok(png.length >= 24 && png.subarray(0, 8).toString('hex') === '89504e470d0a1a0a', 'Invalid PNG: ' + name);
  const scale = Number(name.match(/@([23])x/)?.[1] || 1);
  const size = name.startsWith('strip_') ? [375, 98] : name.startsWith('icon') ? [29, 29] : [132, 32];
  assert.equal(png.readUInt32BE(16), size[0] * scale, 'Incorrect PNG width: ' + name);
  assert.equal(png.readUInt32BE(20), size[1] * scale, 'Incorrect PNG height: ' + name);
  // Boolean comparison avoids constructing a multi-megabyte assertion diff.
  if (!Buffer.from(assets[name], 'base64').equals(png)) changed.push(name);
  assets[name] = png.toString('base64');
}
if (!changed.length) {
  console.log('WALLET_ARTWORK_OK: 18 embedded assets match checked-in PNGs.');
} else {
  console.log('WALLET_ARTWORK_DRIFT: ' + changed.join(', '));
  if (mode === '--check') {
    console.error('Run node scripts/sync-wallet-assets.cjs --write and review the generated module.');
    process.exitCode = 1;
  } else {
    const updated = source.slice(0, initializer.getStart(ast)) + JSON.stringify(assets) + source.slice(initializer.end);
    fs.writeFileSync(file, updated);
    console.log('WALLET_ARTWORK_REFRESHED: ' + changed.length + ' assets; source PNGs and other exports unchanged.');
  }
}
