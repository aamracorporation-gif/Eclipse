// Isolated Google Wallet handler tests: generated RSA keys, mocked Auth/DB/Google.
// Run: node --test scripts/tests/googleWalletSave.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const functions = path.join(root, 'supabase/functions');
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
class SignJWT {
  constructor(claims) { this.claims = { ...claims }; this.header = {}; }
  setProtectedHeader(v) { this.header = v; return this; }
  setIssuer(v) { this.claims.iss = v; return this; }
  setSubject(v) { this.claims.sub = v; return this; }
  setAudience(v) { this.claims.aud = v; return this; }
  setIssuedAt(v) { this.claims.iat = v; return this; }
  setExpirationTime(v) { this.claims.exp = v; return this; }
  async sign(key) {
    const input = [this.header, this.claims].map(v => Buffer.from(JSON.stringify(v)).toString('base64url')).join('.');
    return input + '.' + crypto.sign('RSA-SHA256', Buffer.from(input), key).toString('base64url');
  }
}
const importer = async value => {
  if (!value.startsWith('-----BEGIN PRIVATE KEY-----')) throw Error('Invalid PEM');
  return crypto.createPrivateKey(value);
};
const FixedDate = class extends Date { constructor(...args) { super(...(args.length ? args : ['2026-10-07T18:00:00Z'])); } static now() { return Date.parse('2026-10-07T18:00:00Z'); } };
function load(file, imports = {}, extras = {}) {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  vm.runInNewContext(source.outputText, { exports, require: name => { if (name in imports) return imports[name]; throw Error('Unexpected import ' + name); }, Date: FixedDate, Request, Response, URLSearchParams, AbortSignal, TextEncoder, atob, btoa, ...extras }, { filename: file });
  return exports;
}
const envBase = { SUPABASE_URL: 'https://fixture.invalid', SUPABASE_ANON_KEY: 'fixture', SUPABASE_SERVICE_ROLE_KEY: 'fixture', GOOGLE_WALLET_ISSUER_ID: '123456789', GOOGLE_WALLET_CLASS_ID: '123456789.qa', GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL: 'fixture@example.invalid', GOOGLE_WALLET_PRIVATE_KEY: pem };
const ticketBase = { id: '00000000-0000-4000-8000-000000000001', user_id: 'owner', status: 'valid', ticket_status: 'active', payment_status: 'paid', validation_status: 'valid', quantity: 1, qr_token: 'FIXTURE-NOT-AN-ADMISSION', buyer_name: 'Fixture', events: { id: 'event', title: 'Fixture event', event_date: '2030-01-01T20:00:00Z', venues: { name: 'Fixture venue' } }, product_snapshot: { kind: 'admission', category: 'general', name: 'Entrada', metadata: {} } };
const oid = envBase.GOOGLE_WALLET_ISSUER_ID + '.' + ticketBase.id;
async function invoke(options = {}) {
  const calls = [], logs = [];
  let handler, saved = options.existing ? { id: oid, classId: envBase.GOOGLE_WALLET_CLASS_ID, state: 'ACTIVE', barcode: { value: ticketBase.qr_token }, ...options.existing } : null;
  const ticket = { ...ticketBase, ...options.ticket };
  const response = (data, status=200) => new Response(JSON.stringify(data), { status });
  const send = async (url, init = {}) => {
    calls.push({ url, method: init.method, body: init.body });
    if (options.networkFailure) throw new Error('Private transport details must not escape');
    const fail = status => response({ error: { status: 'PERMISSION_DENIED', message: 'SENSITIVE_PROVIDER_FIXTURE', details: options.disabled ? [{ reason: 'SERVICE_DISABLED' }] : [] } }, status);
    if (url === 'https://oauth2.googleapis.com/token') {
      if (options.oauthFailure) return fail(options.oauthFailure);
      return response(options.badTokenResponse ? {} : { access_token: 'fixture-token' });
    }
    if (url.includes('/genericClass/')) {
      if (options.classFailure) return fail(options.classFailure);
      return response({ id: options.badClassId ? 'other.class' : envBase.GOOGLE_WALLET_CLASS_ID });
    }
    if (url.endsWith('/genericObject') && init.method === 'POST') {
      if (options.createFailure) return fail(options.createFailure);
      saved = JSON.parse(init.body);
      return response(saved, options.race ? 409 : 200);
    }
    if (url.includes('/genericObject/')) {
      if (init.method === 'GET') return saved ? response(saved) : fail(404);
      if (init.method === 'PATCH') {
        if (options.patchFailure) return fail(options.patchFailure);
        saved = { ...saved, ...JSON.parse(init.body) }; return response(saved);
      }
    }
    throw Error('Unexpected endpoint: ' + url);
  };
  const imports = {
    'https://deno.land/std@0.168.0/http/server.ts': { serve: fn => { handler = fn; } },
    'https://esm.sh/@supabase/supabase-js@2.49.1': { createClient: () => ({ auth: { getUser: async () => ({ data: { user: options.invalidSession ? null : { id: options.user || 'owner' } } }) }, from: () => { const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: options.missing ? null : ticket }) }; return q; } }) },
    'https://esm.sh/jose@5.9.6': { SignJWT, importPKCS8: importer },
  };
  for (const name of ['ticketProduct', 'walletDesign', 'walletPem', 'googleWalletApi']) imports['../_shared/'+name+'.ts'] = load(path.join(functions,'_shared',name+'.ts'), {}, { fetch: send });
  load(options.source || path.join(functions,'generate-wallet-pass/index.ts'), imports, { fetch: send, console: { error: (...a) => logs.push(a), info: (...a) => logs.push(a) }, Deno: { env: { get: k => ({ ...envBase, ...options.env })[k] } } });
  const method = options.method || 'POST';
  const result = await handler(new Request('https://fixture.invalid/wallet', { method, headers: { ...(options.noAuth ? {} : { Authorization: 'Bearer fixture' }) }, ...(method === 'POST' ? { body: JSON.stringify({ ticket_id: ticket.id, platform: 'android' }) } : {}) }));
  return { status: result.status, body: await result.json(), calls, logs, saved, cache: result.headers.get('Cache-Control') };
}
function verifiedClaims(url) {
  const jwt = url.split('/').pop(); const parts = jwt.split('.');
  assert.equal(parts.length,3);
  assert.ok(crypto.verify('RSA-SHA256', Buffer.from(parts[0]+'.'+parts[1]), publicKey, Buffer.from(parts[2], 'base64url')));
  return { jwt, claims: JSON.parse(Buffer.from(parts[1], 'base64url').toString()) };
}

test('A valid pass is registered through Google before issuing a short signed Save link', async () => {
  const r = await invoke(); assert.equal(r.status,200, JSON.stringify(r.body));
  const { jwt, claims } = verifiedClaims(r.body.url);
  assert.ok(jwt.length < 1800); assert.equal(claims.typ,'savetowallet'); assert.equal(claims.aud,'google');
  assert.deepEqual(claims.origins,[]); assert.deepEqual(claims.payload,{ genericObjects: [{ id: oid }] });
  assert.equal(r.saved.barcode.value, ticketBase.qr_token); assert.equal(r.saved.classId,envBase.GOOGLE_WALLET_CLASS_ID);
  assert.equal(r.cache,'no-store');
  assert.deepEqual(r.calls.map(c=>c.method), ['POST','GET','GET','POST']);
  assert.ok(!JSON.stringify(r.logs).includes(ticketBase.qr_token));
});
for (const [name, options, status] of [
  ['no authorization',{ noAuth:true },401], ['invalid session',{ invalidSession:true },401],
  ['another owner',{ user:'other' },403], ['no ticket',{ missing:true },404], ['GET',{ method:'GET' },405],
  ['revoked',{ ticket:{ status:'cancelled' } },409], ['unpaid',{ ticket:{ payment_status:'pending' } },409],
  ['unknown validation',{ ticket:{ validation_status:null } },409], ['used',{ ticket:{ scanned_at:'2026-01-01' } },409],
  ['expired event',{ ticket:{ events:{ ...ticketBase.events,event_date:'2020-01-01' } } },409],
  ['cancelled event',{ ticket:{ events:{ ...ticketBase.events,is_cancelled:true } } },409],
  ['expired admission',{ ticket:{ entry_deadline:'2020-01-01' } },409],
  ['missing QR',{ ticket:{ qr_token:null } },409],
  ['mismatched class prefix',{ env:{ GOOGLE_WALLET_CLASS_ID:'999.other' } },503],
  ['missing key',{ env:{ GOOGLE_WALLET_PRIVATE_KEY:'' } },503],
  ['malformed key',{ env:{ GOOGLE_WALLET_PRIVATE_KEY:'not a key' } },503],
]) test(name + ' is rejected without a Google call', async () => { const r=await invoke(options); assert.equal(r.status,status); assert.equal(r.calls.length,0); assert.ok(!r.body.url); });
for (const [name, options, code] of [
  ['Google signature rejection',{ oauthFailure:400 },'WALLET_GOOGLE_CREDENTIALS'],
  ['missing access token',{ badTokenResponse:true },'WALLET_GOOGLE_CREDENTIALS'],
  ['API disabled',{ classFailure:403,disabled:true },'WALLET_API_DISABLED'],
  ['permission denied',{ classFailure:403 },'WALLET_GOOGLE_PERMISSION'],
  ['missing class',{ classFailure:404 },'WALLET_CLASS_NOT_FOUND'],
  ['wrong class response',{ badClassId:true },'WALLET_CLASS_INVALID'],
  ['invalid pass data',{ createFailure:400 },'WALLET_GOOGLE_PAYLOAD'],
  ['network failure',{ networkFailure:true },'WALLET_GOOGLE_UNAVAILABLE'],
]) test(name+' produces a safe and specific error', async () => {
  const r=await invoke(options); assert.equal(r.status,503); assert.equal(r.body.code,code); assert.ok(!r.body.url);
  assert.ok(!JSON.stringify([r.body,r.logs]).includes('SENSITIVE_PROVIDER_FIXTURE'));
});
test('existing object receives presentation-only patch, without reviving or changing the QR', async()=>{
  const r=await invoke({ existing:{} }); assert.equal(r.status,200);
  const patch=JSON.parse(r.calls.find(c=>c.method==='PATCH').body);
  assert.ok(patch.heroImage); assert.ok(!('state' in patch)); assert.ok(!('barcode' in patch)); assert.ok(!('classId' in patch));
});
for (const [name,existing,code] of [ ['inactive',{state:'INACTIVE'},'WALLET_OBJECT_INACTIVE'], ['different QR',{barcode:{value:'other'}},'WALLET_OBJECT_CONFLICT'], ['different class',{classId:'other.class'},'WALLET_OBJECT_CONFLICT'] ]) test(name+' never patched or reissued',async()=>{
  const r=await invoke({existing}); assert.equal(r.body.code,code); assert.ok(!r.calls.some(c=>c.method==='PATCH'));
});
test('concurrent creation reuses same object after 409',async()=>{ const r=await invoke({race:true}); assert.equal(r.status,200); assert.equal(r.calls.filter(c=>c.url.endsWith('/genericObject')).length,1); });
test('VIP payload is preserved in API, not embedded in the long Save URL',async()=>{
  const r=await invoke({ticket:{quantity:6,product_snapshot:{kind:'vip_table',category:'vip_table',name:'Mesa de prueba',metadata:{vipGroupSize:6,vipBottles:[{brand:'Fixture',quantity:1}],benefits:'X'.repeat(300)}}}});
  assert.equal(r.status,200); assert.ok(r.saved.textModulesData.some(x=>x.id==='group' && x.body==='6 personas'));
  assert.ok(verifiedClaims(r.body.url).jwt.length<1800);
});
