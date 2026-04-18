import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return jsonResponse({ ok: true });

  const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!STRIPE_SECRET_KEY || !SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    return jsonResponse({ error: "Missing environment variables" }, 500);
  }

  const authHeader = req.headers.get("Authorization") || "";
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return jsonResponse({ error: "Unauthorized" }, 401);

  const { data: profile, error: profileError } = await serviceClient
    .from("profiles")
    .select("stripe_account_id, role")
    .eq("id", user.id)
    .single();

  if (profileError || !profile) return jsonResponse({ error: "Profile not found" }, 404);
  if (profile.role !== "organizer") return jsonResponse({ error: "Not an organizer" }, 403);
  if (!profile.stripe_account_id) return jsonResponse({ error: "No Stripe account linked" }, 400);

  try {
    // 1. Get Balance
    const balanceRes = await fetch(`https://api.stripe.com/v1/balance`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
        "Stripe-Account": profile.stripe_account_id,
      },
    });
    const balance = await balanceRes.json();

    // 2. Get Charges (last 30 days)
    const thirtyDaysAgo = Math.floor(Date.now() / 1000) - (30 * 24 * 60 * 60);
    const chargesRes = await fetch(`https://api.stripe.com/v1/charges?created[gte]=${thirtyDaysAgo}&limit=100`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
        "Stripe-Account": profile.stripe_account_id,
      },
    });
    const charges = await chargesRes.json();

    // Calculate real revenue from charges
    const revenueCents = charges.data?.reduce((acc: number, c: any) => {
      if (c.status === 'succeeded' && !c.refunded) return acc + c.amount;
      return acc;
    }, 0) || 0;

    return jsonResponse({
      available_balance: balance.available?.[0]?.amount || 0,
      pending_balance: balance.pending?.[0]?.amount || 0,
      revenue_30d: revenueCents,
      currency: balance.available?.[0]?.currency || 'eur',
      charges_count: charges.data?.length || 0,
    });
  } catch (e) {
    return jsonResponse({ error: e.message }, 500);
  }
});
