import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { SignJWT, importPKCS8 } from "https://esm.sh/jose@5.9.6";

async function getServiceAccountToken(saEmail: string, privateKeyPem: string): Promise<string> {
  const key = await importPKCS8(privateKeyPem, "RS256");
  const now = Math.floor(Date.now() / 1000);
  const jwt = await new SignJWT({
    scope: "https://www.googleapis.com/auth/wallet_object.issuer",
  })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(saEmail)
    .setSubject(saEmail)
    .setAudience("https://oauth2.googleapis.com/token")
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(key);

  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });
  const data = await resp.json();
  if (!data.access_token) throw new Error("Token error: " + JSON.stringify(data));
  return data.access_token;
}

function jsonResponse(body: any, status = 200) {
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
  // Manejo de CORS
  if (req.method === "OPTIONS") return jsonResponse({ ok: true });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("Variables de entorno Supabase no configuradas.");
    }

    // 1. Obtener datos del body con seguridad
    let body;
    try {
      body = await req.json();
    } catch (e) {
      return jsonResponse({ ok: false, error: "JSON malformado en la petición" }, 400);
    }

    const { ticket_id, platform } = body;
    if (!ticket_id || !platform) {
      return jsonResponse({ ok: false, error: "Falta ticket_id o platform en el body" }, 400);
    }

    // 2. Verificar Autenticación del usuario
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse({ ok: false, error: "No se proporcionó token de autorización" }, 401);
    }

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return jsonResponse({ ok: false, error: "Usuario no autorizado o sesión caducada" }, 401);
    }

    // 3. Consultar ticket con Service Role (para saltar RLS si es necesario)
    const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    
    const { data: ticket, error: ticketError } = await serviceClient
      .from("tickets")
      .select(`
        id,
        user_id,
        status,
        ticket_status,
        qr_token,
        qr_code,
        buyer_name,
        ticket_type,
        ticket_type_id,
        event_ticket_types (
          id,
          name,
          category,
          metadata
        ),
        events (
          id,
          title,
          event_date,
          poster_url,
          venues (name, address, latitude, longitude)
        )
      `)
      .eq("id", ticket_id)
      .maybeSingle();

    if (ticketError) {
      console.error("[WALLET] Error DB:", ticketError);
      return jsonResponse({ ok: false, error: "Error al consultar la entrada en la base de datos" }, 500);
    }

    if (!ticket) {
      return jsonResponse({ ok: false, error: "La entrada no existe" }, 404);
    }

    // 4. Verificar propiedad
    if (ticket.user_id !== user.id) {
      return jsonResponse({ ok: false, error: "No tienes permiso para gestionar esta entrada" }, 403);
    }

    if (platform === "ios") {
      return jsonResponse(
        {
          ok: false,
          platform: "ios",
          error: 'Usa la función "apple-wallet-generator" para generar el .pkpass en iOS.',
        },
        400,
      );
    }

    const GOOGLE_WALLET_ISSUER_ID = Deno.env.get("GOOGLE_WALLET_ISSUER_ID");
    const GOOGLE_WALLET_CLASS_ID = Deno.env.get("GOOGLE_WALLET_CLASS_ID");
    const GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL = Deno.env.get("GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL");
    const GOOGLE_WALLET_PRIVATE_KEY = Deno.env.get("GOOGLE_WALLET_PRIVATE_KEY");

    if (!GOOGLE_WALLET_ISSUER_ID || !GOOGLE_WALLET_CLASS_ID || !GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL || !GOOGLE_WALLET_PRIVATE_KEY) {
      return jsonResponse(
        {
          ok: false,
          platform: "android",
          error:
            "Google Wallet no está configurado (faltan GOOGLE_WALLET_ISSUER_ID / GOOGLE_WALLET_CLASS_ID / GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL / GOOGLE_WALLET_PRIVATE_KEY).",
        },
        500,
      );
    }

    // ── Helpers ───────────────────────────────────────────────────────────────
    const nonEmpty = (v: unknown) => { const s = String(v ?? "").trim(); return s || null; };
    const parsePositiveNumber = (v: unknown) => {
      const n = Number(String(v ?? "").trim());
      return Number.isFinite(n) && n > 0 ? n : null;
    };

    // ── IDs ───────────────────────────────────────────────────────────────────
    const objectId = `${GOOGLE_WALLET_ISSUER_ID}.${ticket.id}`;

    // ── Raw event data ────────────────────────────────────────────────────────
    const eventTitle   = String(ticket.events?.title || "ECLIPSE");
    const eventDateIso = String(ticket.events?.event_date || "");
    const venueName    = String(ticket.events?.venues?.name || "Venue to be announced");
    const venueAddress = String((ticket.events?.venues as any)?.address || "").trim();
    const posterUrl    = String(ticket.events?.poster_url || "");
    const qrValue      = String(ticket.qr_token || ticket.qr_code || ticket.id);

    const eventDate  = eventDateIso ? new Date(eventDateIso) : null;
    const validDate  = eventDate && Number.isFinite(eventDate.getTime());

    // ── Ticket type / tier (mirrors Apple logic exactly) ──────────────────────
    const ticketTypeObj = Array.isArray((ticket as any).event_ticket_types)
      ? (ticket as any).event_ticket_types[0]
      : (ticket as any).event_ticket_types;
    const rawCategory = String(
      ticketTypeObj?.category || (ticket as any).ticket_type || ticketTypeObj?.name || ""
    ).trim().toLowerCase();

    const tier =
      rawCategory.includes("backstage") || rawCategory.includes("founder") ? "gold"
      : rawCategory.includes("vip") ? "vip"
      : "general";

    const ticketTypeName = nonEmpty(ticketTypeObj?.name) || (tier === "gold" ? "FOUNDERS ACCESS" : tier === "vip" ? "VIP ACCESS" : "GENERAL ACCESS");
    const ticketNameLower = ticketTypeName.toLowerCase();
    const isFastlane  = ticketNameLower.includes("fast") || ticketNameLower.includes("lane") || ticketNameLower.includes("express");
    const isBackstage = tier === "gold" || ticketNameLower.includes("backstage");
    const isVipTier   = tier === "vip"  || ticketNameLower.includes("vip");
    const passVisualTier = isFastlane ? "fastlane" : isBackstage ? "backstage" : isVipTier ? "vip" : "general";

    // ── Palette (same as Apple) ───────────────────────────────────────────────
    const bgColor =
      passVisualTier === "fastlane"  ? "#000004" :
      passVisualTier === "backstage" ? "#050200" :
      passVisualTier === "vip"       ? "#080500" :
                                       "#000510";

    // ── Tier badge (same as Apple) ────────────────────────────────────────────
    const tierBadge =
      passVisualTier === "fastlane"  ? "⚡ FASTLANE"  :
      passVisualTier === "backstage" ? "✦ BACKSTAGE" :
      passVisualTier === "vip"       ? "★ VIP"       :
                                       "◇ GENERAL";

    // ── Metadata ──────────────────────────────────────────────────────────────
    const ticketTypeMetadata =
      ticketTypeObj?.metadata && typeof ticketTypeObj.metadata === "object"
        ? ticketTypeObj.metadata as Record<string, unknown> : {};

    const holderName     = nonEmpty((ticket as any).buyer_name) || "ECLIPSE MEMBER";
    const gateDisplay    = nonEmpty(ticketTypeMetadata.gate) || (isVipTier || isBackstage ? "VIP" : "MAIN");
    const sectionDisplay = nonEmpty(ticketTypeMetadata.section) || (tier === "gold" ? "BACKSTAGE" : tier === "vip" ? "VIP FLOOR" : "FLOOR");
    const benefits       = nonEmpty(ticketTypeMetadata.benefits);
    const dedicatedLane  = ticketTypeMetadata.dedicatedLane === true ? "PRIORITY LANE" : (isVipTier || isBackstage ? "VIP PRIORITY" : null);
    const backstageHost  = nonEmpty(ticketTypeMetadata.backstageHost);
    const vipGroupSize   = parsePositiveNumber(ticketTypeMetadata.vipGroupSize);
    const bottleSummary  = Array.isArray(ticketTypeMetadata.vipBottles)
      ? ticketTypeMetadata.vipBottles.map((item: any) => {
          const label = nonEmpty(item?.label); const qty = parsePositiveNumber(item?.quantity);
          return label && qty ? `${label} x${qty}` : null;
        }).filter(Boolean).join(" • ") || null
      : null;

    const entryLeadMinutes = parsePositiveNumber(ticketTypeMetadata.earlyEntryMinutes) || (tier === "gold" ? 60 : tier === "vip" ? 45 : 30);
    const entryDate = validDate ? new Date(eventDate!.getTime() - entryLeadMinutes * 60_000) : null;

    // ── Display strings ───────────────────────────────────────────────────────
    const eventYear     = validDate ? String(eventDate!.getFullYear()) : "2026";
    const passIdDisplay = `ECL-${eventYear}-${ticket.id.slice(0, 6).toUpperCase()}`;
    const timeDisplay   = validDate ? eventDate!.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "TBA";
    const entryDisplay  = entryDate && Number.isFinite(entryDate.getTime())
      ? entryDate.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "TBA";
    const shortDateDisplay = validDate ? (() => {
      const day = eventDate!.toLocaleDateString("en-GB", { weekday: "short" }).toUpperCase();
      const num = String(eventDate!.getDate()).padStart(2, "0");
      const mon = eventDate!.toLocaleDateString("en-GB", { month: "short" }).toUpperCase();
      return `${day} ${num} ${mon}`;
    })() : "TBA";
    const fullDateDisplay = validDate
      ? eventDate!.toLocaleString("es-ES", { year: "numeric", month: "long", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";

    // ── Generic class (no review required, same as original working approach) ──
    const genericClass: any = { id: GOOGLE_WALLET_CLASS_ID };

    // ── Generic object with Apple-matching aesthetic ──────────────────────────
    const genericObject: any = {
      id: objectId,
      classId: GOOGLE_WALLET_CLASS_ID,
      state: "ACTIVE",
      hexBackgroundColor: bgColor,
      // Header: tier badge (right side, same as Apple)
      cardTitle: { defaultValue: { language: "es-ES", value: `ECLIPSE  ${tierBadge}` } },
      // Primary: event name uppercase
      header: { defaultValue: { language: "es-ES", value: eventTitle.toUpperCase() } },
      // Subheader: venue
      subheader: { defaultValue: { language: "es-ES", value: venueName } },
      barcode: {
        type: "QR_CODE",
        value: qrValue,
        alternateText: passIdDisplay,
      },
      // Fields matching Apple's secondary + auxiliary layout
      textModulesData: [
        { id: "date",    header: "DATE",         body: shortDateDisplay },
        { id: "show",    header: "SHOW STARTS",  body: timeDisplay },
        { id: "section", header: "SECTION",      body: sectionDisplay },
        { id: "gate",    header: "GATE",         body: gateDisplay },
        { id: "entry",   header: "ENTRY",        body: entryDisplay },
        { id: "pass_id", header: "PASS ID",      body: passIdDisplay },
        { id: "holder",  header: "TICKET HOLDER", body: holderName.toUpperCase() },
        { id: "access",  header: "ACCESS TYPE",  body: ticketTypeName.toUpperCase() },
        ...(venueAddress ? [{ id: "address", header: "ADDRESS",       body: venueAddress }] : []),
        ...(dedicatedLane ? [{ id: "lane",   header: "PRIORITY LANE", body: dedicatedLane }] : []),
        ...(benefits ? [{ id: "benefits",    header: "INCLUDED",      body: benefits }] : []),
        ...(vipGroupSize ? [{ id: "group",   header: "GROUP SIZE",    body: `${vipGroupSize} guests` }] : []),
        ...(bottleSummary ? [{ id: "bottles", header: "TABLE SERVICE", body: bottleSummary }] : []),
        ...(backstageHost ? [{ id: "host",   header: "YOUR HOST",     body: backstageHost }] : []),
        { id: "terms",   header: "TERMS",
          body: "Non-transferable. Valid only for the date, venue and access tier shown. ECLIPSE reserves the right to refuse admission." },
        { id: "support", header: "SUPPORT", body: "help@eclipse.app" },
      ],
    };

    // Hero image: event poster
    if (posterUrl) {
      genericObject.heroImage = {
        sourceUri: { uri: posterUrl },
        contentDescription: { defaultValue: { language: "es-ES", value: eventTitle } },
      };
    }

    const privateKeyPem = GOOGLE_WALLET_PRIVATE_KEY.replace(/\\n/g, "\n");
    const key = await importPKCS8(privateKeyPem, "RS256");
    const nowSeconds = Math.floor(Date.now() / 1000);
    const jwt = await new SignJWT({
      typ: "savetowallet",
      iat: nowSeconds,
      payload: { genericClasses: [genericClass], genericObjects: [genericObject] },
    })
      .setProtectedHeader({ alg: "RS256" })
      .setIssuer(GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL)
      .setAudience("google")
      .sign(key);

    const url = `https://pay.google.com/gp/v/save/${jwt}`;
    return jsonResponse({ ok: true, platform: "android", url, objectId });

  } catch (err) {
    console.error("[WALLET] Fatal Error:", err.message);
    return jsonResponse({ 
      ok: false, 
      error: "Error interno del servidor",
      details: err.message 
    }, 500);
  }
});
