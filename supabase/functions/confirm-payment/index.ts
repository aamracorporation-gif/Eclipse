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

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function isMissingColumnError(error: unknown): boolean {
  const code = (error as any)?.code;
  if (code === "42703") return true;
  const msg = (error as any)?.message;
  return typeof msg === "string" && msg.includes("does not exist");
}

async function stripeRetrievePaymentIntent(paymentIntentId: string) {
  const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
  if (!STRIPE_SECRET_KEY) throw new Error("Missing STRIPE_SECRET_KEY");

  const res = await fetch(`https://api.stripe.com/v1/payment_intents/${paymentIntentId}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` },
  });
  const data = await res.json();
  if (!res.ok) {
    const msg = (data as any)?.error?.message || "Stripe error";
    throw new Error(msg);
  }
  return data as { id: string; status: string; amount: number; currency: string };
}

async function stripeRefundPaymentIntent(paymentIntentId: string) {
  const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
  if (!STRIPE_SECRET_KEY) throw new Error("Missing STRIPE_SECRET_KEY");

  const res = await fetch("https://api.stripe.com/v1/refunds", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Idempotency-Key": `refund:${paymentIntentId}`,
    },
    body: new URLSearchParams({ payment_intent: paymentIntentId }),
  });

  const data = await res.json();
  if (!res.ok) {
    const msg = (data as any)?.error?.message || "Stripe error";
    throw new Error(msg);
  }
  return data as { id: string; status: string };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return jsonResponse({ ok: true });

  try {
    if (req.method !== "POST") {
      return jsonResponse({ fulfilled: false, kind: "event_ticket", status: "error", error: "Method not allowed" }, 200);
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
      return jsonResponse({ fulfilled: false, kind: "event_ticket", status: "error", error: "Missing Supabase env vars" }, 200);
    }

    const authHeader = req.headers.get("Authorization") || "";
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: authHeader ? { headers: { Authorization: authHeader } } : undefined,
    });
    const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData?.user) {
      return jsonResponse({ fulfilled: false, kind: "event_ticket", status: "unauthorized", error: userError?.message || "Unauthorized" }, 200);
    }

    const userId = userData.user.id;

    let paymentIntentId = "";
    try {
      const body = (await req.json()) as any;
      paymentIntentId = typeof body?.payment_intent_id === "string" ? body.payment_intent_id : "";
    } catch {
      return jsonResponse({ fulfilled: false, kind: "event_ticket", status: "error", error: "Invalid JSON" }, 200);
    }

    if (!paymentIntentId) {
      return jsonResponse({ fulfilled: false, kind: "event_ticket", status: "error", error: "Missing payment_intent_id" }, 200);
    }

    let txRes = await serviceClient
      .from("payment_transactions")
      .select("id, kind, status, user_id, metadata")
      .eq("stripe_payment_intent_id", paymentIntentId)
      .maybeSingle();

    if (txRes?.error && isMissingColumnError(txRes.error)) {
      txRes = await serviceClient
        .from("payment_transactions")
        .select("id, kind, status, user_id")
        .eq("stripe_payment_intent_id", paymentIntentId)
        .maybeSingle();
    }

    const tx = txRes?.data as any;
    const txError = txRes?.error as any;
    if (txError || !tx) return jsonResponse({ fulfilled: false, kind: "event_ticket", status: "not_found", error: "Transaction not found" }, 200);
    if ((tx as any).user_id !== userId) return jsonResponse({ fulfilled: false, kind: (tx as any).kind || "event_ticket", status: "unauthorized", error: "Unauthorized" }, 200);

    let intent;
    try {
      intent = await stripeRetrievePaymentIntent(paymentIntentId);
      for (let i = 0; i < 4 && intent.status !== "succeeded"; i++) {
        if (intent.status === "processing") {
          await sleep(900);
          intent = await stripeRetrievePaymentIntent(paymentIntentId);
          continue;
        }
        break;
      }
    } catch (e: any) {
      return jsonResponse({ fulfilled: false, kind: (tx as any).kind || "event_ticket", status: "error", error: e?.message || "Stripe error" }, 200);
    }

    if (intent.status !== "succeeded") {
      const status = String(intent.status || "");
      const friendly =
        status === "processing"
          ? "Pago en procesamiento. Inténtalo de nuevo en unos segundos."
          : status
            ? `Pago no completado (status=${status}).`
            : "Pago no completado.";
      return jsonResponse({ fulfilled: false, kind: (tx as any).kind, status, error: friendly }, 200);
    }

    const { data: fulfillment, error: fulfillError } = await serviceClient.rpc("fulfill_payment_for_user", {
      p_payment_intent_id: paymentIntentId,
      p_user_id: userId,
    });

    if (fulfillError) {
      try {
        await stripeRefundPaymentIntent(paymentIntentId);
      } catch {}

      const updateRes = await serviceClient
        .from("payment_transactions")
        .update({ status: "failed", metadata: { error: fulfillError.message } })
        .eq("stripe_payment_intent_id", paymentIntentId);
      if (updateRes?.error && isMissingColumnError(updateRes.error)) {
        await serviceClient
          .from("payment_transactions")
          .update({ status: "failed" })
          .eq("stripe_payment_intent_id", paymentIntentId);
      }

      return jsonResponse({
        fulfilled: false,
        kind: (tx as any).kind,
        error: `No se pudo entregar la compra. Se reembolsó el pago. (${fulfillError.message})`,
        status: "refunded",
      }, 200);
    }

    // Trigger push delivery immediately (best-effort)
    try {
      const url = `${SUPABASE_URL}/functions/v1/send-push`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ limit: 25 }),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        console.error("[PUSH] send-push returned non-200:", res.status, txt || "");
      }
    } catch (e) {
      console.error("[PUSH] send-push invocation failed:", (e as any)?.message || e);
    }

    return jsonResponse(fulfillment as any, 200);
  } catch (e: any) {
    return jsonResponse({ fulfilled: false, kind: "event_ticket", status: "error", error: e?.message || "Internal error" }, 200);
  }
});
