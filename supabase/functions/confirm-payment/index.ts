import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const headers = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function reply(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers });
}

// Read-only by design: only a signed Stripe webhook may fulfill a purchase.
serve(async (req) => {
  if (req.method === "OPTIONS") return reply({ ok: true });
  if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405);
  try {
    const url = Deno.env.get("SUPABASE_URL") || "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
    if (!url || !anonKey) return reply({ error: "Missing Supabase env vars" }, 500);
    const client = createClient(url, anonKey, {
      global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
    });
    const { data: auth, error: authError } = await client.auth.getUser();
    if (authError || !auth.user) return reply({ status: "unauthorized", error: "Unauthorized" }, 401);
    const body = await req.json().catch(() => null);
    const paymentIntentId = String(body?.payment_intent_id || "").trim();
    if (!paymentIntentId) return reply({ status: "error", error: "Missing payment_intent_id" }, 400);
    const { data: tx, error } = await client
      .from("payment_transactions")
      .select("kind,status")
      .eq("stripe_payment_intent_id", paymentIntentId)
      .eq("user_id", auth.user.id)
      .maybeSingle();
    if (error) throw error;
    if (!tx) return reply({ fulfilled: false, status: "not_found", error: "Transaction not found" }, 404);
    return reply({
      fulfilled: tx.status === "fulfilled",
      kind: tx.kind,
      status: tx.status,
      ...(tx.status === "created" ? { error: "Pago pendiente de confirmación por Stripe." } : {}),
    });
  } catch (error) {
    console.error("confirm-payment status lookup failed", error);
    return reply({ fulfilled: false, status: "error", error: "Internal error" }, 500);
  }
});
