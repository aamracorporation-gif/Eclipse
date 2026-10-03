import http from 'http';
import os from 'os';
import fs from 'fs';
import path from 'path';

const args = process.argv.slice(2);
const getArg = (name, fallback = null) => {
  const idx = args.indexOf(name);
  if (idx === -1) return fallback;
  const next = args[idx + 1];
  if (!next || next.startsWith('--')) return fallback;
  return next;
};

const hasFlag = (name) => args.includes(name);

const sessionId = getArg('--session');
if (!sessionId) {
  console.error('Missing required --session <sessionId>');
  process.exit(1);
}

const outdir = getArg('--outdir', '.dbg');
const clean = hasFlag('--clean');
const remote = hasFlag('--remote');
const idleSeconds = Number(getArg('--idle', '0')) || 0;
const startPort = Number(getArg('--port', '7777')) || 7777;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const ensureDir = (dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
};

const findLanIPv4 = () => {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net && net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return '127.0.0.1';
};

const host = remote ? '0.0.0.0' : '127.0.0.1';
const displayHost = remote ? findLanIPv4() : '127.0.0.1';

ensureDir(outdir);

const logFile = path.resolve(outdir, `trae-debug-log-${sessionId}.ndjson`);
if (clean) {
  try {
    fs.writeFileSync(logFile, '', 'utf8');
  } catch {}
}

let lastActivityTs = Date.now();

const writeEnvFile = (port) => {
  const envFile = path.resolve(outdir, `${sessionId}.env`);
  const apiUrl = `http://${displayHost}:${port}/event`;
  fs.writeFileSync(envFile, `DEBUG_SERVER_URL=${apiUrl}\nDEBUG_SESSION_ID=${sessionId}\n`, 'utf8');
  return { envFile, apiUrl };
};

const appendNdjson = (obj) => {
  try {
    fs.appendFileSync(logFile, `${JSON.stringify(obj)}\n`, 'utf8');
  } catch {}
};

const serve = (port) =>
  new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      lastActivityTs = Date.now();

      if (req.method === 'OPTIONS' && req.url === '/event') {
        res.writeHead(204, corsHeaders);
        res.end();
        return;
      }

      if (req.method === 'POST' && req.url === '/event') {
        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
          if (body.length > 2_000_000) req.destroy();
        });
        req.on('end', () => {
          try {
            const parsed = JSON.parse(body || '{}');
            const event = {
              ts: typeof parsed.ts === 'number' ? parsed.ts : Date.now(),
              sessionId: parsed.sessionId || sessionId,
              runId: parsed.runId || 'pre-fix',
              hypothesisId: parsed.hypothesisId || 'A',
              location: parsed.location || '',
              msg: parsed.msg || '[DEBUG] (no msg)',
              data: parsed.data || {},
              traceId: parsed.traceId,
            };
            appendNdjson(event);
            res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
          } catch (_e) {
            res.writeHead(400, { ...corsHeaders, 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'invalid json' }));
          }
        });
        return;
      }

      if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            ok: true,
            sessionId,
            uptimeMs: Date.now() - lastActivityTs,
            logFile,
          })
        );
        return;
      }

      res.writeHead(404, { ...corsHeaders, 'Content-Type': 'text/plain' });
      res.end('not found');
    });

    server.on('error', (err) => reject(err));
    server.listen(port, host, () => resolve({ server, port }));
  });

let server;
let port = startPort;
for (let i = 0; i < 10; i++) {
  try {
    const out = await serve(port);
    server = out.server;
    port = out.port;
    break;
  } catch (_e) {
    port += 1;
  }
}

if (!server) {
  console.error('Failed to bind a port for debug server');
  process.exit(1);
}

const { envFile, apiUrl } = writeEnvFile(port);

console.log('@@DEBUG_SERVER_INFO');
console.log(
  JSON.stringify(
    {
      api_url: apiUrl,
      session_id: sessionId,
      log_dir: path.resolve(outdir),
      log_file: logFile,
      env_file: envFile,
    },
    null,
    2
  )
);
console.log('@@END_DEBUG_SERVER_INFO');

if (idleSeconds > 0) {
  const timer = setInterval(() => {
    const idleMs = Date.now() - lastActivityTs;
    if (idleMs > idleSeconds * 1000) {
      clearInterval(timer);
      try {
        server.close(() => process.exit(0));
      } catch {
        process.exit(0);
      }
    }
  }, 1000);
}
