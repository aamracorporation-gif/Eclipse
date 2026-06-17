const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const session = "wallet-testflight-open";
const port = 7777;
const outdir = path.resolve(".dbg");
fs.mkdirSync(outdir, { recursive: true });
const logFile = path.join(outdir, `trae-debug-log-${session}.ndjson`);
const envFile = path.join(outdir, `${session}.env`);
try { fs.unlinkSync(logFile); } catch {}
const ifaces = os.networkInterfaces();
let ip = "127.0.0.1";
outer: for (const addrs of Object.values(ifaces)) {
  for (const a of addrs || []) {
    if (a && a.family === "IPv4" && !a.internal && (/^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[0-1])\./.test(a.address))) {
      ip = a.address;
      break outer;
    }
  }
}
fs.writeFileSync(envFile, `DEBUG_SERVER_URL=http://${ip}:${port}/event\nDEBUG_SESSION_ID=${session}\n`);
const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS, GET, DELETE");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.statusCode = 204; res.end(); return; }
  if (req.method === "GET" && req.url.startsWith("/health")) { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ ok: true, session, logFile })); return; }
  if (req.method === "GET" && req.url.startsWith("/logs")) { res.setHeader("Content-Type", "application/x-ndjson"); try { res.end(fs.readFileSync(logFile, "utf8")); } catch { res.end(""); } return; }
  if (req.method === "DELETE" && req.url.startsWith("/logs")) { try { fs.unlinkSync(logFile); } catch {} res.end("ok"); return; }
  if (req.method === "POST" && req.url.startsWith("/event")) {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      try {
        const event = JSON.parse(body || "{}");
        if (!event.ts) event.ts = Date.now();
        fs.appendFileSync(logFile, JSON.stringify(event) + "\n");
        res.end("ok");
      } catch (e) {
        res.statusCode = 400;
        res.end(String((e && e.message) || e));
      }
    });
    return;
  }
  res.statusCode = 404;
  res.end("not found");
});
server.listen(port, "0.0.0.0", () => {
  console.log("@@DEBUG_SERVER_INFO");
  console.log(JSON.stringify({
    api_url: `http://${ip}:${port}/event`,
    session_id: session,
    log_dir: outdir,
    log_file: logFile,
    env_file: envFile
  }, null, 2));
  console.log("@@END_DEBUG_SERVER_INFO");
});
setInterval(() => {}, 1 << 30);
