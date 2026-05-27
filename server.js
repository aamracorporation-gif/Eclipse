const express = require('express');

const app = express();
app.use(express.json());

const PORT = Number(process.env.PORT) || 8081;

app.get('/health', (_req, res) => {
  res.status(200).json({ ok: true });
});

app.get('/', (_req, res) => {
  res.status(200).send('Eclipse API viva 🚀');
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
