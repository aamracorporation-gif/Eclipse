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

async function callFunction(functionName: string, serviceKey: string, urlBase: string, body: any) {
  const url = `${urlBase.replace(/\/$/, "")}/functions/v1/${functionName}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body ?? {}),
  });
  const text = await res.text().catch(() => "");
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { ok: res.ok, status: res.status, json, text };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return jsonResponse({ ok: true });
  if (req.method !== "POST") return jsonResponse({ ok: false, error: "Method not allowed" }, 405);

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const { limit = 50, eventId = null, enqueueEventUpdate = false } = await req.json().catch(() => ({ limit: 50 }));

    const authHeader = req.headers.get("authorization") || req.headers.get("Authorization") || "";
    const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length).trim() : "";

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const isMissingColumnError = (err: any, column: string) =>
      String(err?.code || "") === "42703" || String(err?.message || "").includes(column);

    if (enqueueEventUpdate) {
      if (!jwt) return jsonResponse({ ok: false, error: "Missing Authorization" }, 401);
      if (!eventId) return jsonResponse({ ok: false, error: "Missing eventId" }, 400);

      const { data: userData, error: userErr } = await supabase.auth.getUser(jwt);
      if (userErr || !userData?.user?.id) return jsonResponse({ ok: false, error: "Unauthorized" }, 401);

      const callerId = userData.user.id;
      const { data: profile } = await supabase.from("profiles").select("role").eq("id", callerId).maybeSingle();

      const { data: eventRow, error: eventErr } = await supabase
        .from("events")
        .select("id, title, creator_id")
        .eq("id", eventId)
        .maybeSingle();
      if (eventErr || !eventRow?.id) return jsonResponse({ ok: false, error: "Event not found" }, 404);

      const role = String((profile as any)?.role || "");
      const isAdmin = role === "admin";
      const isOrganizer = role === "organizer";
      if (!isAdmin) {
        if (!isOrganizer || String((eventRow as any).creator_id || "") !== callerId) {
          return jsonResponse({ ok: false, error: "Forbidden" }, 403);
        }
      }

      const fetchTickets = async (withTicketStatus: boolean) => {
        let q = supabase
          .from("tickets")
          .select(withTicketStatus ? "user_id, buyer_email, status, ticket_status" : "user_id, buyer_email, status")
          .eq("event_id", eventId);

        if (withTicketStatus) {
          q = q.or("status.eq.valid,status.eq.active,ticket_status.eq.active");
        } else {
          q = q.or("status.eq.valid,status.eq.active");
        }
        return q;
      };

      let tickets: any[] | null = null;
      let ticketErr: any = null;
      {
        const res = await fetchTickets(true);
        tickets = (res as any).data as any;
        ticketErr = (res as any).error as any;
      }
      if (ticketErr && isMissingColumnError(ticketErr, "ticket_status")) {
        const res = await fetchTickets(false);
        tickets = (res as any).data as any;
        ticketErr = (res as any).error as any;
      }
      if (ticketErr) return jsonResponse({ ok: false, error: "Failed to load tickets", details: ticketErr }, 500);

      const userIds = new Set<string>();
      const emails: string[] = [];
      for (const t of (tickets as any[]) || []) {
        const uid = String(t?.user_id || "");
        const email = String(t?.buyer_email || "").trim();
        if (uid) userIds.add(uid);
        else if (email) emails.push(email);
      }

      if (emails.length) {
        const uniqueEmails = Array.from(new Set(emails.map((e) => e.toLowerCase())));
        for (let i = 0; i < uniqueEmails.length; i += 100) {
          const chunk = uniqueEmails.slice(i, i + 100);
          const { data: profiles } = await supabase.from("profiles").select("id, email").in("email", chunk);
          for (const p of (profiles as any[]) || []) {
            const pid = String(p?.id || "");
            if (pid) userIds.add(pid);
          }
        }
      }

      const title = String((eventRow as any).title || "").trim() || "Evento";
      const rows = Array.from(userIds).map((uid) => ({
        user_id: uid,
        role: "attendee",
        type: "event_updated",
        title: "🔁 Cambios en el evento",
        body: `Hubo cambios en "${title}". Revisa los nuevos detalles antes de ir.`,
        priority: "high",
        status: "pending",
        data: { event_id: String(eventId), event_title: title, url: `event/${String(eventId)}`, event_url: `event/${String(eventId)}` },
        channels: ["in_app", "push"],
      }));

      let insertedCount = 0;
      if (rows.length) {
        const { error: insErr } = await supabase.from("notifications").insert(rows);
        if (insErr) {
          const fallback = rows.map((r) => ({
            user_id: r.user_id,
            role: r.role,
            type: r.type,
            message: r.body,
          }));
          const fb = await supabase.from("notifications").insert(fallback);
          if (!fb.error) insertedCount = fallback.length;
        } else {
          insertedCount = rows.length;
        }
      }

      const pushNow = await callFunction("send-push", SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL, { limit: Math.max(200, limit) });

      const canEmail = Boolean(Deno.env.get("RESEND_API_KEY")) && Boolean(Deno.env.get("NOTIFICATIONS_FROM_EMAIL"));
      const emailNow = canEmail
        ? await callFunction("send-email-notifications", SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL, { limit: Math.max(200, limit) })
        : { ok: true, status: 204, json: { skipped: true, reason: "email_not_configured" }, text: "" };

      const canSms =
        Boolean(Deno.env.get("TWILIO_ACCOUNT_SID")) &&
        Boolean(Deno.env.get("TWILIO_AUTH_TOKEN")) &&
        Boolean(Deno.env.get("TWILIO_FROM_NUMBER"));
      const smsNow = canSms
        ? await callFunction("send-sms-notifications", SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL, { limit: Math.max(200, limit) })
        : { ok: true, status: 204, json: { skipped: true, reason: "sms_not_configured" }, text: "" };

      return jsonResponse({
        ok: true,
        enqueued_event_update: {
          event_id: eventId,
          buyers_found: userIds.size,
          notifications_inserted: insertedCount,
        },
        push: { ok: pushNow.ok, status: pushNow.status, result: pushNow.json ?? pushNow.text },
        email: { ok: emailNow.ok, status: emailNow.status, result: emailNow.json ?? emailNow.text },
        sms: { ok: smsNow.ok, status: smsNow.status, result: smsNow.json ?? smsNow.text },
      });
    }

    const push = await callFunction("send-push", SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL, { limit });

    const canEmail = Boolean(Deno.env.get("RESEND_API_KEY")) && Boolean(Deno.env.get("NOTIFICATIONS_FROM_EMAIL"));
    const email = canEmail
      ? await callFunction("send-email-notifications", SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL, { limit })
      : { ok: true, status: 204, json: { skipped: true, reason: "email_not_configured" }, text: "" };

    const canSms =
      Boolean(Deno.env.get("TWILIO_ACCOUNT_SID")) &&
      Boolean(Deno.env.get("TWILIO_AUTH_TOKEN")) &&
      Boolean(Deno.env.get("TWILIO_FROM_NUMBER"));
    const sms = canSms
      ? await callFunction("send-sms-notifications", SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL, { limit })
      : { ok: true, status: 204, json: { skipped: true, reason: "sms_not_configured" }, text: "" };

    return jsonResponse({
      ok: true,
      enqueued_event_update: null,
      push: { ok: push.ok, status: push.status, result: push.json ?? push.text },
      email: { ok: email.ok, status: email.status, result: email.json ?? email.text },
      sms: { ok: sms.ok, status: sms.status, result: sms.json ?? sms.text },
    });
  } catch (e: any) {
    return jsonResponse({ ok: false, error: String(e?.message || e) }, 500);
  }
});
