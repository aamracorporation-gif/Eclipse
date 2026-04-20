import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") || "";

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ ok: false, error: "Missing Supabase environment variables." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader) {
    return new Response(JSON.stringify({ ok: false, error: "Missing Authorization header." }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData?.user?.id) {
    return new Response(JSON.stringify({ ok: false, error: "Invalid session." }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const userId = userData.user.id;
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("stripe_account_id")
    .eq("id", userId)
    .maybeSingle();

  if (profileError) {
    return new Response(JSON.stringify({ ok: false, error: profileError.message || "Failed to load user profile." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const stripeAccountId = String(profile?.stripe_account_id || "").trim();
  if (stripeAccountId) {
    if (!STRIPE_SECRET_KEY) {
      return new Response(JSON.stringify({ ok: false, error: "Missing STRIPE_SECRET_KEY." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const stripeRes = await fetch(`https://api.stripe.com/v1/accounts/${encodeURIComponent(stripeAccountId)}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
      },
    });

    const stripeText = await stripeRes.text().catch(() => "");
    if (!stripeRes.ok) {
      let stripeMsg = stripeText || `Stripe HTTP ${stripeRes.status}`;
      try {
        const parsed = stripeText ? JSON.parse(stripeText) : null;
        stripeMsg = String(parsed?.error?.message || stripeMsg);
      } catch {}
      return new Response(JSON.stringify({ ok: false, error: `Failed to delete Stripe Connect account: ${stripeMsg}` }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  const { error: purgeError } = await admin.rpc("admin_purge_user_data", { p_user_id: userId });
  if (purgeError) {
    return new Response(JSON.stringify({ ok: false, error: purgeError.message || "Failed to purge user data." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
  if (deleteError) {
    return new Response(JSON.stringify({ ok: false, error: deleteError.message || "Failed to delete user." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
