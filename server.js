const express = require('express');

const app = express();
app.use(express.json());

const PORT = Number(process.env.PORT) || 8081;
const SUPABASE_URL = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_ANON_KEY = String(process.env.SUPABASE_ANON_KEY || '').trim();

app.get('/health', (_req, res) => {
  res.setHeader('X-Eclipse-Proxy', 'root-health-v2');
  res.status(200).json({ ok: true, service: 'root', version: 'root-health-v2' });
});

app.get('/', (_req, res) => {
  res.status(200).send('Eclipse API viva 🚀');
});

app.get('/event/:id', async (req, res) => {
  const id = String(req.params.id || '').trim();
  if (!id) return res.status(400).send('Missing id');
  const deepLink = `eclipse://event/${encodeURIComponent(id)}`;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.status(200).send(`<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Abrir evento</title>
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
        <h1>Abrir evento</h1>
        <p>Si tienes la app instalada, se abrirá automáticamente.</p>
        <a class="btn" href="${deepLink}">Abrir en la app</a>
        <div class="muted">Si no se abre automáticamente, pulsa el botón.</div>
      </div>
    </div>
    <script>
      setTimeout(function(){ window.location.href = ${JSON.stringify(deepLink)}; }, 350);
    </script>
  </body>
</html>`);
});

app.get('/evento/:token', async (req, res) => {
  try {
    const token = String(req.params.token || '').trim();
    if (!token) return res.status(400).send('Missing token');
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return res.status(500).send('Missing Supabase configuration');
    const target = `${SUPABASE_URL}/functions/v1/event-share/evento/${encodeURIComponent(token)}`;
    if (typeof fetch !== 'function') return res.status(500).send('Server fetch not available');

    const upstream = await fetch(target, {
      method: 'GET',
      headers: {
        accept: 'text/html',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
    });

    const html = await upstream.text().catch(() => '');
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'text/html; charset=utf-8');
    res.setHeader('X-Eclipse-Proxy', 'root-evento-v2');
    res.setHeader('X-Eclipse-Upstream-Status', String(upstream.status));
    return res.status(upstream.status).send(html);
  } catch {
    return res.status(500).send('Failed to resolve share link');
  }
});

app.get('/stripe/complete', (req, res) => {
  const next = 'eclipse://stripe/success';
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.status(200).send(`<!doctype html>
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

app.listen(PORT, '0.0.0.0', () => {
  console.log('Servidor escuchando en puerto', PORT);
});
