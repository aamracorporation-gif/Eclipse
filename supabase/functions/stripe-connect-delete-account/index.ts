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
  const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");

  if (!STRIPE_SECRET_KEY) return jsonResponse({ ok: false, error: "Stripe not configured" }, 500);

  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization") || "";
  const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length).trim() : "";
  if (!jwt) return jsonResponse({ ok: false, error: "Unauthorized" }, 401);

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: userData, error: userErr } = await supabase.auth.getUser(jwt);
    if (userErr || !userData?.user?.id) return jsonResponse({ ok: false, error: "Unauthorized" }, 401);
    const userId = userData.user.id;

    // Get the Stripe account ID from the user's profile
    const { data: profile, error: profileErr } = await supabase
      .from("profiles")
      .select("stripe_account_id, role")
      .eq("id", userId)
      .maybeSingle();

    if (profileErr || !profile) return jsonResponse({ ok: false, error: "Profile not found" }, 404);
    if (!profile.stripe_account_id) return jsonResponse({ ok: false, error: "No Stripe account linked" }, 400);

    const stripeAccountId = String(profile.stripe_account_id);

    // Delete the Stripe Connect account
    const stripeRes = await fetch(`https://api.stripe.com/v1/accounts/${stripeAccountId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` },
    });

    const stripeData = await stripeRes.json().catch(() => null);

    // Stripe returns { deleted: true } on success, or error 404 if already deleted
    const deleted = stripeRes.ok || stripeRes.status === 404;
    if (!deleted) {
      const msg = (stripeData as any)?.error?.message || "Stripe deletion failed";
      return jsonResponse({ ok: false, error: msg }, 500);
    }

    // Clear Stripe fields from the profile
    await supabase.from("profiles").update({
      stripe_account_id: null,
      stripe_onboarding_completed: false,
      stripe_details_submitted: false,
      stripe_charges_enabled: false,
      stripe_payouts_enabled: false,
    }).eq("id", userId);

    return jsonResponse({ ok: true, deleted: stripeAccountId });
  } catch (e: any) {
    return jsonResponse({ ok: false, error: String(e?.message || e || "Unknown error") }, 500);
  }
});
