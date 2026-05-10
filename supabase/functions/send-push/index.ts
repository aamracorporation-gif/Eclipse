import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

type DeliveryRow = {
  id: string;
  notification_id?: string | null;
  attempts?: number | null;
  max_attempts?: number | null;
  next_retry_at?: string | null;
  notifications?: {
    id?: string;
    user_id: string;
    title: string;
    body: string;
    message?: string | null;
    data: Record<string, unknown> | null;
  } | null;
};

function normalizeTemplateData(data: Record<string, unknown> | null | undefined) {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(data || {})) {
    if (v === null || v === undefined) continue;
    out[k] = String(v);
  }

  if (!out.event_title && out.even_title) out.event_title = out.even_title;
  if (!out.even_title && out.event_title) out.even_title = out.event_title;

  return out;
}

function renderTemplate(template: string, data: Record<string, unknown> | null | undefined) {
  let out = String(template || "");
  if (!out.includes("{{") || !out.includes("}}")) return out;

  const flat = normalizeTemplateData(data);
  for (const [k, v] of Object.entries(flat)) {
    out = out.split(`{{${k}}}`).join(v);
  }
  return out;
}

function isValidExpoPushToken(token: string) {
  const t = String(token || "").trim();
  if (!t) return false;
  return /^ExponentPushToken\[[^\]]+\]$/.test(t) || /^ExpoPushToken\[[^\]]+\]$/.test(t);
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "Method not allowed" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const EXPO_ACCESS_TOKEN = Deno.env.get("EXPO_ACCESS_TOKEN") || "";

  const { limit = 50 } = await req.json().catch(() => ({ limit: 50 }));

  const supabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const nowIso = new Date().toISOString();
  const fetchPending = async (withRetryAt: boolean) => {
    let q = supabaseClient
      .from("notification_deliveries")
      .select(
        withRetryAt
          ? "id, notification_id, attempts, max_attempts, next_retry_at, notifications (id, user_id, title, body, message, data)"
          : "id, notification_id, attempts, max_attempts, notifications (id, user_id, title, body, message, data)",
      )
      .eq("channel", "push")
      .eq("status", "pending")
      .limit(limit as number);

    if (withRetryAt) {
      q = q.or(`next_retry_at.is.null,next_retry_at.lte.${nowIso}`);
    }
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

  if (error) {
    return new Response(JSON.stringify({ ok: false, error }), {
      headers: { "Content-Type": "application/json" },
      status: 500,
    });
  }

  const rows = (pending as DeliveryRow[]) || [];
  const userIds = Array.from(new Set(rows.map((r) => String(r.notifications?.user_id || "")))).filter(Boolean);

  const { data: tokens, error: tokenError } = await supabaseClient
    .from("user_push_tokens")
    .select("user_id, token")
    .in("user_id", userIds)
    .eq("is_active", true);

  if (tokenError) {
    return new Response(JSON.stringify({ ok: false, error: tokenError }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  }

  const tokenByUser: Record<string, string[]> = {};
  for (const row of (tokens as any[]) || []) {
    const uid = String(row.user_id || "");
    const t = String(row.token || "");
    if (!uid || !t) continue;
    if (!tokenByUser[uid]) tokenByUser[uid] = [];
    tokenByUser[uid].push(t);
  }

  if ((tokens as any[])?.length) {
    await supabaseClient
      .from("user_push_tokens")
      .update({ last_used_at: new Date().toISOString() })
      .in(
        "token",
        Array.from(new Set((tokens as any[]).map((r) => String(r?.token || "")).filter(Boolean))),
      );
  }

  const messages: any[] = [];
  const messageDeliveryId: string[] = [];
  const noTokenDeliveryIds: string[] = [];
  const exceededDeliveryIds: string[] = [];
  const attemptsByDelivery: Record<string, number> = {};
  const maxAttemptsByDelivery: Record<string, number> = {};
  const notificationFixups: Record<string, { title: string; body: string }> = {};
  const invalidTokenDeliveryIds: string[] = [];
  const invalidTokensToDeactivate: string[] = [];

  for (const row of rows) {
    const deliveryId = String(row.id);
    const attempts = Number(row.attempts || 0);
    const maxAttempts = Number(row.max_attempts || 3);
    attemptsByDelivery[deliveryId] = attempts;
    maxAttemptsByDelivery[deliveryId] = maxAttempts;
    if (attempts >= maxAttempts) {
      exceededDeliveryIds.push(deliveryId);
      continue;
    }

    const userId = String(row.notifications?.user_id || "");
    const toks = tokenByUser[userId] || [];
    if (toks.length === 0) {
      noTokenDeliveryIds.push(deliveryId);
      continue;
    }
    const rawTitle = String(row.notifications?.title || "").trim() ||
      String(row.notifications?.message || "").trim() ||
      "Notificación";
    const rawBody = String(row.notifications?.body || "").trim() ||
      String(row.notifications?.message || "").trim() ||
      "";
    const data = row.notifications?.data || {};
    const title = renderTemplate(rawTitle, data);
    const body = renderTemplate(rawBody, data);

    const notificationId = String(row.notification_id || row.notifications?.id || "");
    if (notificationId && (title !== rawTitle || body !== rawBody)) {
      notificationFixups[notificationId] = { title, body };
    }

    const validToks = toks.filter(isValidExpoPushToken);
    if (validToks.length === 0) {
      invalidTokenDeliveryIds.push(deliveryId);
      for (const t of toks) {
        const raw = String(t || "");
        if (raw) invalidTokensToDeactivate.push(raw);
      }
      continue;
    }

    for (const t of validToks) {
      messages.push({
        to: t,
        title,
        body,
        data,
      });
      messageDeliveryId.push(deliveryId);
    }
  }

  const fixupIds = Object.keys(notificationFixups);
  if (fixupIds.length) {
    for (const id of fixupIds) {
      const u = notificationFixups[id];
      await supabaseClient.from("notifications").update({ title: u.title, body: u.body }).eq("id", id);
    }
  }

  const computeBackoffSeconds = (attempts: number) => {
    const base = 30;
    const cap = 15 * 60;
    const s = Math.min(cap, base * Math.pow(2, Math.max(0, attempts)));
    return Math.max(30, Math.floor(s));
  };

  const bumpRetry = async (deliveryIds: string[], lastError: string, response: any) => {
    const updates: Array<{ id: string; attempts: number; status: string; next_retry_at?: string; last_error: string }> = [];
    for (const id of deliveryIds) {
      const attempts = (attemptsByDelivery[id] ?? 0) + 1;
      const maxAttempts = maxAttemptsByDelivery[id] ?? 3;
      if (attempts >= maxAttempts) {
        updates.push({ id, attempts, status: "failed", last_error: lastError });
      } else {
        const backoff = computeBackoffSeconds(attempts);
        const nextRetryAt = new Date(Date.now() + backoff * 1000).toISOString();
        updates.push({ id, attempts, status: "pending", next_retry_at: nextRetryAt, last_error: lastError });
      }
    }

    for (const u of updates) {
      const payload: any = {
        status: u.status,
        attempts: u.attempts,
        last_error: u.last_error,
        provider: "expo",
        response,
        updated_at: nowIso,
        last_attempt_at: nowIso,
      };
      if (u.next_retry_at) payload.next_retry_at = u.next_retry_at;
      await supabaseClient.from("notification_deliveries").update(payload).eq("id", u.id);
    }
  };

  if (messages.length === 0) {
    if (exceededDeliveryIds.length) {
      await supabaseClient
        .from("notification_deliveries")
        .update({ status: "failed", last_error: "max_attempts_reached", updated_at: nowIso, last_attempt_at: nowIso })
        .in("id", exceededDeliveryIds);
    }
    if (noTokenDeliveryIds.length) {
      await bumpRetry(noTokenDeliveryIds, "no_push_token", { ok: false });
    }
    if (invalidTokenDeliveryIds.length) {
      await bumpRetry(invalidTokenDeliveryIds, "invalid_expo_push_token", { ok: false });
    }
    if (invalidTokensToDeactivate.length) {
      await supabaseClient
        .from("user_push_tokens")
        .update({ is_active: false, last_used_at: nowIso })
        .in("token", Array.from(new Set(invalidTokensToDeactivate)));
    }
    return new Response(JSON.stringify({ ok: true, sent: 0 }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  if (exceededDeliveryIds.length) {
      const now = new Date().toISOString();
      await supabaseClient
        .from("notification_deliveries")
        .update({ status: "failed", last_error: "max_attempts_reached", updated_at: now })
        .in("id", exceededDeliveryIds);
  }

  const expoSend = async (withAuth: boolean) => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (withAuth && EXPO_ACCESS_TOKEN) headers.Authorization = `Bearer ${EXPO_ACCESS_TOKEN}`;
    const res = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers,
      body: JSON.stringify(messages),
    });
    const text = await res.text().catch(() => "");
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { res, text, json };
  };

  let { res: expoRes, text: expoText, json: expoJson } = await expoSend(true);
  if (
    expoRes.status === 401 &&
    EXPO_ACCESS_TOKEN &&
    Array.isArray((expoJson as any)?.errors) &&
    String((expoJson as any)?.errors?.[0]?.code || "").includes("AUTHENTICATION_ERROR")
  ) {
    ({ res: expoRes, text: expoText, json: expoJson } = await expoSend(false));
  }

  const expoData: any = expoJson;

  if (!expoRes.ok || !expoData?.data || !Array.isArray(expoData.data)) {
    await bumpRetry(Array.from(new Set(messageDeliveryId)), "expo_send_failed", expoData);

    return new Response(JSON.stringify({ ok: false, expo_status: expoRes.status, expo: expoData ?? expoText }), {
      headers: { "Content-Type": "application/json" },
      status: 502,
    });
  }

  const perDelivery: Record<string, { ok: number; failed: number; lastError?: string }> = {};
  const tokensToDeactivate: string[] = [];
  const receiptIds: string[] = [];
  const receiptIdByIndex: Record<number, string> = {};
  for (let i = 0; i < expoData.data.length; i++) {
    const deliveryId = messageDeliveryId[i];
    if (!perDelivery[deliveryId]) perDelivery[deliveryId] = { ok: 0, failed: 0 };
    const item = expoData.data[i];
    if (item?.status === "ok") {
      perDelivery[deliveryId].ok += 1;
      const rid = String(item?.id || "");
      if (rid) {
        receiptIds.push(rid);
        receiptIdByIndex[i] = rid;
      }
    }
    else {
      perDelivery[deliveryId].failed += 1;
      perDelivery[deliveryId].lastError = item?.message || item?.details?.error || "Push failed";
      const err = String(item?.details?.error || item?.message || "").toLowerCase();
      if (err.includes("devicenotregistered") || err.includes("device not registered")) {
        const token = String(messages[i]?.to || "");
        if (token) tokensToDeactivate.push(token);
      }
    }
  }

  const sentIds: string[] = [];
  const failedIds: string[] = [];
  const failedErrorById: Record<string, string> = {};

  for (const deliveryId of Object.keys(perDelivery)) {
    if (perDelivery[deliveryId].ok > 0) {
      sentIds.push(deliveryId);
    } else {
      failedIds.push(deliveryId);
      failedErrorById[deliveryId] = perDelivery[deliveryId].lastError || "Push failed";
    }
  }

  let receiptData: any = null;
  if (receiptIds.length) {
    const chunks: string[][] = [];
    for (let i = 0; i < receiptIds.length; i += 1000) chunks.push(receiptIds.slice(i, i + 1000));
    const receipts: Record<string, any> = {};
    for (const chunk of chunks) {
      const rRes = await fetch("https://exp.host/--/api/v2/push/getReceipts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(EXPO_ACCESS_TOKEN ? { Authorization: `Bearer ${EXPO_ACCESS_TOKEN}` } : {}),
        },
        body: JSON.stringify({ ids: chunk }),
      });
      const rJson = await rRes.json().catch(() => null);
      const data = rJson?.data || {};
      for (const [k, v] of Object.entries(data)) receipts[k] = v;
    }
    receiptData = { data: receipts };
    for (const [rid, v] of Object.entries(receiptData.data || {})) {
      const item: any = v;
      const err = String(item?.details?.error || item?.message || "").toLowerCase();
      if (err.includes("devicenotregistered") || err.includes("device not registered")) {
        // Token is not included in receipts, deactivation already handled from send step
      }
    }
  }

  if (sentIds.length) {
    for (const deliveryId of sentIds) {
      await supabaseClient
        .from("notification_deliveries")
        .update({
          status: "sent",
          attempts: (attemptsByDelivery[deliveryId] ?? 0) + 1,
          provider: "expo",
          provider_message_id: "",
          response: { send: expoData, receipts: receiptData },
          updated_at: nowIso,
          last_attempt_at: nowIso,
          sent_at: nowIso,
        })
        .eq("id", deliveryId);
    }
  }

  if (failedIds.length) {
    const retryIds = failedIds.filter((id) => ((attemptsByDelivery[id] ?? 0) + 1) < (maxAttemptsByDelivery[id] ?? 3));
    const hardFailIds = failedIds.filter((id) => !retryIds.includes(id));
    if (hardFailIds.length) {
      for (const deliveryId of hardFailIds) {
        await supabaseClient
          .from("notification_deliveries")
          .update({
            status: "failed",
            attempts: (attemptsByDelivery[deliveryId] ?? 0) + 1,
            provider: "expo",
            response: { send: expoData, receipts: receiptData },
            last_error: failedErrorById[deliveryId] || "push_failed",
            updated_at: nowIso,
            last_attempt_at: nowIso,
          })
          .eq("id", deliveryId);
      }
    }
    if (retryIds.length) {
      await bumpRetry(retryIds, "push_failed_retry", { send: expoData, receipts: receiptData });
    }
  }

  if (noTokenDeliveryIds.length) {
    await bumpRetry(noTokenDeliveryIds, "no_push_token", { ok: false });
  }
  if (invalidTokenDeliveryIds.length) {
    await bumpRetry(invalidTokenDeliveryIds, "invalid_expo_push_token", { ok: false });
  }

  if (tokensToDeactivate.length) {
    await supabaseClient
      .from("user_push_tokens")
      .update({ is_active: false, last_used_at: nowIso })
      .in("token", Array.from(new Set(tokensToDeactivate)));
  }
  if (invalidTokensToDeactivate.length) {
    await supabaseClient
      .from("user_push_tokens")
      .update({ is_active: false, last_used_at: nowIso })
      .in("token", Array.from(new Set(invalidTokensToDeactivate)));
  }

  return new Response(JSON.stringify({ ok: true, expo: expoData, sent: sentIds.length, failed: failedIds.length }), {
    headers: { "Content-Type": "application/json" },
  });
});
