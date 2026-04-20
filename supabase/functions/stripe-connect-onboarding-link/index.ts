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
    "Content-Type": "application/x-www-form-urlencoded",
  };
}

function isAllowedReturnUrl(url: string) {
  const u = url.toLowerCase();
  return (
    u.startsWith("eclipse://") || 
    u.startsWith("partyapp://") || 
    u.startsWith("exp://") || 
    u.startsWith("http://localhost") ||
    u.includes(".supabase.co") ||
    u.startsWith("https://")
  );
}

async function stripeCreateAccountLink(params: Record<string, string>) {
  const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
  if (!STRIPE_SECRET_KEY) throw new Error("Missing STRIPE_SECRET_KEY");

  const res = await fetch("https://api.stripe.com/v1/account_links", {
    method: "POST",
    headers: stripeHeaders(STRIPE_SECRET_KEY),
    body: new URLSearchParams(params),
  });

  const data = await res.json();
  if (!res.ok) {
    const msg = (data as any)?.error?.message || "Failed to create onboarding link";
    throw new Error(msg);
  }
  return data as { url: string };
}

type Body = {
  return_url: string;
  refresh_url: string;
};

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

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return jsonResponse({ ok: false, error: "Invalid JSON" }, 400);
  }

  const returnUrl = (body?.return_url || "").trim();
  const refreshUrl = (body?.refresh_url || "").trim();
  if (!returnUrl || !refreshUrl) return jsonResponse({ ok: false, error: "Missing return_url/refresh_url" }, 400);
  if (!isAllowedReturnUrl(returnUrl) || !isAllowedReturnUrl(refreshUrl)) {
    return jsonResponse({ ok: false, error: "Invalid return_url/refresh_url" }, 400);
  }

  const userId = userData.user.id;
  const { data: profile, error: profileError } = await serviceClient
    .from("profiles")
    .select("role, stripe_account_id")
    .eq("id", userId)
    .maybeSingle();

  if (profileError) return jsonResponse({ ok: false, error: "Failed to load profile" }, 500);
  if (!profile?.stripe_account_id) return jsonResponse({ ok: false, error: "Stripe account not found" }, 404);
  if (profile.role !== "organizer") return jsonResponse({ ok: false, error: "Not an organizer" }, 403);

  const completeUrl = `https://api.weareeclipseoficial.com/stripe/complete?account=${profile.stripe_account_id}&next=${encodeURIComponent(returnUrl)}`;

  try {
    const link = await stripeCreateAccountLink({
      account: profile.stripe_account_id,
      refresh_url: completeUrl,
      return_url: completeUrl,
      type: "account_onboarding",
    });

    return jsonResponse({ url: link.url });
  } catch (e) {
    return jsonResponse({ ok: false, error: (e as any)?.message || "Internal error" }, 500);
  }
});
