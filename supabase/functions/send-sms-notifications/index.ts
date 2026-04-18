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

function basicAuthHeader(user: string, pass: string) {
  return "Basic " + btoa(`${user}:${pass}`);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return jsonResponse({ ok: true });
  if (req.method !== "POST") return jsonResponse({ ok: false, error: "Method not allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID") || "";
  const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN") || "";
  const TWILIO_FROM_NUMBER = Deno.env.get("TWILIO_FROM_NUMBER") || "";

  const { limit = 50 } = await req.json().catch(() => ({ limit: 50 }));
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: deliveries, error } = await supabase
    .from("notification_deliveries")
    .select("id, notification_id, attempts, max_attempts, notifications (user_id, title, body, data)")
    .eq("channel", "sms")
    .eq("status", "pending")
    .limit(limit as number);

  if (error) return jsonResponse({ ok: false, error }, 500);

  const rows = (deliveries as any[]) || [];
  if (rows.length === 0) return jsonResponse({ ok: true, sent: 0, failed: 0 });

  const now = new Date().toISOString();

  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER) {
    const ids = rows.map((d) => d.id);
    await supabase
      .from("notification_deliveries")
      .update({
        status: "failed",
        last_error: "Missing TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN/TWILIO_FROM_NUMBER",
        updated_at: now,
      })
      .in("id", ids);
    return jsonResponse({ ok: false, error: "Missing Twilio config" }, 500);
  }

  const userIds = Array.from(new Set(rows.map((d) => String(d?.notifications?.user_id || "")))).filter(Boolean);
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, phone")
    .in("id", userIds);

  const phoneByUser: Record<string, string> = {};
  for (const p of (profiles as any[]) || []) {
    if (p?.id && p?.phone) phoneByUser[String(p.id)] = String(p.phone);
  }

  let sent = 0;
  let failed = 0;

  for (const d of rows) {
    const deliveryId = String(d.id);
    const attempts = Number(d.attempts || 0);
    const maxAttempts = Number(d.max_attempts || 3);

    if (attempts >= maxAttempts) {
      await supabase
        .from("notification_deliveries")
        .update({ status: "failed", last_error: "max_attempts_reached", updated_at: now })
        .eq("id", deliveryId);
      failed += 1;
      continue;
    }

    const userId = String(d?.notifications?.user_id || "");
    const to = phoneByUser[userId] || "";
    if (!to) {
      await supabase
        .from("notification_deliveries")
        .update({ status: "failed", last_error: "no_phone", updated_at: now })
        .eq("id", deliveryId);
      failed += 1;
      continue;
    }

    const title = String(d?.notifications?.title || "Notificación");
    const body = String(d?.notifications?.body || "");
    const text = body ? `${title}\n${body}` : title;

    try {
      const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
      const form = new URLSearchParams();
      form.set("From", TWILIO_FROM_NUMBER);
      form.set("To", to);
      form.set("Body", text.slice(0, 1500));

      const res = await fetch(twilioUrl, {
        method: "POST",
        headers: {
          Authorization: basicAuthHeader(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: form.toString(),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as any)?.message || "Twilio error");

      await supabase
        .from("notification_deliveries")
        .update({
          status: "sent",
          attempts: attempts + 1,
          to_address: to,
          provider: "twilio",
          provider_message_id: String((data as any)?.sid || ""),
          response: data,
          sent_at: now,
          updated_at: now,
        })
        .eq("id", deliveryId);

      sent += 1;
    } catch (e) {
      await supabase
        .from("notification_deliveries")
        .update({
          status: "failed",
          attempts: attempts + 1,
          to_address: to,
          provider: "twilio",
          last_error: String((e as any)?.message || e),
          updated_at: now,
        })
        .eq("id", deliveryId);
      failed += 1;
    }
  }

  return jsonResponse({ ok: true, sent, failed });
});

