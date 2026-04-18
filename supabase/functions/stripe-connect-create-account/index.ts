import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

type Json = Record<string, unknown>;

function jsonResponse(body: Json, _status = 200) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function stripeHeaders(secretKey: string) {
  return {
    Authorization: `Bearer ${secretKey}`,
    "Content-Type": "application/x-www-form-urlencoded",
  };
}

async function stripeCreateAccount(params: Record<string, string>) {
  const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
  if (!STRIPE_SECRET_KEY) throw new Error("Missing STRIPE_SECRET_KEY");

  const res = await fetch("https://api.stripe.com/v1/accounts", {
    method: "POST",
    headers: stripeHeaders(STRIPE_SECRET_KEY),
    body: new URLSearchParams(params),
  });

  const data = await res.json();
  if (!res.ok) {
    const msg = (data as any)?.error?.message || "Failed to create Stripe account";
    throw new Error(msg);
  }
  return data as { id: string };
}

async function stripeGetPlatformAccount() {
  const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
  if (!STRIPE_SECRET_KEY) throw new Error("Missing STRIPE_SECRET_KEY");

  const res = await fetch("https://api.stripe.com/v1/account", {
    method: "GET",
    headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` },
  });

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = (data as any)?.error?.message || "Stripe error";
    throw new Error(String(msg));
  }

  return data as { id: string };
}

async function stripeGetAccount(accountId: string) {
  const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
  if (!STRIPE_SECRET_KEY) throw new Error("Missing STRIPE_SECRET_KEY");

  const res = await fetch(`https://api.stripe.com/v1/accounts/${encodeURIComponent(accountId)}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` },
  });

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 404) return null;
    if (res.status === 401 || res.status === 403) {
      const msg = String((data as any)?.error?.message || "");
      if (msg.toLowerCase().includes("does not have access to account")) return null;
    }
    const msg = (data as any)?.error?.message || "Stripe error";
    throw new Error(String(msg));
  }

  return data as { id: string };
}

function isConnectNotEnabledMessage(message: string) {
  const msg = String(message || "").toLowerCase();
  return msg.includes("signed up for connect");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return jsonResponse({ ok: true });
  if (req.method !== "POST") return jsonResponse({ ok: false, error: "Method not allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    return jsonResponse({ ok: false, error: "Missing Supabase env vars" }, 500);
  }

  const authHeader = req.headers.get("Authorization") || "";
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData?.user) return jsonResponse({ ok: false, error: "Unauthorized" }, 401);

  const userId = userData.user.id;
  const userEmail = userData.user.email || "";

  const { data: profile, error: profileError } = await serviceClient
    .from("profiles")
    .select("id, role, stripe_account_id, legal_name, business_type, country")
    .eq("id", userId)
    .maybeSingle();

  if (profileError) return jsonResponse({ ok: false, error: "Failed to load profile" }, 500);
  if (!profile?.id) return jsonResponse({ ok: false, error: "Profile not found" }, 404);
  if (profile.role !== "organizer") return jsonResponse({ ok: false, error: "Not an organizer" }, 403);

  if (profile.stripe_account_id) {
    const existing = await stripeGetAccount(profile.stripe_account_id).catch(() => null);
    if (existing?.id) {
      return jsonResponse({ stripe_account_id: profile.stripe_account_id });
    }

    await serviceClient
      .from("profiles")
      .update({
        stripe_account_id: null,
        stripe_account_type: null,
        stripe_onboarding_completed: false,
        stripe_details_submitted: false,
        stripe_charges_enabled: false,
        stripe_payouts_enabled: false,
      })
      .eq("id", userId);
  }

  try {
    const businessType = profile.business_type === 'company' ? 'company' : 'individual';
    const country = profile.country === 'España' || profile.country === 'Spain' ? 'ES' : 'ES'; // Default to ES for now if not clear

    const account = await stripeCreateAccount({
      type: "express",
      ...(userEmail ? { email: userEmail } : {}),
      country: country,
      business_type: businessType,
      "capabilities[card_payments][requested]": "true",
      "capabilities[transfers][requested]": "true",
      "metadata[supabase_user_id]": userId,
      // Pre-fill business info if available
      ...(profile.legal_name ? { "business_profile[name]": profile.legal_name } : {}),
    });

    const { error: updateError } = await serviceClient
      .from("profiles")
      .update({
        stripe_account_id: account.id,
        stripe_account_type: "express",
        stripe_onboarding_completed: false,
        stripe_details_submitted: false,
        stripe_charges_enabled: false,
        stripe_payouts_enabled: false,
      })
      .eq("id", userId);

    if (updateError) return jsonResponse({ ok: false, error: "Failed to store Stripe account" }, 500);

    return jsonResponse({ stripe_account_id: account.id });
  } catch (e) {
    const message = String((e as any)?.message || "Internal error");
    if (isConnectNotEnabledMessage(message)) {
      let platformId = "desconocido";
      try {
        const platform = await stripeGetPlatformAccount();
        platformId = platform?.id || platformId;
      } catch {}
      return jsonResponse({
        ok: false,
        error:
          "Stripe Connect no está habilitado en la cuenta plataforma (la de tu STRIPE_SECRET_KEY) o la key pertenece a otra cuenta. " +
          "Actívalo en Stripe Dashboard → Connect y asegúrate de copiar la STRIPE_SECRET_KEY de esa misma cuenta. " +
          `Cuenta plataforma detectada: ${platformId}. Error: ${message}`,
      });
    }
    return jsonResponse({ ok: false, error: message }, 500);
  }
});
