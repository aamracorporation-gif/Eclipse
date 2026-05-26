import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

type Json = Record<string, unknown>;

function jsonResponse(body: Json, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      ...extraHeaders,
    },
  });
}

function htmlResponse(html: string, status = 200) {
  return new Response(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

function getJwt(req: Request) {
  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization") || "";
  return authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length).trim() : "";
}

function pickPlatformFromUa(ua: string) {
  const u = String(ua || "").toLowerCase();
  if (u.includes("android")) return "android";
  if (u.includes("iphone") || u.includes("ipad") || u.includes("ios")) return "ios";
  return "web";
}

async function parseJson(req: Request) {
  const text = await req.text().catch(() => "");
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return jsonResponse({ ok: true });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const WEB_BASE_URL = String(Deno.env.get("WEB_BASE_URL") || "").replace(/\/$/, "");
  const APP_SCHEME = String(Deno.env.get("APP_SCHEME") || "eclipse").trim();
  const PLAY_STORE_URL = String(Deno.env.get("PLAY_STORE_URL") || "").trim();
  const APP_STORE_URL = String(Deno.env.get("APP_STORE_URL") || "").trim();
  const DEFAULT_ANDROID_PACKAGE = String(Deno.env.get("ANDROID_PACKAGE") || "com.achraf.eclipse").trim();
  const defaultPlayStoreUrl = PLAY_STORE_URL || (DEFAULT_ANDROID_PACKAGE ? `https://play.google.com/store/apps/details?id=${DEFAULT_ANDROID_PACKAGE}` : "");
  const defaultAppStoreUrl = APP_STORE_URL || (WEB_BASE_URL ? `${WEB_BASE_URL}/descargar` : "");

  const url = new URL(req.url);
  const path = url.pathname.split("/").filter(Boolean);
  const fnIdx = path.lastIndexOf("event-share");
  const action = fnIdx >= 0 ? (path.slice(fnIdx + 1).join("/") || "") : "";

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const body: any = req.method === "POST" ? await parseJson(req) : {};
    const bodyAction = String(body?.action || "").trim();

    if (req.method === "POST" && (action === "create" || bodyAction === "create" || action === "")) {
      const jwt = getJwt(req);
      if (!jwt) return jsonResponse({ ok: false, error: "Missing Authorization" }, 401);

      const eventId = String(body?.eventId || "");
      const isCreateIntent = action === "create" || bodyAction === "create";
      if (!isCreateIntent) return jsonResponse({ ok: false, error: "Not found" }, 404);
      if (!eventId) return jsonResponse({ ok: false, error: "Missing eventId" }, 400);

      const { data: userData, error: userErr } = await supabase.auth.getUser(jwt);
      if (userErr || !userData?.user?.id) return jsonResponse({ ok: false, error: "Unauthorized" }, 401);
      const callerId = userData.user.id;

      const { data: profile } = await supabase.from("profiles").select("role").eq("id", callerId).maybeSingle();
      const role = String((profile as any)?.role || "");
      const isAdmin = role === "admin";
      const isOrganizer = role === "organizer";

      const selectEvent = async (withAccessPolicy: boolean) => {
        const base = "id, title, creator_id, event_date, status, is_cancelled";
        const cols = withAccessPolicy ? `${base}, access_policy` : base;
        return await supabase.from("events").select(cols).eq("id", eventId).maybeSingle();
      };

      let eventRes: any = await selectEvent(true);
      if (eventRes.error?.code === "42703" && String(eventRes.error?.message || "").match(/access_policy/i)) {
        eventRes = await selectEvent(false);
      }
      const eventRow = eventRes.data;
      if (!eventRow?.id) return jsonResponse({ ok: false, error: "Event not found" }, 404);

      const status = String((eventRow as any).status || "");
      const isCancelled = Boolean((eventRow as any).is_cancelled);
      if (status === "cancelled" || isCancelled) {
        return jsonResponse({ ok: false, error: "Event cancelled" }, 410);
      }
      const eventDate = new Date(String((eventRow as any).event_date || ""));
      if (Number.isFinite(eventDate.getTime()) && eventDate.getTime() <= Date.now()) {
        return jsonResponse({ ok: false, error: "Event expired" }, 410);
      }
      const accessPolicy = String((eventRow as any).access_policy || "");
      const isPrivate = accessPolicy && accessPolicy.toLowerCase() === "private";
      if (isPrivate && !isAdmin) {
        if (!isOrganizer || String(eventRow.creator_id || "") !== callerId) {
          return jsonResponse({ ok: false, error: "Forbidden" }, 403);
        }
      }

      const nowIso = new Date().toISOString();
      const { data: existing } = await supabase
        .from("event_share_links")
        .select("id, token, expires_at, is_active")
        .eq("event_id", eventId)
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existing?.id && existing?.token) {
        const token = String(existing.token);
        const shareUrl = WEB_BASE_URL
          ? `${WEB_BASE_URL}/evento/${token}`
          : `${SUPABASE_URL.replace(/\/$/, "")}/functions/v1/event-share/evento/${token}`;
        return jsonResponse({ ok: true, eventId, token, url: shareUrl, created_at: nowIso, reused: true });
      }

      const { data: created, error: createErr } = await supabase
        .from("event_share_links")
        .insert({ event_id: eventId, created_by: callerId, is_active: true })
        .select("id, token, created_at")
        .single();

      if (createErr || !created?.token) return jsonResponse({ ok: false, error: "Failed to create link" }, 500);

      const token = String(created.token);
      const shareUrl = WEB_BASE_URL
        ? `${WEB_BASE_URL}/evento/${token}`
        : `${SUPABASE_URL.replace(/\/$/, "")}/functions/v1/event-share/evento/${token}`;

      return jsonResponse({ ok: true, eventId, token, url: shareUrl, created_at: created.created_at, reused: false });
    }

    if (req.method === "POST" && (action === "convert" || bodyAction === "convert")) {
      const jwt = getJwt(req);
      if (!jwt) return jsonResponse({ ok: false, error: "Missing Authorization" }, 401);

      const token = String(body?.token || "");
      const kind = String(body?.kind || "open");
      if (!token) return jsonResponse({ ok: false, error: "Missing token" }, 400);

      const { data: userData, error: userErr } = await supabase.auth.getUser(jwt);
      if (userErr || !userData?.user?.id) return jsonResponse({ ok: false, error: "Unauthorized" }, 401);
      const userId = userData.user.id;

      const { data: linkRow } = await supabase
        .from("event_share_links")
        .select("id, event_id, token, is_active, expires_at, conversion_count")
        .eq("token", token)
        .maybeSingle();

      if (!linkRow?.id) return jsonResponse({ ok: false, error: "Share link not found" }, 404);
      if (linkRow.is_active === false) return jsonResponse({ ok: false, error: "Share link inactive" }, 410);
      if (linkRow.expires_at && new Date(String(linkRow.expires_at)).getTime() <= Date.now()) {
        return jsonResponse({ ok: false, error: "Share link expired" }, 410);
      }

      await supabase.from("event_share_conversions").insert({
        share_link_id: linkRow.id,
        event_id: linkRow.event_id,
        token,
        user_id: userId,
        kind,
      });

      await supabase
        .from("event_share_links")
        .update({ conversion_count: Number((linkRow as any).conversion_count || 0) + 1, last_converted_at: new Date().toISOString() })
        .eq("id", linkRow.id);

      return jsonResponse({ ok: true });
    }

    if (req.method === "GET" && action === "resolve") {
      const expectedEventId = String(url.searchParams.get("eventId") || "");
      const token = String(url.searchParams.get("token") || "");
      if (!token) return jsonResponse({ ok: false, error: "Missing token" }, 400);

      const { data: linkRow } = await supabase
        .from("event_share_links")
        .select("id, event_id, token, is_active, expires_at, click_count")
        .eq("token", token)
        .maybeSingle();

      if (!linkRow?.id) return jsonResponse({ ok: false, error: "Share link not found" }, 404);
      if (expectedEventId && String(linkRow.event_id || "") !== expectedEventId) {
        return jsonResponse({ ok: false, error: "Share link not found" }, 404);
      }
      if (linkRow.is_active === false) return jsonResponse({ ok: false, error: "Share link inactive" }, 410);
      if (linkRow.expires_at && new Date(String(linkRow.expires_at)).getTime() <= Date.now()) {
        return jsonResponse({ ok: false, error: "Share link expired" }, 410);
      }

      const eventId = String(linkRow.event_id || "");
      if (!eventId) return jsonResponse({ ok: false, error: "Event not found" }, 404);

      const selectEvent = async (withAccessPolicy: boolean) => {
        const base = "id, title, poster_url, event_date, status, is_cancelled";
        const cols = withAccessPolicy ? `${base}, access_policy` : base;
        return await supabase.from("events").select(cols).eq("id", eventId).maybeSingle();
      };

      let eventRes: any = await selectEvent(true);
      if (eventRes.error?.code === "42703" && String(eventRes.error?.message || "").match(/access_policy/i)) {
        eventRes = await selectEvent(false);
      }
      const eventRow = eventRes.data;
      if (!eventRow?.id) return jsonResponse({ ok: false, error: "Event not found" }, 404);

      if (String((eventRow as any).status || "") === "cancelled" || Boolean((eventRow as any).is_cancelled)) {
        return jsonResponse({ ok: false, error: "Event cancelled" }, 410);
      }

      const eventDate = new Date(String((eventRow as any).event_date || ""));
      if (Number.isFinite(eventDate.getTime()) && eventDate.getTime() <= Date.now()) {
        return jsonResponse({ ok: false, error: "Event expired" }, 410);
      }

      const accessPolicy = String((eventRow as any).access_policy || "");
      if (accessPolicy && accessPolicy.toLowerCase() === "private") {
        return jsonResponse({ ok: false, error: "Event private" }, 403);
      }

      const ua = req.headers.get("user-agent") || "";
      const platform = pickPlatformFromUa(ua);

      await supabase.from("event_share_clicks").insert({
        share_link_id: linkRow.id,
        event_id: eventId,
        token,
        platform,
        user_agent: ua.slice(0, 500),
      });

      await supabase
        .from("event_share_links")
        .update({ click_count: Number((linkRow as any).click_count || 0) + 1, last_clicked_at: new Date().toISOString() })
        .eq("id", linkRow.id);

      const deepLink = `${APP_SCHEME}://evento/${token}`;
      const webUrl = WEB_BASE_URL ? `${WEB_BASE_URL}/evento/${token}` : url.toString();

      return jsonResponse({
        ok: true,
        event: {
          id: eventRow.id,
          title: (eventRow as any).title ?? "",
          poster_url: (eventRow as any).poster_url ?? "",
          event_date: (eventRow as any).event_date ?? null,
        },
        links: {
          deepLink,
          webUrl,
          playStoreUrl: defaultPlayStoreUrl || null,
          appStoreUrl: defaultAppStoreUrl || null,
        },
      });
    }

    if (req.method === "GET" && action.startsWith("evento/")) {
      const parts = action.split("/").filter(Boolean);
      const maybeEventId = String(parts[1] || "");
      const token = String(parts[2] || parts[1] || "");
      if (!token) return htmlResponse("Missing token", 400);

      const resolveQs = parts.length >= 3
        ? `eventId=${encodeURIComponent(maybeEventId)}&token=${encodeURIComponent(token)}`
        : `token=${encodeURIComponent(token)}`;
      const resolvedUrl = `${SUPABASE_URL.replace(/\/$/, "")}/functions/v1/event-share/resolve?${resolveQs}`;
      const deepLink = parts.length >= 3 ? `${APP_SCHEME}://evento/${maybeEventId}/${token}` : `${APP_SCHEME}://evento/${token}`;
      const storeUrl = pickPlatformFromUa(req.headers.get("user-agent") || "") === "ios" ? (defaultAppStoreUrl || "") : (defaultPlayStoreUrl || "");

      const html = `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Abrir evento</title>
  <style>
    body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:#0b0b0f;color:#fff;margin:0;padding:24px;}
    .card{max-width:520px;margin:0 auto;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.10);border-radius:16px;padding:18px;}
    .btn{display:block;width:100%;padding:14px 16px;border-radius:12px;border:none;background:#7C3AED;color:#fff;font-weight:700;font-size:16px;margin-top:12px;text-align:center;text-decoration:none;}
    .muted{color:rgba(255,255,255,0.75);font-size:14px;line-height:1.4}
  </style>
</head>
<body>
  <div class="card">
    <h2 style="margin:0 0 8px 0;">Abriendo evento…</h2>
    <div class="muted">Si tienes la app instalada, se abrirá automáticamente. Si no está instalada, podrás instalarla y volver a abrir este enlace.</div>
    <a class="btn" href="${deepLink}">Abrir en la app</a>
    ${storeUrl ? `<a class="btn" href="${storeUrl}" style="background:rgba(255,255,255,0.12);">Ir a la tienda</a>` : ``}
  </div>
  <script>
    (function(){
      var deepLink = ${JSON.stringify(deepLink)};
      var storeUrl = ${JSON.stringify(storeUrl || "")};
      var t = Date.now();
      window.location.href = deepLink;
      setTimeout(function(){
        if (storeUrl && Date.now() - t < 2000) window.location.href = storeUrl;
      }, 1300);
      fetch(${JSON.stringify(resolvedUrl)}).catch(function(){});
    })();
  </script>
</body>
</html>`;

      return htmlResponse(html, 200);
    }

    if (req.method === "GET" && action === "") {
      const deepLink = `${APP_SCHEME}://`;
      const storeUrl = pickPlatformFromUa(req.headers.get("user-agent") || "") === "ios" ? (defaultAppStoreUrl || "") : (defaultPlayStoreUrl || "");
      const html = `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Abrir Eclipse</title>
  <style>
    body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:#0b0b0f;color:#fff;margin:0;padding:24px;}
    .card{max-width:520px;margin:0 auto;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.10);border-radius:16px;padding:18px;}
    .btn{display:block;width:100%;padding:14px 16px;border-radius:12px;border:none;background:#7C3AED;color:#fff;font-weight:700;font-size:16px;margin-top:12px;text-align:center;text-decoration:none;}
    .muted{color:rgba(255,255,255,0.75);font-size:14px;line-height:1.4}
  </style>
</head>
<body>
  <div class="card">
    <h2 style="margin:0 0 8px 0;">Abrir Eclipse…</h2>
    <div class="muted">Si tienes la app instalada, se abrirá automáticamente. Si no está instalada, podrás instalarla y volver a abrir este enlace.</div>
    <a class="btn" href="${deepLink}">Abrir la app</a>
    ${storeUrl ? `<a class="btn" href="${storeUrl}" style="background:rgba(255,255,255,0.12);">Ir a la tienda</a>` : ``}
  </div>
  <script>
    (function(){
      var deepLink = ${JSON.stringify(deepLink)};
      var storeUrl = ${JSON.stringify(storeUrl || "")};
      var t = Date.now();
      window.location.href = deepLink;
      setTimeout(function(){
        if (storeUrl && Date.now() - t < 2000) window.location.href = storeUrl;
      }, 1300);
    })();
  </script>
</body>
</html>`;
      return htmlResponse(html, 200);
    }

    return jsonResponse({ ok: false, error: "Not found" }, 404);
  } catch (e: any) {
    return jsonResponse({ ok: false, error: String(e?.message || e || "Unknown error") }, 500);
  }
});
