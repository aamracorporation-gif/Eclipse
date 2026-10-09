import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

type Json = Record<string, unknown>;

function jsonResponse(body: Json, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function stripeHeaders(secretKey: string) {
  return {
    Authorization: `Bearer ${secretKey}`,
  };
}

async function stripeGetAccount(accountId: string) {
  const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
  if (!STRIPE_SECRET_KEY) throw new Error("Missing STRIPE_SECRET_KEY");

  const res = await fetch(`https://api.stripe.com/v1/accounts/${accountId}`, {
    method: "GET",
    headers: stripeHeaders(STRIPE_SECRET_KEY),
  });

  const data = await res.json();
  if (!res.ok) {
    const msg = (data as any)?.error?.message || "Failed to fetch Stripe account";
    throw new Error(msg);
  }
  return data as {
    id: string;
    details_submitted: boolean;
    charges_enabled: boolean;
    payouts_enabled: boolean;
  };
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
  const { data: profile, error: profileError } = await serviceClient
    .from("profiles")
    .select("role, stripe_account_id, stripe_onboarding_completed")
    .eq("id", userId)
    .maybeSingle();

  if (profileError) return jsonResponse({ ok: false, error: "Failed to load profile" }, 500);
  if (!profile?.stripe_account_id) return jsonResponse({ ok: false, error: "Stripe account not found" }, 404);
  if (profile.role !== "organizer") return jsonResponse({ ok: false, error: "Not an organizer" }, 403);

  try {
    const acct = await stripeGetAccount(profile.stripe_account_id);
    
    // Si charges_enabled es true, el organizador ya puede recibir pagos y por tanto el onboarding está OK
    const onboardingCompleted = !!acct.charges_enabled;
    const justCompleted = onboardingCompleted && !profile.stripe_onboarding_completed;

    const { error: updateError } = await serviceClient
      .from("profiles")
      .update({
        stripe_details_submitted: !!acct.details_submitted,
        stripe_charges_enabled: !!acct.charges_enabled,
        stripe_payouts_enabled: !!acct.payouts_enabled,
        stripe_onboarding_completed: onboardingCompleted,
        ...(justCompleted ? { stripe_onboarding_completed_at: new Date().toISOString() } : {}),
      })
      .eq("id", userId);

    if (updateError) return jsonResponse({ ok: false, error: "Failed to update Stripe status" }, 500);

    return jsonResponse({
      stripe_account_id: acct.id,
      stripe_details_submitted: !!acct.details_submitted,
      stripe_charges_enabled: !!acct.charges_enabled,
      stripe_payouts_enabled: !!acct.payouts_enabled,
      stripe_onboarding_completed: onboardingCompleted,
    });
  } catch (e) {
    return jsonResponse({ ok: false, error: (e as any)?.message || "Internal error" }, 500);
  }
});
