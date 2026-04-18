import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

serve(async (req) => {
  try {
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) {
      return new Response(JSON.stringify({ ok: false, error: "Missing RESEND_API_KEY" }), {
        headers: { "Content-Type": "application/json" },
        status: 500,
      });
    }

    const { to, from, subject, html, attachments } = await req.json();

    const payload = {
      from,
      to,
      subject,
      html,
      attachments, // [{ filename, content (base64), contentType }]
    };

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    return new Response(JSON.stringify({ ok: res.ok, data }), {
      headers: { "Content-Type": "application/json" },
      status: res.status,
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      headers: { "Content-Type": "application/json" },
      status: 500,
    });
  }
});
