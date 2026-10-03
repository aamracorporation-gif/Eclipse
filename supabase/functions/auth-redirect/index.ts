import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

// Reads the Supabase auth hash from the URL and redirects the user into the app.
// Used as emailRedirectTo so verification emails land here first, then bounce
// to the eclipse:// deep link which the app intercepts to auto-sign-in.

const APP_SCHEME = String(Deno.env.get("APP_SCHEME") || "eclipse").trim();

function htmlPage(title: string, body: string) {
  return new Response(
    `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
    *{box-sizing:border-box}
    body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
         background:#0b0b0f;color:#fff;margin:0;display:flex;align-items:center;
         justify-content:center;min-height:100vh;padding:24px;}
    .card{max-width:440px;width:100%;background:rgba(255,255,255,0.06);
          border:1px solid rgba(255,255,255,0.12);border-radius:18px;padding:24px;text-align:center;}
    h2{margin:0 0 10px;font-size:22px}
    p{color:rgba(255,255,255,0.7);font-size:15px;line-height:1.5;margin:0 0 20px}
    .btn{display:inline-block;padding:14px 28px;border-radius:12px;background:#7C3AED;
         color:#fff;font-weight:700;font-size:16px;text-decoration:none;margin:4px;}
    .btn.sec{background:rgba(255,255,255,0.10);}
    .spinner{width:40px;height:40px;border:3px solid rgba(255,255,255,0.15);
             border-top-color:#7C3AED;border-radius:50%;animation:spin 0.8s linear infinite;
             margin:0 auto 16px;}
    @keyframes spin{to{transform:rotate(360deg)}}
  </style>
</head>
<body>
  <div class="card">
    ${body}
  </div>
</body>
</html>`,
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}

serve(async (req) => {
  const url = new URL(req.url);

  // PKCE can arrive as query parameters, while the legacy implicit flow puts
  // the recovery tokens in the URL fragment. Fragments are browser-only and
  // are never sent to this Edge Function, so validation must happen in the
  // page script after it can inspect window.location.hash.
  const qs = url.searchParams.toString();
  const route = url.searchParams.get("type") === "recovery" ? "auth/reset-password" : "auth/callback";
  const deepLink = `${APP_SCHEME}://${route}${qs ? "?" + qs : ""}`;

  return htmlPage(
    "Verificando cuenta…",
    `<div class="spinner"></div>
    <h2>Verificando tu cuenta…</h2>
    <p>Redirigiendo a Eclipse. Si no se abre automáticamente, pulsa el botón.</p>
    <a class="btn" id="openBtn" href="${deepLink}">Abrir Eclipse</a>
    <script>
      (function(){
        var deep = ${JSON.stringify(deepLink)};
        var queryParams = new URLSearchParams(window.location.search);
        // Also pick up tokens sent as URL hash fragment (legacy implicit flow)
        var hash = window.location.hash;
        var hashParams = new URLSearchParams(hash && hash.length > 1 ? hash.slice(1) : '');
        var hasToken = queryParams.has('token_hash') || queryParams.has('access_token') ||
          queryParams.has('code') || hashParams.has('access_token') ||
          hashParams.has('refresh_token') || hashParams.has('token_hash') ||
          hashParams.has('code');

        if (!hasToken) {
          document.querySelector('.card').innerHTML =
            '<h2>⚠️ Enlace expirado o inválido</h2>' +
            '<p>El enlace no incluye una sesión de recuperación válida. Solicita uno nuevo desde el inicio de sesión.</p>' +
            '<a class="btn sec" href="${APP_SCHEME}://auth/login">Ir al inicio de sesión</a>';
          return;
        }

        if (hash && hash.length > 1) {
          if (hashParams.get('type') === 'recovery') {
            var currentQuery = deep.includes('?') ? deep.slice(deep.indexOf('?')) : '';
            deep = ${JSON.stringify(`${APP_SCHEME}://auth/reset-password`)} + currentQuery;
          }
          var sep = deep.includes('?') ? '&' : '?';
          deep = deep + sep + hash.slice(1);
          document.getElementById('openBtn').href = deep;
        }
        try { window.location.href = deep; } catch(e){}
      })();
    </script>`
  );
});
