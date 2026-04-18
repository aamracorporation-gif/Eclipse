import process from "node:process";

const STRIPE_SECRET_KEY = String(process.env.STRIPE_SECRET_KEY || "").trim();
const STRIPE_CLIENT_ID = String(process.env.STRIPE_CLIENT_ID || "").trim();
const DRY_RUN = process.argv.includes("--dry-run");

if (!STRIPE_SECRET_KEY) {
  console.error("Missing STRIPE_SECRET_KEY");
  process.exit(1);
}

async function stripeRequest(method, path, body) {
  const url = `https://api.stripe.com${path}`;
  const headers = {
    Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
    "Content-Type": "application/x-www-form-urlencoded",
  };
  const res = await fetch(url, {
    method,
    headers,
    body: body ? new URLSearchParams(body) : undefined,
  });
  const text = await res.text().catch(() => "");
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { ok: res.ok, status: res.status, json, text };
}

async function getPlatformAccountId() {
  const r = await stripeRequest("GET", "/v1/account");
  if (!r.ok) throw new Error(String(r.json?.error?.message || r.text || `HTTP ${r.status}`));
  return String(r.json?.id || "");
}

async function listAccountsPage(startingAfter) {
  const params = { limit: "100" };
  if (startingAfter) params.starting_after = startingAfter;
  const r = await stripeRequest("GET", `/v1/accounts?${new URLSearchParams(params).toString()}`);
  if (!r.ok) throw new Error(String(r.json?.error?.message || r.text || `HTTP ${r.status}`));
  const data = Array.isArray(r.json?.data) ? r.json.data : [];
  const hasMore = Boolean(r.json?.has_more);
  return { data, hasMore };
}

async function deleteAccount(accountId) {
  if (DRY_RUN) return { ok: true, dry_run: true };
  const r = await stripeRequest("DELETE", `/v1/accounts/${encodeURIComponent(accountId)}`);
  return r;
}

async function deauthorizeAccount(accountId) {
  if (!STRIPE_CLIENT_ID) {
    return { ok: false, status: 0, json: { error: { message: "Missing STRIPE_CLIENT_ID for deauthorize" } }, text: "" };
  }
  if (DRY_RUN) return { ok: true, dry_run: true };
  const url = "https://connect.stripe.com/oauth/deauthorize";
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: STRIPE_CLIENT_ID,
      client_secret: STRIPE_SECRET_KEY,
      stripe_user_id: accountId,
    }),
  });
  const text = await res.text().catch(() => "");
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { ok: res.ok, status: res.status, json, text };
}

function isStandardAccount(account) {
  return String(account?.type || "").toLowerCase() === "standard";
}

function stripeErrorMessage(r) {
  return String(r?.json?.error?.message || r?.json?.message || r?.text || `HTTP ${r?.status || 0}`);
}

const platformId = await getPlatformAccountId();
console.log(JSON.stringify({ platformId, dryRun: DRY_RUN }));

let startingAfter = null;
let total = 0;
let deleted = 0;
let deauthorized = 0;
let failed = 0;

while (true) {
  const page = await listAccountsPage(startingAfter);
  const accounts = page.data || [];
  if (accounts.length === 0) break;
  for (const acct of accounts) {
    const id = String(acct?.id || "");
    if (!id) continue;
    if (id === platformId) continue;

    total += 1;
    const standard = isStandardAccount(acct);

    if (standard) {
      const r = await deauthorizeAccount(id);
      if (r.ok) {
        deauthorized += 1;
        console.log(JSON.stringify({ id, action: "deauthorize", ok: true }));
      } else {
        failed += 1;
        console.log(JSON.stringify({ id, action: "deauthorize", ok: false, error: stripeErrorMessage(r) }));
      }
      continue;
    }

    const r = await deleteAccount(id);
    if (r.ok) {
      deleted += 1;
      console.log(JSON.stringify({ id, action: "delete", ok: true }));
    } else {
      const msg = stripeErrorMessage(r);
      if (msg.toLowerCase().includes("cannot be deleted") || msg.toLowerCase().includes("not allowed")) {
        const r2 = await deauthorizeAccount(id);
        if (r2.ok) {
          deauthorized += 1;
          console.log(JSON.stringify({ id, action: "deauthorize", ok: true }));
        } else {
          failed += 1;
          console.log(JSON.stringify({ id, action: "deauthorize", ok: false, error: stripeErrorMessage(r2) }));
        }
      } else {
        failed += 1;
        console.log(JSON.stringify({ id, action: "delete", ok: false, error: msg }));
      }
    }
  }
  startingAfter = String(accounts[accounts.length - 1]?.id || "");
  if (!page.hasMore) break;
}

console.log(JSON.stringify({ total, deleted, deauthorized, failed, dryRun: DRY_RUN }));

