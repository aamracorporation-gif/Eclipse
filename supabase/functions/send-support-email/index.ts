import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    const FROM_EMAIL = Deno.env.get("NOTIFICATIONS_FROM_EMAIL") || "onboarding@resend.dev";

    console.log("[send-support-email] RESEND_API_KEY present:", !!RESEND_API_KEY);
    console.log("[send-support-email] FROM_EMAIL:", FROM_EMAIL);

    if (!RESEND_API_KEY) {
      return json({ ok: false, error: "Missing RESEND_API_KEY" });
    }

    const body = await req.json();
    const { userName, userEmail, userId, category, message } = body;

    console.log("[send-support-email] Sending from:", FROM_EMAIL, "to: soporte@weareeclipseoficial.com");

    if (!message?.trim()) {
      return json({ ok: false, error: "Empty message" });
    }

    const html = `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#0a0a1a;color:#fff;border-radius:12px;overflow:hidden;">
        <div style="background:linear-gradient(135deg,#0ea5e9,#6366f1);padding:24px 28px;">
          <h1 style="margin:0;font-size:22px;font-weight:800;">Nuevo mensaje de soporte</h1>
          <p style="margin:6px 0 0;opacity:0.85;font-size:14px;">Eclipse App</p>
        </div>
        <div style="padding:28px;background:#111;">
          <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
            <tr><td style="padding:8px 0;color:#aaa;font-size:13px;width:140px;">Categoría</td><td style="padding:8px 0;font-weight:700;color:#0ea5e9;">${category}</td></tr>
            <tr><td style="padding:8px 0;color:#aaa;font-size:13px;">Usuario</td><td style="padding:8px 0;color:#fff;">${userName}</td></tr>
            <tr><td style="padding:8px 0;color:#aaa;font-size:13px;">Email</td><td style="padding:8px 0;"><a href="mailto:${userEmail}" style="color:#0ea5e9;">${userEmail}</a></td></tr>
            <tr><td style="padding:8px 0;color:#aaa;font-size:13px;">ID</td><td style="padding:8px 0;font-family:monospace;font-size:12px;color:#666;">${userId}</td></tr>
          </table>
          <div style="background:#1a1a2e;border-left:3px solid #0ea5e9;border-radius:8px;padding:16px 20px;">
            <p style="margin:0;font-size:15px;line-height:1.7;color:#fff;white-space:pre-wrap;">${message.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>
          </div>
          <p style="margin-top:24px;font-size:12px;color:#555;">
            Responde a este email para contactar directamente con ${userName} (${userEmail}).
          </p>
        </div>
      </div>
    `;

    const resendPayload = {
      from: FROM_EMAIL,
      to: ["soporte@weareeclipseoficial.com"],
      reply_to: userEmail,
      subject: `[Eclipse Soporte] ${category} — ${userName}`,
      html,
    };

    console.log("[send-support-email] Resend payload from:", resendPayload.from);

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(resendPayload),
    });

    const data = await res.json();
    console.log("[send-support-email] Resend status:", res.status, "response:", JSON.stringify(data));

    // Always return 200 so the client gets the body (not a FunctionsHttpError)
    return json({ ok: res.ok, resendStatus: res.status, data });

  } catch (e) {
    console.error("[send-support-email] Unexpected error:", e);
    return json({ ok: false, error: String(e) });
  }
});
