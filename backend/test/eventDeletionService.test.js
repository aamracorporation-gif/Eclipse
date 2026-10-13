const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function service({ owner = 'organizer', error = null, deleted = { id: 'event' } } = {}) {
  const filters = [];
  let deleting = false;
  const query = {
    select() { return this; },
    eq(key, value) { if (deleting) filters.push([key, value]); return this; },
    delete() { deleting = true; return this; },
    async maybeSingle() {
      return deleting ? { data: deleted, error } : { data: { id: 'event', creator_id: owner }, error: null };
    },
  };
  const sandbox = {
    module: { exports: {} },
    require: () => ({ supabaseAdmin: { from: () => query } }),
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/services/eventService.js'), 'utf8'), sandbox);
  return {
    filters,
    run: () => sandbox.module.exports.deleteEvent({ eventId: 'event', creatorId: 'organizer' }),
  };
}

test('deletes an empty event only when its owner still matches', async () => {
  const s = service();
  assert.equal((await s.run()).ok, true);
  assert.deepEqual(s.filters, [['id', 'event'], ['creator_id', 'organizer']]);
});
for (const code of ['PT409', '23503']) {
  test(`returns a conflict for protected purchase history (${code})`, async () => {
    await assert.rejects(service({ error: { code } }).run(), error => error.status === 409 && /entradas o pagos/.test(error.message));
  });
}
test('does not report success after a concurrent ownership change', async () => {
  await assert.rejects(service({ deleted: null }).run(), error => error.status === 409);
});
test('a different organizer cannot delete the event', async () => {
  const s = service({ owner: 'someone-else' });
  await assert.rejects(s.run(), error => error.status === 403);
  assert.deepEqual(s.filters, []);
});
