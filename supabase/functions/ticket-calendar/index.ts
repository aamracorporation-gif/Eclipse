import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

function toUtcIcs(dt: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    dt.getUTCFullYear() +
    pad(dt.getUTCMonth() + 1) +
    pad(dt.getUTCDate()) +
    "T" +
    pad(dt.getUTCHours()) +
    pad(dt.getUTCMinutes()) +
    pad(dt.getUTCSeconds()) +
    "Z"
  );
}

function escapeIcs(text: string) {
  return String(text || "")
    .replaceAll("\\", "\\\\")
    .replaceAll("\r\n", "\\n")
    .replaceAll("\n", "\\n")
    .replaceAll("\r", "\\n")
    .replaceAll(",", "\\,")
    .replaceAll(";", "\\;");
}

serve(async (req) => {
  try {
    const url = new URL(req.url);
    const ticketId = (url.searchParams.get("ticket_id") || "").trim();
    const token = (url.searchParams.get("token") || "").trim();
    if (!ticketId || !token) {
      return new Response("Missing ticket_id or token", { status: 400 });
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: ticket, error: tErr } = await supabase
      .from("tickets")
      .select("id, event_id, qr_token")
      .eq("id", ticketId)
      .maybeSingle();
    if (tErr || !ticket) return new Response("Ticket not found", { status: 404 });

    const qrToken = String((ticket as any).qr_token || "");
    if (!qrToken || qrToken !== token) return new Response("Invalid token", { status: 403 });

    const eventId = String((ticket as any).event_id || "");
    const { data: eventRow, error: eErr } = await supabase
      .from("events")
      .select("id, title, description, event_date, venue_id")
      .eq("id", eventId)
      .maybeSingle();
    if (eErr || !eventRow) return new Response("Event not found", { status: 404 });

    const venueId = String((eventRow as any).venue_id || "");
    let venueName = "";
    let venueAddress = "";
    if (venueId) {
      const { data: venue } = await supabase
        .from("venues")
        .select("name, address")
        .eq("id", venueId)
        .maybeSingle();
      venueName = String((venue as any)?.name || "");
      venueAddress = String((venue as any)?.address || "");
    }

    const title = String((eventRow as any).title || "Evento");
    const description = String((eventRow as any).description || "");
    const eventDateRaw = String((eventRow as any).event_date || "");
    const start = new Date(eventDateRaw);
    if (Number.isNaN(start.getTime())) return new Response("Invalid event_date", { status: 400 });
    const end = new Date(start.getTime() + 4 * 60 * 60 * 1000);

    const uid = `${ticketId}@eclipse`;
    const dtstamp = toUtcIcs(new Date());
    const dtstart = toUtcIcs(start);
    const dtend = toUtcIcs(end);
    const location = [venueName, venueAddress].filter(Boolean).join(" - ");

    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Eclipse//Tickets//ES",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "BEGIN:VEVENT",
      `UID:${escapeIcs(uid)}`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART:${dtstart}`,
      `DTEND:${dtend}`,
      `SUMMARY:${escapeIcs(title)}`,
      `LOCATION:${escapeIcs(location)}`,
      `DESCRIPTION:${escapeIcs(description)}`,
      "END:VEVENT",
      "END:VCALENDAR",
      "",
    ].join("\r\n");

    const filenameSafe = `eclipse-${ticketId}.ics`;
    return new Response(ics, {
      status: 200,
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filenameSafe}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return new Response(String((e as any)?.message || e), { status: 500 });
  }
});

