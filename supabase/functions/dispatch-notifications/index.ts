import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

type Json = Record<string, unknown>;

function jsonResponse(body: Json, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    },
  });
}

async function callFunction(functionName: string, serviceKey: string, urlBase: string, body: any) {
  const url = `${urlBase.replace(/\/$/, "")}/functions/v1/${functionName}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body ?? {}),
  });
  const text = await res.text().catch(() => "");
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { ok: res.ok, status: res.status, json, text };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return jsonResponse({ ok: true });
  if (req.method !== "POST") return jsonResponse({ ok: false, error: "Method not allowed" }, 405);

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const WEB_BASE_URL = String(Deno.env.get("NOTIFICATIONS_WEB_BASE_URL") || Deno.env.get("WEB_BASE_URL") || "").replace(/\/$/, "");
    const { limit = 50, eventId = null, enqueueEventUpdate = false } = await req.json().catch(() => ({ limit: 50 }));

    const authHeader = req.headers.get("authorization") || req.headers.get("Authorization") || "";
    const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length).trim() : "";

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // enqueueEventUpdate is intentionally ignored — event change notifications
    // are handled exclusively by the on_event_updated() DB trigger, which only
    // fires for real organizer actions (date/venue/cancel/title changes).

    const push = await callFunction("send-push", SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL, { limit });

    const canEmail = Boolean(Deno.env.get("RESEND_API_KEY")) && Boolean(Deno.env.get("NOTIFICATIONS_FROM_EMAIL"));
    const email = canEmail
      ? await callFunction("send-email-notifications", SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL, { limit })
      : { ok: true, status: 204, json: { skipped: true, reason: "email_not_configured" }, text: "" };

    const canSms =
      Boolean(Deno.env.get("TWILIO_ACCOUNT_SID")) &&
      Boolean(Deno.env.get("TWILIO_AUTH_TOKEN")) &&
      Boolean(Deno.env.get("TWILIO_FROM_NUMBER"));
    const sms = canSms
      ? await callFunction("send-sms-notifications", SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL, { limit })
      : { ok: true, status: 204, json: { skipped: true, reason: "sms_not_configured" }, text: "" };

    return jsonResponse({
      ok: true,
      enqueued_event_update: null,
      push: { ok: push.ok, status: push.status, result: push.json ?? push.text },
      email: { ok: email.ok, status: email.status, result: email.json ?? email.text },
      sms: { ok: sms.ok, status: sms.status, result: sms.json ?? sms.text },
    });
  } catch (e: any) {
    return jsonResponse({ ok: false, error: String(e?.message || e) }, 500);
  }
});
