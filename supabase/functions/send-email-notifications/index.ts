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

serve(async (req) => {
  if (req.method === "OPTIONS") return jsonResponse({ ok: true });
  if (req.method !== "POST") return jsonResponse({ ok: false, error: "Method not allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
  const FROM_EMAIL = Deno.env.get("NOTIFICATIONS_FROM_EMAIL") || "";

  const { limit = 50 } = await req.json().catch(() => ({ limit: 50 }));

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const now = new Date().toISOString();
  const fetchPending = async (withRetryAt: boolean) => {
    let q = supabase
      .from("notification_deliveries")
      .select(
        withRetryAt
          ? "id, attempts, max_attempts, next_retry_at, notifications (user_id, title, body, data)"
          : "id, attempts, max_attempts, notifications (user_id, title, body, data)",
      )
      .eq("channel", "email")
      .eq("status", "pending")
      .limit(limit as number);
    if (withRetryAt) q = q.or(`next_retry_at.is.null,next_retry_at.lte.${now}`);
    return q;
  };

  let pending: any[] | null = null;
  let error: any = null;
  {
    const res = await fetchPending(true);
    pending = res.data as any;
    error = res.error as any;
  }
  if (error?.code === "42703" && String(error?.message || "").includes("next_retry_at")) {
    const res = await fetchPending(false);
    pending = res.data as any;
    error = res.error as any;
  }

  if (error) return jsonResponse({ ok: false, error }, 500);

  const candidates = (pending as any[]) || [];
  if (candidates.length === 0) return jsonResponse({ ok: true, sent: 0, failed: 0 });

  if (!RESEND_API_KEY || !FROM_EMAIL) {
    const ids = candidates.map((n) => n.id);
    await supabase
      .from("notification_deliveries")
      .update({ status: "failed", last_error: "Missing RESEND_API_KEY or NOTIFICATIONS_FROM_EMAIL", updated_at: now })
      .in("id", ids);
    return jsonResponse({ ok: false, error: "Missing RESEND_API_KEY or NOTIFICATIONS_FROM_EMAIL" }, 500);
  }

  let sent = 0;
  let failed = 0;
  const attemptsById: Record<string, number> = {};
  const maxAttemptsById: Record<string, number> = {};

  const computeBackoffSeconds = (attempts: number) => {
    const base = 60;
    const cap = 30 * 60;
    const s = Math.min(cap, base * Math.pow(2, Math.max(0, attempts)));
    return Math.max(60, Math.floor(s));
  };

  const retryOrFail = async (deliveryId: string, attempts: number, maxAttempts: number, lastError: string, response: any) => {
    const nextAttempts = attempts + 1;
    if (nextAttempts >= maxAttempts) {
      await supabase
        .from("notification_deliveries")
        .update({
          status: "failed",
          attempts: nextAttempts,
          last_error: lastError,
          provider: "resend",
          response,
          updated_at: now,
          last_attempt_at: now,
        })
        .eq("id", deliveryId);
      return;
    }
    const backoff = computeBackoffSeconds(nextAttempts);
    const nextRetryAt = new Date(Date.now() + backoff * 1000).toISOString();
    await supabase
      .from("notification_deliveries")
      .update({
        status: "pending",
        attempts: nextAttempts,
        last_error: lastError,
        provider: "resend",
        response,
        updated_at: now,
        last_attempt_at: now,
        next_retry_at: nextRetryAt,
      })
      .eq("id", deliveryId);
  };

  const userIds = Array.from(new Set(candidates.map((n) => String(n?.notifications?.user_id || "")).filter(Boolean)));
  const profilesRes = userIds.length
    ? await supabase.from("profiles").select("id, email").in("id", userIds)
    : { data: [], error: null };
  const emailByUser: Record<string, string> = {};
  for (const p of (profilesRes.data as any[]) || []) {
    const id = String(p.id || "");
    const email = String(p.email || "");
    if (id && email) emailByUser[id] = email;
  }

  for (const n of candidates) {
    try {
      const deliveryId = String(n.id);
      const attempts = Number(n.attempts || 0);
      const maxAttempts = Number(n.max_attempts || 3);
      attemptsById[deliveryId] = attempts;
      maxAttemptsById[deliveryId] = maxAttempts;

      if (attempts >= maxAttempts) {
        await supabase
          .from("notification_deliveries")
          .update({ status: "failed", last_error: "max_attempts_reached", updated_at: now })
          .eq("id", deliveryId);
        failed += 1;
        continue;
      }

      const userId = String(n?.notifications?.user_id || "");
      const email = emailByUser[userId] || "";
      if (!email) throw new Error("User email not found");

      const subject = String(n?.notifications?.title || "Notificación");
      const bodyText = String(n?.notifications?.body || "");
      const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto;line-height:1.5;color:#111">
<h2 style="margin:0 0 12px 0">${escapeHtml(subject)}</h2>
<p style="margin:0 0 12px 0">${escapeHtml(bodyText)}</p>
</div>`;

      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: FROM_EMAIL,
          to: email,
          subject,
          html,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as any)?.error?.message || "Resend error");

      await supabase
        .from("notification_deliveries")
        .update({
          status: "sent",
          attempts: attempts + 1,
          to_address: email,
          provider: "resend",
          provider_message_id: String((data as any)?.id || ""),
          response: data,
          sent_at: now,
          updated_at: now,
          last_attempt_at: now,
        })
        .eq("id", deliveryId);

      sent += 1;
    } catch (e) {
      const deliveryId = String(n.id);
      const attempts = Number(n.attempts || 0);
      const maxAttempts = Number(n.max_attempts || 3);
      await retryOrFail(deliveryId, attempts, maxAttempts, String((e as any)?.message || e), { ok: false });
      failed += 1;
    }
  }

  return jsonResponse({ ok: true, sent, failed });
});

function escapeHtml(input: string) {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
