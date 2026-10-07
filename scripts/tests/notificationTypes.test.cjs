const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require('typescript');

test('notification worker accepts PostgREST PromiseLike RPC builders without unsafe casts', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eclipse-notification-types-'));
  try {
    const source = path.resolve(__dirname, '../../supabase/functions/_shared/notificationDelivery').replaceAll('\\', '/');
    const file = path.join(dir, 'contract.ts');
    fs.writeFileSync(file, `import type { Rpc } from ${JSON.stringify(source)};
      declare const postgrestRpc: (name: string, args?: Record<string, unknown>) => PromiseLike<{data: unknown; error: unknown}>;
      const workerRpc: Rpc = (name, args) => postgrestRpc(name, args);
      void workerRpc;
    `);
    const program = ts.createProgram([file], {
      strict: true, noEmit: true, skipLibCheck: true, types: [],
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.Node10,
    });
    const errors = ts.getPreEmitDiagnostics(program).filter(d => d.category === ts.DiagnosticCategory.Error);
    assert.deepEqual(errors.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
