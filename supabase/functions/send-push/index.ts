import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

type DeliveryRow = {
  id: string;
  attempts?: number | null;
  max_attempts?: number | null;
  notifications?: {
    user_id: string;
    title: string;
    body: string;
    message?: string | null;
    data: Record<string, unknown> | null;
  } | null;
};

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

  const { data: pending, error } = await supabaseClient
    .from("notification_deliveries")
    .select("id, attempts, max_attempts, notifications (user_id, title, body, message, data)")
    .eq("channel", "push")
    .eq("status", "pending")
    .limit(limit as number);

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
    .in("user_id", userIds);

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

  const messages: any[] = [];
  const messageDeliveryId: string[] = [];
  const noTokenDeliveryIds: string[] = [];
  const exceededDeliveryIds: string[] = [];
  const attemptsByDelivery: Record<string, number> = {};

  for (const row of rows) {
    const deliveryId = String(row.id);
    const attempts = Number(row.attempts || 0);
    const maxAttempts = Number(row.max_attempts || 3);
    attemptsByDelivery[deliveryId] = attempts;
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
    const title = String(row.notifications?.title || "").trim() ||
      String(row.notifications?.message || "").trim() ||
      "Notificación";
    const body = String(row.notifications?.body || "").trim() ||
      String(row.notifications?.message || "").trim() ||
      "";
    for (const t of toks) {
      messages.push({
        to: t,
        title,
        body,
        data: row.notifications?.data || {},
      });
      messageDeliveryId.push(deliveryId);
    }
  }

  if (messages.length === 0) {
    const now = new Date().toISOString();
    if (exceededDeliveryIds.length) {
      await supabaseClient
        .from("notification_deliveries")
        .update({ status: "failed", last_error: "max_attempts_reached", updated_at: now })
        .in("id", exceededDeliveryIds);
    }
    if (noTokenDeliveryIds.length) {
      await supabaseClient
        .from("notification_deliveries")
        .update({ status: "failed", last_error: "no_push_token", updated_at: now })
        .in("id", noTokenDeliveryIds);
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

  const expoRes = await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(EXPO_ACCESS_TOKEN ? { Authorization: `Bearer ${EXPO_ACCESS_TOKEN}` } : {}),
    },
    body: JSON.stringify(messages),
  });

  const expoData = await expoRes.json().catch(() => null);

  const now = new Date().toISOString();

  if (!expoRes.ok || !expoData?.data || !Array.isArray(expoData.data)) {
    await supabaseClient
      .from("notification_deliveries")
      .update({ status: "failed", last_error: "Expo push send failed", updated_at: now })
      .in("id", Array.from(new Set(messageDeliveryId)));

    return new Response(JSON.stringify({ ok: false, expo: expoData }), {
      headers: { "Content-Type": "application/json" },
      status: 502,
    });
  }

  const perDelivery: Record<string, { ok: number; failed: number; lastError?: string }> = {};
  for (let i = 0; i < expoData.data.length; i++) {
    const deliveryId = messageDeliveryId[i];
    if (!perDelivery[deliveryId]) perDelivery[deliveryId] = { ok: 0, failed: 0 };
    const item = expoData.data[i];
    if (item?.status === "ok") perDelivery[deliveryId].ok += 1;
    else {
      perDelivery[deliveryId].failed += 1;
      perDelivery[deliveryId].lastError = item?.message || item?.details?.error || "Push failed";
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

  if (sentIds.length) {
    for (const deliveryId of sentIds) {
      await supabaseClient
        .from("notification_deliveries")
        .update({
          status: "sent",
          attempts: (attemptsByDelivery[deliveryId] ?? 0) + 1,
          response: expoData,
          updated_at: now,
          sent_at: now,
        })
        .eq("id", deliveryId);
    }
  }

  for (const deliveryId of failedIds) {
    await supabaseClient
      .from("notification_deliveries")
      .update({
        status: "failed",
        attempts: (attemptsByDelivery[deliveryId] ?? 0) + 1,
        response: expoData,
        last_error: failedErrorById[deliveryId] || "Push failed",
        updated_at: now,
      })
      .eq("id", deliveryId);
  }

  if (noTokenDeliveryIds.length) {
    await supabaseClient
      .from("notification_deliveries")
      .update({ status: "failed", last_error: "no_push_token", updated_at: now })
      .in("id", noTokenDeliveryIds);
  }

  return new Response(JSON.stringify({ ok: true, expo: expoData, sent: sentIds.length, failed: failedIds.length }), {
    headers: { "Content-Type": "application/json" },
  });
});
