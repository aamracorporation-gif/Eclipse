const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');
const source = fs.readFileSync('app/(creator)/cancellation-billing.tsx', 'utf8');
const styles = vm.runInNewContext(ts.transpile(source.slice(source.indexOf('const styles = StyleSheet.create(')) + '\nstyles;'),
  { StyleSheet: { create: v => v }, Colors: { dark: {} } });
assert.match(source, /KeyboardAvoidingView/);
assert.match(source, /keyboardShouldPersistTaps="handled"/);
assert.match(source, /keyboardDidShow/);
assert.match(source, /scrollResponderScrollNativeHandleToKeyboard/);
assert.match(source, /paddingBottom: 100 \+ insets.bottom/);
assert.match(source, /if \(!result.cancellationId\)/);
assert.match(source, /setReceipt\(\{ eventId, id: result.cancellationId \}\)/);
assert.match(source, /contentContainerStyle=\{styles.card\}/);
assert.equal(styles.input.textAlignVertical, 'top');
assert.equal(styles.input.height, undefined);
assert.ok(styles.input.minHeight >= 100);
for (const width of [320, 360, 375, 390, 414, 430]) {
  const field = width - 2 * styles.content.padding - 2 * styles.card.padding;
  assert.ok(field >= 240);
  assert.equal(styles.card.height, undefined);
  console.log(`PASS ${width}px: flexible card, ${field}px available field width`);
}
const layout = fs.readFileSync('app/(creator)/_layout.tsx', 'utf8');
assert.match(layout, /name="cancellation-billing" options=\{\{[\s\S]*?tabBarIcon:[^\n]*<Ban/);
assert.match(fs.readFileSync('app/(creator)/organizer-profile.tsx', 'utf8'), /<CancellationShortcut/);
console.log('PASS keyboard, receipt, navigation and profile structural regression checks');
