const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const jwt = require('jsonwebtoken');

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'a'.repeat(64);
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_dummy';
process.env.STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_dummy';
process.env.PUBLIC_APP_URL = process.env.PUBLIC_APP_URL || 'https://example.com';

const { authMiddleware, requireRole } = require('../src/middlewares/auth');
const { supabaseAnon, supabaseAdmin } = require('../src/services/supabaseService');

supabaseAnon.auth.getUser = async () => ({ data: { user: null }, error: new Error('stubbed') });

const roleByUserId = new Map();
supabaseAdmin.from = (table) => {
  if (table !== 'profiles') {
    return {
      select() {
        throw new Error(`Unexpected table access in test: ${table}`);
      },
    };
  }
  return {
    select() {
      return {
        eq(_col, userId) {
          return {
            async maybeSingle() {
              const role = roleByUserId.get(String(userId || '')) || '';
              return { data: role ? { role } : null, error: null };
            },
          };
        },
      };
    },
  };
};

function issuer() {
  return `${String(process.env.SUPABASE_URL || '').replace(/\/$/, '')}/auth/v1`;
}

function signToken({ secret, sub, aud = 'authenticated', iss = issuer(), expiresIn = '5m', userRole, exp } = {}) {
  const payload = {
    role: 'authenticated',
    user_metadata: userRole ? { role: userRole } : {},
    app_metadata: {},
  };
  if (typeof exp === 'number') payload.exp = exp;

  const options = {
    algorithm: 'HS256',
    issuer: iss,
    audience: aud,
    subject: sub || '11111111-1111-4111-8111-111111111111',
  };
  if (typeof exp !== 'number') options.expiresIn = expiresIn;
  return jwt.sign(payload, secret || process.env.JWT_SECRET, options);
}

async function startServer() {
  const app = express();
  app.get('/protected', authMiddleware, (req, res) => res.json({ ok: true, auth: req.auth }));
  app.get('/organizer', authMiddleware, requireRole('organizer'), (req, res) => res.json({ ok: true, auth: req.auth }));

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return { server, port: address.port };
}

function requestJson({ port, path, token }) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: 'GET',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          let body = null;
          try {
            body = data ? JSON.parse(data) : null;
          } catch {}
          resolve({ status: res.statusCode, body });
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

test('JWT válido (organizer) pasa requireRole y expone role normalizado', async () => {
  const { server, port } = await startServer();
  try {
    const sub = '11111111-1111-4111-8111-111111111111';
    roleByUserId.set(sub, 'organizer');
    const token = signToken({ sub, userRole: 'ORGANIZER' });
    const r = await requestJson({ port, path: '/organizer', token });
    assert.equal(r.status, 200);
    assert.equal(r.body?.ok, true);
    assert.equal(r.body?.auth?.role, 'organizer');
    assert.match(String(r.body?.auth?.userId || ''), /^[0-9a-f-]{36}$/i);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('JWT válido sin rol explícito cae a attendee y bloquea organizer con 403', async () => {
  const { server, port } = await startServer();
  try {
    const token = signToken({ sub: '22222222-2222-4222-8222-222222222222', userRole: '' });
    const ok = await requestJson({ port, path: '/protected', token });
    assert.equal(ok.status, 200);
    assert.equal(ok.body?.auth?.role, 'attendee');

    const forbidden = await requestJson({ port, path: '/organizer', token });
    assert.equal(forbidden.status, 403);
    assert.equal(forbidden.body?.code, 'FORBIDDEN');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('JWT expirado devuelve 401 TOKEN_EXPIRED', async () => {
  const { server, port } = await startServer();
  try {
    const nowSec = Math.floor(Date.now() / 1000);
    const token = signToken({ sub: '33333333-3333-4333-8333-333333333333', userRole: 'attendee', exp: nowSec - 30 });
    const r1 = await requestJson({ port, path: '/protected', token });
    assert.equal(r1.status, 401);
    assert.equal(r1.body?.code, 'TOKEN_EXPIRED');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('Firma inválida devuelve 401 INVALID_SIGNATURE', async () => {
  const { server, port } = await startServer();
  try {
    const token = signToken({ secret: 'b'.repeat(64), sub: '44444444-4444-4444-8444-444444444444', userRole: 'organizer' });
    const r = await requestJson({ port, path: '/protected', token });
    assert.equal(r.status, 401);
    assert.equal(r.body?.code, 'INVALID_SIGNATURE');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('Audiencia inválida devuelve 401 INVALID_AUD', async () => {
  const { server, port } = await startServer();
  try {
    const token = signToken({ aud: 'wrong', sub: '55555555-5555-4555-8555-555555555555', userRole: 'organizer' });
    const r = await requestJson({ port, path: '/protected', token });
    assert.equal(r.status, 401);
    assert.equal(r.body?.code, 'INVALID_AUD');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('Token malformado devuelve 401 MALFORMED_TOKEN', async () => {
  const { server, port } = await startServer();
  try {
    const r = await requestJson({ port, path: '/protected', token: 'abc' });
    assert.equal(r.status, 401);
    assert.equal(r.body?.code, 'MALFORMED_TOKEN');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
