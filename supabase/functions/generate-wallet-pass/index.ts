import { resolveTicketProduct } from '../_shared/ticketProduct.ts';
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { SignJWT, importPKCS8 } from "https://esm.sh/jose@5.9.6";
import { WALLET_THEMES, walletTier, walletDate, WALLET_ART_BASE } from "../_shared/walletDesign.ts";
import { normalizeWalletPem } from "../_shared/walletPem.ts";

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
  if (req.method !== "POST") return jsonResponse({ ok: false, error: "Método no permitido" }, 405);

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
    if (platform !== "ios" && platform !== "android") {
      return jsonResponse({ ok: false, error: "Plataforma no válida" }, 400);
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
        entry_deadline,
        wallet_added,
        product_snapshot,
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

    const GOOGLE_WALLET_ISSUER_ID = Deno.env.get("GOOGLE_WALLET_ISSUER_ID")?.trim();
    const GOOGLE_WALLET_CLASS_ID = Deno.env.get("GOOGLE_WALLET_CLASS_ID")?.trim();
    const GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL = Deno.env.get("GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL")?.trim();
    const GOOGLE_WALLET_PRIVATE_KEY = Deno.env.get("GOOGLE_WALLET_PRIVATE_KEY");

    if (!GOOGLE_WALLET_ISSUER_ID || !GOOGLE_WALLET_CLASS_ID || !GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL || !GOOGLE_WALLET_PRIVATE_KEY) {
      return jsonResponse(
        {
          ok: false,
          platform: "android",
          error:
            "Google Wallet no está configurado (faltan GOOGLE_WALLET_ISSUER_ID / GOOGLE_WALLET_CLASS_ID / GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL / GOOGLE_WALLET_PRIVATE_KEY).",
        },
        503,
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
    const venueName    = String(ticket.events?.venues?.name || "Local por confirmar");
    const venueAddress = String((ticket.events?.venues as any)?.address || "").trim();
    const posterUrl    = String(ticket.events?.poster_url || "");
    const qrValue      = String(ticket.qr_token || ticket.qr_code || ticket.id);

    const eventDate  = eventDateIso ? new Date(eventDateIso) : null;
    const validDate  = eventDate && Number.isFinite(eventDate.getTime());

    // ── Ticket type / tier (mirrors Apple logic exactly) ──────────────────────
    const ticketTypeObj = Array.isArray((ticket as any).event_ticket_types)
      ? (ticket as any).event_ticket_types[0]
      : (ticket as any).event_ticket_types;
    const product = resolveTicketProduct(ticket);
    const rawCategory = product.category;

    const tier =
      rawCategory.includes("backstage") || rawCategory.includes("founder") ? "gold"
      : rawCategory.includes("vip") ? "vip"
      : "general";

    const ticketTypeName = product.name;
    const ticketNameLower = ticketTypeName.toLowerCase();
    const isFastlane  = ticketNameLower.includes("fast") || ticketNameLower.includes("lane") || ticketNameLower.includes("express");
    const isBackstage = tier === "gold" || ticketNameLower.includes("backstage");
    const isVipTier   = tier === "vip"  || ticketNameLower.includes("vip");
    const passVisualTier = product.visual;
    const theme = WALLET_THEMES[passVisualTier];
    const bgColor = theme.background;
    const tierBadge = theme.label;
    // ── Metadata ──────────────────────────────────────────────────────────────
    const ticketTypeMetadata = product.metadata;

    const holderName     = nonEmpty((ticket as any).buyer_name) || "Titular de la entrada";
    const gateDisplay    = nonEmpty(ticketTypeMetadata.gate);
    const sectionDisplay = nonEmpty(ticketTypeMetadata.section);
    const benefits       = nonEmpty(ticketTypeMetadata.benefits);
    const dedicatedLane  = ticketTypeMetadata.dedicatedLane === true ? "ACCESO PRIORITARIO" : null;
    const backstageHost  = nonEmpty(ticketTypeMetadata.backstageHost);
    const vipGroupSize   = parsePositiveNumber(ticketTypeMetadata.vipGroupSize) || (Number(ticket.quantity)>1 ? Number(ticket.quantity) : null);
    const bottleSummary  = Array.isArray(ticketTypeMetadata.vipBottles)
      ? ticketTypeMetadata.vipBottles.map((item: any) => {
          const label = nonEmpty(item?.brand) || nonEmpty(item?.label); const qty = parsePositiveNumber(item?.quantity);
          return label && qty ? `${label} x${qty}` : null;
        }).filter(Boolean).join(" • ") || null
      : null;

    const entryLeadMinutes = parsePositiveNumber(ticketTypeMetadata.earlyEntryMinutes) || 0;
    const entryDate = validDate ? new Date(eventDate!.getTime() - entryLeadMinutes * 60_000) : null;

    // ── Display strings ───────────────────────────────────────────────────────
    const eventYear     = validDate ? String(eventDate!.getFullYear()) : "2026";
    const passIdDisplay = `ECL-${eventYear}-${ticket.id.slice(0, 6).toUpperCase()}`;
    const timeDisplay = walletDate(eventDate, true);
    const entryDisplay = walletDate(entryDate, true);
    const shortDateDisplay = walletDate(eventDate);
    // ── Generic class (no review required, same as original working approach) ──
    const field = (id: string) => ({ firstValue: { fields: [{ fieldPath: `object.textModulesData['${id}']` }] } });
    const genericClass: any = { id: GOOGLE_WALLET_CLASS_ID, classTemplateInfo: {
      cardTemplateOverride: { cardRowTemplateInfos: [
        { twoItems: { startItem: field('date'), endItem: field('show') } },
        { twoItems: { startItem: field('holder'), endItem: field('access') } },
      ] },
    } };

    // ── Generic object with Apple-matching aesthetic ──────────────────────────
    const genericObject: any = {
      id: objectId,
      classId: GOOGLE_WALLET_CLASS_ID,
      state: "ACTIVE",
      hexBackgroundColor: bgColor,
      // Header: tier badge (right side, same as Apple)
      cardTitle: { defaultValue: { language: "es-ES", value: `ECLIPSE  ${tierBadge}` } },
      // Primary: preserve the event name and its original casing
      header: { defaultValue: { language: "es-ES", value: eventTitle } },
      // Subheader: venue
      subheader: { defaultValue: { language: "es-ES", value: venueName } },
      barcode: {
        type: "QR_CODE",
        value: qrValue,
        alternateText: passIdDisplay,
      },
      // Fields matching Apple's secondary + auxiliary layout
      textModulesData: [
        { id: "date",    header: "FECHA",         body: shortDateDisplay },
        { id: "show",    header: "INICIO",  body: timeDisplay },
        ...(sectionDisplay ? [{ id: "section", header: "ZONA", body: sectionDisplay }] : []),
        ...(gateDisplay ? [{ id: "gate", header: "PUERTA", body: gateDisplay }] : []),
        ...(ticket.entry_deadline ? [{id:"deadline",header:"ACCESO ANTES DE",body:`${walletDate(new Date(ticket.entry_deadline))} · ${walletDate(new Date(ticket.entry_deadline),true)}`}] : []),
        { id: "entry",   header: "HORA DE ACCESO",        body: entryDisplay },
        { id: "pass_id", header: "REFERENCIA",      body: passIdDisplay },
        { id: "holder",  header: "TITULAR", body: holderName },
        { id: "access",  header: "TIPO DE ENTRADA",  body: ticketTypeName.toUpperCase() },
        ...(venueAddress ? [{ id: "address", header: "DIRECCIÓN",       body: venueAddress }] : []),
        ...(dedicatedLane ? [{ id: "lane",   header: "ACCESO PRIORITARIO", body: dedicatedLane }] : []),
        ...(benefits ? [{ id: "benefits",    header: "INCLUYE",      body: benefits }] : []),
        ...(vipGroupSize ? [{ id: "group",   header: "GRUPO",    body: `${vipGroupSize} personas` }] : []),
        ...(bottleSummary ? [{ id: "bottles", header: "BOTELLAS", body: bottleSummary }] : []),
        ...(backstageHost ? [{ id: "host",   header: "ANFITRIÓN",     body: backstageHost }] : []),
        { id: "terms",   header: "INFORMACIÓN",
          body: "Presenta el QR en el acceso. Consulta las condiciones de tu compra en Eclipse. No compartas el código de tu entrada." },

      ],
    };

    genericObject.logo = {
      sourceUri: { uri: `${WALLET_ART_BASE}/google_logo.png` },
      contentDescription: { defaultValue: { language: "es-ES", value: "Eclipse" } },
    };
    genericObject.heroImage = {
      sourceUri: { uri: `${WALLET_ART_BASE}/google_${passVisualTier}.png` },
      contentDescription: { defaultValue: { language: "es-ES", value: `Eclipse · ${theme.label}` } },
    };
    const privateKeyPem = normalizeWalletPem(GOOGLE_WALLET_PRIVATE_KEY);
    const key = await importPKCS8(privateKeyPem, "RS256");
    const nowSeconds = Math.floor(Date.now() / 1000);
    // A Save JWT does not refresh an existing object. Patch only presentation
    // fields, after ticket ownership and validity have been checked above.
    if (ticket.wallet_added) {
      const assertion = await new SignJWT({scope:'https://www.googleapis.com/auth/wallet_object.issuer'})
        .setProtectedHeader({alg:'RS256'}).setIssuer(GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL)
        .setAudience('https://oauth2.googleapis.com/token').setIssuedAt(nowSeconds)
        .setExpirationTime(nowSeconds+300).sign(key);
      const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
        body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion}),
      });
      if (!tokenResponse.ok) return jsonResponse({ok:false,error:'Google Wallet no permite actualizar el pase en este momento.'},503);
      const {access_token} = await tokenResponse.json();
      if (!access_token) return jsonResponse({ok:false,error:'Google Wallet no ha autorizado la actualización.'},503);
      const {hexBackgroundColor,cardTitle,header,subheader,textModulesData,logo,heroImage} = genericObject;
      const updated = await fetch(`https://walletobjects.googleapis.com/walletobjects/v1/genericobject/${encodeURIComponent(objectId)}`, {
        method:'PATCH',headers:{Authorization:`Bearer ${access_token}`,'Content-Type':'application/json'},
        body:JSON.stringify({hexBackgroundColor,cardTitle,header,subheader,textModulesData,logo,heroImage}),
      });
      if (!updated.ok && updated.status!==404) return jsonResponse({ok:false,error:'Google Wallet no ha aceptado la actualización del pase. Revisa los permisos del emisor.'},503);
    }
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
