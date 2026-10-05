// Run with WALLET_TEST_DEPS pointing at an isolated npm prefix containing
// passkit-generator@3.1.10 and jose@5.9.6. No real accounts, passes or keys are used.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const ts = require('typescript');
const crypto = require('node:crypto');
const dep = createRequire(path.join(process.env.WALLET_TEST_DEPS, 'package.json'));
const forge = dep('node-forge');
const { PKPass } = dep('passkit-generator');
const jose = dep('jose');
const root = path.resolve(__dirname, '../..');
const keys = forge.pki.rsa.generateKeyPair(2048);
const cert = forge.pki.createCertificate();
cert.publicKey = keys.publicKey;
cert.serialNumber = '01';
cert.validity.notBefore = new Date('2025-01-01');
cert.validity.notAfter = new Date('2030-01-01');
cert.setSubject([{ name: 'commonName', value: 'Pass Type ID: pass.com.eclipse.test' }, { name: 'organizationalUnitName', value: 'QA12345678' }]);
cert.setIssuer(cert.subject.attributes);
cert.sign(keys.privateKey, forge.md.sha256.create());
const certificate = forge.pki.certificateToPem(cert);
const rsaPem = forge.pki.privateKeyToPem(keys.privateKey);
const pkcs8 = crypto.createPrivateKey(rsaPem).export({ format: 'pem', type: 'pkcs8' });
const password = ' fixture password with spaces ';
const encrypted = forge.pki.encryptRsaPrivateKey(keys.privateKey, password, { algorithm: 'aes256' });
const baseEnv = {
  SUPABASE_URL: 'https://fixture.invalid', SUPABASE_ANON_KEY: 'fixture', SUPABASE_SERVICE_ROLE_KEY: 'fixture-service',
  APPLE_WWDR_CERT: certificate, APPLE_PASS_CERT: certificate, APPLE_PASS_KEY: rsaPem,
  APPLE_PASS_TYPE_ID: 'pass.com.eclipse.test', APPLE_TEAM_ID: 'QA12345678',
  GOOGLE_WALLET_ISSUER_ID: '123456789', GOOGLE_WALLET_CLASS_ID: '123456789.qa',
  GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL: 'fixture@example.invalid', GOOGLE_WALLET_PRIVATE_KEY: pkcs8,
};
const ticket = {
  id: '00000000-0000-4000-8000-000000000001', user_id: 'owner', buyer_name: 'QA Fixture', buyer_email: 'qa@example.invalid', quantity: 1,
  qr_token: 'FIXTURE-QR-DO-NOT-USE', ticket_type: 'vip', status: 'valid', ticket_status: 'active',
  event_ticket_types: { id: 'type-fixture', name: 'VIP', category: 'vip', metadata: { vipGroupSize: 4, benefits: 'Fixture benefit', vipBottles: [{ brand: 'Fixture brand', quantity: 1 }] } },
  events: { id: 'event-fixture', title: 'QA Event', event_date: '2029-01-01T20:00:00Z', venues: { name: 'QA Venue', address: 'Fixture address' } },
};
function loadModule(file, imports, extras = {}) {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  vm.runInNewContext(source, { exports, require: name => {
    if (name in imports) return imports[name];
    throw new Error('Unexpected import: ' + name);
  }, Buffer, Response, Request, TextDecoder, URLSearchParams, atob, btoa, console: { log() {}, error() {}, warn() {} }, ...extras });
  return exports;
}
const shared = loadModule(path.join(root, 'supabase/functions/_shared/walletPem.ts'), {});
const assets = loadModule(path.join(root, 'supabase/functions/apple-wallet-generator/bundledAssets.ts'), {});
async function invoke(platform, options = {}) {
  let handler;
  let passData;
  let passFiles;
  const env = { ...baseEnv, ...options.env };
  const filters = {};
  const client = {
    auth: { getUser: async () => ({ data: { user: options.invalidSession ? null : { id: options.user || 'owner' } }, error: null }) },
    from: () => {
      const query = {
        select: () => query,
        eq: (key, value) => { filters[key] = value; return query; },
        single: async () => ({ data: options.missingTicket || (filters.user_id && filters.user_id !== ticket.user_id) ? null : ticket, error: null }),
        maybeSingle: async () => ({ data: options.missingTicket ? null : ticket, error: null }),
      };
      return query;
    },
  };
  const imports = {
    'https://esm.sh/@supabase/supabase-js@2.49.1': { createClient: () => client },
    'https://esm.sh/passkit-generator@3.1.10': { PKPass: class extends PKPass {
      constructor(files, certificates) {
        const content = JSON.parse(files['pass.json'].toString('utf8'));
        passData = content; passFiles = files;
        const style = content.eventTicket || content.generic;
        const fields = Object.values(style).filter(Array.isArray).flat();
        assert.equal(new Set(fields.map(field => field.key)).size, fields.length, 'Apple field keys must be unique across front and back');
        super(files, certificates);
      }
    } },
    'https://esm.sh/node-forge@1.4.0': forge,
    'https://esm.sh/jose@5.9.6': jose,
    'https://deno.land/std@0.168.0/http/server.ts': { serve: fn => { handler = fn; } },
    'node:buffer': { Buffer }, './bundledAssets.ts': assets, '../_shared/walletPem.ts': shared, '../_shared/walletDesign.ts': loadModule(path.join(root, 'supabase/functions/_shared/walletDesign.ts'), {}),
  };
  const dir = platform === 'ios' ? 'apple-wallet-generator' : 'generate-wallet-pass';
  loadModule(path.join(root, 'supabase/functions', dir, 'index.ts'), imports, { Deno: { env: { get: name => env[name] }, serve: fn => { handler = fn; } } });
  const method = options.method || 'POST';
  const response = await handler(new Request('https://fixture.invalid/wallet', {
    method, headers: { ...(options.noAuth ? {} : { Authorization: 'Bearer fixture' }), 'Content-Type': 'application/json' },
    ...(method === 'POST' ? { body: JSON.stringify({ ticket_id: ticket.id, platform }) } : {}),
  }));
  return { status: response.status, body: await response.json(), passData, passFiles };
}
let passed = 0;
async function check(name, fn) { await fn(); passed++; console.log('PASS ' + name); }
(async () => {
  for (const platform of ['ios', 'android']) {
    await check(platform + ': missing JWT', async () => assert.equal((await invoke(platform, { noAuth: true })).status, 401));
    await check(platform + ': invalid session', async () => assert.equal((await invoke(platform, { invalidSession: true })).status, 401));
    await check(platform + ': other owner', async () => assert.ok([403,404].includes((await invoke(platform, { user: 'other' })).status)));
    await check(platform + ': missing ticket', async () => assert.equal((await invoke(platform, { missingTicket: true })).status, 404));
    await check(platform + ': reject GET', async () => assert.equal((await invoke(platform, { method: 'GET' })).status, 405));
  }
  for (const [name, env] of [
    ['PEM', {}], ['encrypted key and spaced password', { APPLE_PASS_KEY: encrypted, APPLE_PASS_KEY_PASSWORD: password }],
    ['base64 PEM', { APPLE_PASS_CERT: Buffer.from(certificate).toString('base64'), APPLE_PASS_KEY: Buffer.from(rsaPem).toString('base64') }],
  ]) await check('Apple signed pkpass: ' + name, async () => {
    const result = await invoke('ios', { env }); assert.equal(result.status, 200, JSON.stringify(result.body));
    const zip = Buffer.from(result.body.base64, 'base64'); assert.equal(zip.subarray(0,4).toString('hex'), '504b0304');
    for (const file of ['pass.json','manifest.json','signature','icon.png']) assert.ok(zip.includes(Buffer.from(file)), file);
  });
  await check('Apple missing certificates -> explicit503', async () => assert.equal((await invoke('ios', { env: { APPLE_PASS_CERT: '' } })).status, 503));
  await check('Apple wrong key password rejected', async () => assert.equal((await invoke('ios', { env: { APPLE_PASS_KEY: encrypted, APPLE_PASS_KEY_PASSWORD: 'wrong' } })).status, 500));
  for (const [name, key] of [['multiline',pkcs8],['escaped newlines',pkcs8.replace(/\n/g,'\\n')],['JSON quoted',JSON.stringify(pkcs8)],['base64 PEM',Buffer.from(pkcs8).toString('base64')]]) {
    await check('Google real RS256 signature: ' + name, async () => {
      const result = await invoke('android', { env: { GOOGLE_WALLET_PRIVATE_KEY: key } });
      assert.equal(result.status, 200, JSON.stringify(result.body));
      assert.ok(result.body.url.startsWith('https://pay.google.com/gp/v/save/'));
      const jwt = result.body.url.split('/').pop();
      const verified = await jose.jwtVerify(jwt, crypto.createPublicKey(pkcs8), { issuer: baseEnv.GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL, audience: 'google' });
      const object = verified.payload.payload.genericObjects[0];
      assert.equal(object.barcode.value, ticket.qr_token);
      assert.equal(object.id, '123456789.' + ticket.id);
      assert.ok(object.textModulesData.some(x=>x.id === 'bottles' && x.body.includes('Fixture brand')));
    });
  }
  await check('Google missing configuration -> explicit503', async () => assert.equal((await invoke('android', { env: { GOOGLE_WALLET_PRIVATE_KEY: '' } })).status, 503));
  for (const tier of ['general', 'vip', 'backstage', 'fastlane']) {
    await check('Presentation and access accuracy: ' + tier, async () => {
      ticket.event_ticket_types = { id: 'type-fixture', name: tier, category: tier, metadata: {} };
      ticket.events.event_date = '2026-10-09T22:30:00Z'; // Saturday in Madrid, not Friday.
      ticket.events.title = 'Eclipse Weekend · Una noche extraordinaria en Sevilla';
      const ios = await invoke('ios'); assert.equal(ios.status, 200, JSON.stringify(ios.body));
      const fields = ios.passData.eventTicket;
      assert.equal(fields.secondaryFields[1].value, '00:30');
      assert.ok(fields.headerFields[0].value.includes('10'));
      assert.equal(fields.primaryFields[0].value, ticket.events.title);
      assert.equal(ios.passData.barcodes[0].message, ticket.qr_token);
      assert.ok(!fields.backFields.some(f => ['back_gate','back_lane','back_section','back_seat'].includes(f.key)));
      for (const scale of [1,2,3]) {
        const png = ios.passFiles['strip' + (scale === 1 ? '' : '@' + scale + 'x') + '.png'];
        assert.equal(png.readUInt32BE(16),375*scale); assert.equal(png.readUInt32BE(20),98*scale);
      }
      const android = await invoke('android'); assert.equal(android.status,200);
      const verified = await jose.jwtVerify(android.body.url.split('/').pop(),crypto.createPublicKey(pkcs8));
      const obj = verified.payload.payload.genericObjects[0];
      assert.equal(obj.textModulesData.find(f=>f.id==='show').body,'00:30');
      assert.equal(obj.textModulesData.find(f=>f.id==='entry').body,'00:30');
      assert.ok(obj.heroImage.sourceUri.uri.endsWith('google_'+tier+'.png'));
      assert.ok(!obj.textModulesData.some(f=>['gate','section','lane'].includes(f.id)));
      assert.equal(verified.payload.payload.genericClasses[0].classTemplateInfo.cardTemplateOverride.cardRowTemplateInfos.length,2);
    });
  }
  console.log(`TOTAL ${passed} passed; real signing libraries, fixture credentials, no provider calls. Does not validate Apple trust chain or device installation.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
