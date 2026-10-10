const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync('app/(tabs)/tickets.tsx', 'utf8');
const start = source.indexOf('const styles = StyleSheet.create(');
assert.ok(start >= 0);
const styles = vm.runInNewContext(
  ts.transpile(source.slice(start) + '\nstyles;', { target: ts.ScriptTarget.ES2020 }),
  { StyleSheet: { create: value => value, absoluteFillObject: {} }, Platform: { OS: 'ios' }, Colors: { dark: {} } },
);
assert.equal(styles.tcPosterInfo.position, undefined, 'Title and badge must use normal flow');
assert.equal(styles.tcPoster.height, undefined, 'Poster must grow with long titles and font scaling');
assert.ok(styles.tcAccessBadge.marginBottom >= 12, 'Badge needs its own title clearance');
assert.equal(styles.tcQrWrap.flexShrink, 0, 'Never shrink the QR');
assert.ok(styles.tcQrBox.width >= 106 + 16 + 2, 'QR needs padding and border clearance');
assert.equal(styles.tcBody.flexWrap, 'wrap', 'Narrow cards must wrap instead of overflowing');
assert.ok(styles.tcActionBtn.minHeight >= 44, 'Actions need a usable touch target');
assert.equal(styles.tcActionBtn.height, undefined, 'Actions must grow with larger text');
assert.match(source, /style=\{styles.tcEventName\}>/, 'Long event names must not be truncated');
for (const screenWidth of [320, 360, 375, 390, 414, 430]) {
  const available = screenWidth - 32 - styles.tcBody.paddingHorizontal * 2;
  assert.ok(styles.tcQrWrap.width <= available);
  assert.ok(styles.tcFields.minWidth <= available);
  console.log(`PASS ${screenWidth}px: QR and fields fit individually; row can wrap`);
}
console.log('PASS flow, title, spacing, QR clearance and accessible action sizing');
