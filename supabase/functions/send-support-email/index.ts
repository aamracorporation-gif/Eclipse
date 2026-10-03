import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

const escapeHtml = (value: unknown) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
    const resendKey = Deno.env.get("RESEND_API_KEY") || "";
    const fromEmail = Deno.env.get("NOTIFICATIONS_FROM_EMAIL") || "onboarding@resend.dev";
    const authHeader = req.headers.get("Authorization") || "";
    if (!supabaseUrl || !anonKey || !resendKey) return json({ ok: false, error: "Service unavailable" }, 503);
    if (!authHeader.startsWith("Bearer ")) return json({ ok: false, error: "Unauthorized" }, 401);

    const client = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const { data: authData, error: authError } = await client.auth.getUser();
    if (authError || !authData.user) return json({ ok: false, error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const message = String(body?.message || "").trim();
    const category = String(body?.category || "Problema técnico").trim().slice(0, 80);
    if (message.length < 5 || message.length > 4000) {
      return json({ ok: false, error: "Message must contain between 5 and 4000 characters" }, 400);
    }

    const user = authData.user;
    const userName = String(user.user_metadata?.full_name || user.user_metadata?.club_name || "Usuario").slice(0, 120);
    const userEmail = String(user.email || "").slice(0, 320);
    const html = `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#111;color:#fff;padding:28px;border-radius:12px">
        <h1 style="font-size:22px">Nuevo mensaje de soporte</h1>
        <p><strong>Categoría:</strong> ${escapeHtml(category)}</p>
        <p><strong>Usuario:</strong> ${escapeHtml(userName)}</p>
        <p><strong>Email:</strong> ${escapeHtml(userEmail)}</p>
        <p><strong>ID:</strong> ${escapeHtml(user.id)}</p>
        <div style="white-space:pre-wrap">${escapeHtml(message)}</div>
      </div>`;

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: fromEmail,
        to: ["soporte@weareeclipseoficial.com"],
        reply_to: userEmail || undefined,
        subject: `[Eclipse Soporte] ${category}`,
        html,
      }),
    });

    if (!response.ok) {
      console.error("[send-support-email] provider rejected request", response.status);
      return json({ ok: false, error: "Email provider rejected the request" }, 502);
    }
    return json({ ok: true });
  } catch (error) {
    console.error("[send-support-email] request failed", error instanceof Error ? error.message : "unknown");
    return json({ ok: false, error: "Unable to send support request" }, 500);
  }
});
