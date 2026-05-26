const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const { env } = require('./config/env');
const { errorHandler } = require('./middlewares/errorHandler');
const { authRoutes } = require('./routes/authRoutes');
const { eventRoutes } = require('./routes/eventRoutes');
const { paymentRoutes } = require('./routes/paymentRoutes');
const { stripeRoutes } = require('./routes/stripeRoutes');
const { stripeWebhookRoutes } = require('./routes/stripeWebhookRoutes');
const { testRoutes } = require('./routes/testRoutes');
const { organizerRoutes } = require('./routes/organizerRoutes');
const { retrieveAccount } = require('./services/stripeService');
const { setOnboardingCompletedByStripeAccountId } = require('./services/userService');

function createApp() {
  const app = express();

  app.set('trust proxy', 1);

  app.use(
    rateLimit({
      windowMs: 60_000,
      limit: 120,
      standardHeaders: true,
      legacyHeaders: false,
    })
  );

  app.use(helmet());
  app.use(
    cors({
      origin(origin, cb) {
        if (!origin) return cb(null, true);
        if (env.nodeEnv !== 'production') return cb(null, true);

        const fromEnv = String(process.env.CORS_ORIGINS || '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        const allowed = new Set([env.publicAppUrl, ...fromEnv].filter(Boolean));
        return allowed.has(origin) ? cb(null, true) : cb(null, false);
      },
      credentials: true,
    })
  );
  app.use(morgan(env.nodeEnv === 'production' ? 'combined' : 'dev'));

  app.get('/', (req, res) => res.send('Eclipse API viva 🚀'));
  app.get('/health', (req, res) => res.json({ ok: true }));
  app.get('/.well-known/apple-app-site-association', (req, res) => {
    const teamId = String(process.env.APPLE_TEAM_ID || '').trim();
    const bundleId = String(process.env.IOS_BUNDLE_ID || 'com.achraf.eclipse').trim();
    if (!teamId) {
      return res.status(500).json({ ok: false, error: 'Missing APPLE_TEAM_ID' });
    }
    res.setHeader('Content-Type', 'application/json');
    return res.status(200).send(
      JSON.stringify(
        {
          applinks: {
            apps: [],
            details: [
              {
                appIDs: [`${teamId}.${bundleId}`],
                components: [{ '/': '/evento/*' }, { '/': '/event/*' }, { '/': '/verified*' }],
              },
            ],
          },
        },
        null,
        2
      )
    );
  });
  app.get('/.well-known/assetlinks.json', (req, res) => {
    const packageName = String(process.env.ANDROID_PACKAGE_NAME || 'com.achraf.eclipse').trim();
    const raw = String(process.env.ANDROID_SHA256_CERT_FINGERPRINTS || '').trim();
    const fingerprints = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    res.setHeader('Content-Type', 'application/json');
    if (!fingerprints.length) return res.status(200).send(JSON.stringify([], null, 2));
    return res.status(200).send(
      JSON.stringify(
        [
          {
            relation: ['delegate_permission/common.handle_all_urls'],
            target: {
              namespace: 'android_app',
              package_name: packageName,
              sha256_cert_fingerprints: fingerprints,
            },
          },
        ],
        null,
        2
      )
    );
  });
  app.get('/evento/:token', async (req, res) => {
    try {
      const token = String(req.params.token || '').trim();
      if (!token) return res.status(400).send('Missing token');
      const supabaseUrl = String(env.supabaseUrl || '').replace(/\/$/, '');
      const target = `${supabaseUrl}/functions/v1/event-share/evento/${encodeURIComponent(token)}`;
      if (typeof fetch !== 'function') return res.status(500).send('Server fetch not available');
      const upstream = await fetch(target, { method: 'GET', headers: { accept: 'text/html' } });
      const html = await upstream.text().catch(() => '');
      res.setHeader('Content-Type', upstream.headers.get('content-type') || 'text/html; charset=utf-8');
      return res.status(upstream.status).send(html);
    } catch {
      return res.status(500).send('Failed to resolve share link');
    }
  });
  app.get('/stripe/complete', async (req, res) => {
    const account = String(req.query.account || '').trim();
    const rawNext = String(req.query.next || '').trim();
    const isValid = /^acct_[A-Za-z0-9]+$/.test(account);

    if (isValid) {
      try {
        const acct = await retrieveAccount(account);
        const completed = Boolean(acct.charges_enabled && acct.payouts_enabled);
        await setOnboardingCompletedByStripeAccountId(account, completed);
      } catch {}
    }

    const next =
      rawNext.startsWith('eclipse://') || rawNext.startsWith('partyapp://') || rawNext.startsWith('exp://')
        ? rawNext
        : 'eclipse://(creator)/verification?stripe=return';

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(`<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Eclipse · Stripe completado</title>
    <style>
      body { margin:0; font-family: -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Arial, sans-serif; background:#0f0f1a; color:#fff; }
      .wrap { min-height:100vh; display:flex; align-items:center; justify-content:center; padding:24px; }
      .card { max-width:520px; width:100%; background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.12); border-radius:18px; padding:22px; }
      h1 { margin:0 0 10px; font-size:22px; }
      p { margin:0 0 16px; color:rgba(255,255,255,0.78); line-height:1.45; }
      a.btn { display:inline-block; background:#7c3aed; color:#fff; text-decoration:none; padding:12px 16px; border-radius:14px; font-weight:800; }
      .muted { margin-top:10px; font-size:12px; color:rgba(255,255,255,0.55); }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="card">
        <h1>Stripe completado</h1>
        <p>La configuración de Stripe se ha completado. Ya puedes volver a la app.</p>
        <a class="btn" href="${next}">Volver a Eclipse</a>
        <div class="muted">Si no se abre automáticamente, pulsa el botón.</div>
      </div>
    </div>
    <script>
      setTimeout(function(){ window.location.href = ${JSON.stringify(next)}; }, 900);
    </script>
  </body>
</html>`);
  });
  app.get('/verified', (req, res) => {
    const rawNext = typeof req.query.next === 'string' ? req.query.next : '';
    const next =
      rawNext.startsWith('eclipse://') || rawNext.startsWith('partyapp://') || rawNext.startsWith('exp://')
        ? rawNext
        : 'eclipse://auth/callback';

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(`<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Eclipse · Verificación completada</title>
    <style>
      body { margin:0; font-family: -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Arial, sans-serif; background:#0f0f1a; color:#fff; }
      .wrap { min-height:100vh; display:flex; align-items:center; justify-content:center; padding:24px; }
      .card { max-width:520px; width:100%; background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.12); border-radius:18px; padding:22px; }
      h1 { margin:0 0 10px; font-size:22px; }
      p { margin:0 0 16px; color:rgba(255,255,255,0.78); line-height:1.45; }
      a.btn { display:inline-block; background:#7c3aed; color:#fff; text-decoration:none; padding:12px 16px; border-radius:14px; font-weight:800; }
      .muted { margin-top:10px; font-size:12px; color:rgba(255,255,255,0.55); }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="card">
        <h1>Registro verificado</h1>
        <p>Tu cuenta se ha verificado correctamente. Ya puedes volver a la app.</p>
        <a class="btn" href="${next}">Abrir Eclipse</a>
        <div class="muted">Si no se abre automáticamente, pulsa el botón.</div>
      </div>
    </div>
    <script>
      setTimeout(function(){ window.location.href = ${JSON.stringify(next)}; }, 900);
    </script>
  </body>
</html>`);
  });
  app.use('/test', testRoutes);

  app.use('/api/stripe', stripeWebhookRoutes);
  app.use(express.json({ limit: '1mb' }));

  app.use('/api/auth', authRoutes);
  app.use('/api/events', eventRoutes);
  app.use('/api/payments', paymentRoutes);
  app.use('/api/stripe', stripeRoutes);
  app.use('/api/test', testRoutes);
  app.use('/organizer', organizerRoutes);

  app.use((req, res) => res.status(404).json({ ok: false, error: 'Not found' }));
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
