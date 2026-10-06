import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { PKPass } from "https://esm.sh/passkit-generator@3.1.10";
import forge from "https://esm.sh/node-forge@1.4.0";
import { Buffer } from "node:buffer";
import { WALLET_THEMES, walletTier, walletDate, walletRgb } from "../_shared/walletDesign.ts";
import { normalizeWalletPem } from "../_shared/walletPem.ts";
import { WALLET_ASSETS } from "./bundledAssets.ts";

// Headers CORS requeridos para Expo/React Native
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * REESCRITURA TOTAL: APPLE WALLET GENERATOR
 * Genera el pase y valida de forma estricta certificados, propiedad y contenido.
 */
Deno.serve(async (req) => {
  // 1. Manejo de CORS (Preflight)
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Método no permitido" }), { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  try {
    // Authenticate before parsing signing credentials or disclosing configuration errors.
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No Authorization header" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Invalid session" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const normalizePem = normalizeWalletPem;

    const wrapPemBody = (body: string) =>
      body.match(/.{1,64}/g)?.join("\n") || body;

    const rebuildPemBlock = (value: string, begin: string, end: string) => {
      const normalized = normalizePem(value);
      if (!normalized) return normalized;

      const escapedBegin = begin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const escapedEnd = end.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const match = normalized.match(new RegExp(`${escapedBegin}[\\s\\S]*?${escapedEnd}`));
      if (!match) return normalized;

      const block = match[0]
        .replace(begin, "")
        .replace(end, "")
        .replace(/\s+/g, "");

      return `${begin}\n${wrapPemBody(block)}\n${end}`;
    };

    // 2. Validación de Secretos (Entorno)
    const RAW_APPLE_PASS_TYPE_ID = String(Deno.env.get("APPLE_PASS_TYPE_ID") || "").trim();
    const RAW_APPLE_TEAM_ID = String(Deno.env.get("APPLE_TEAM_ID") || "").trim();
    const WWDR_CERT = rebuildPemBlock(
      Deno.env.get("APPLE_WWDR_CERT") || "",
      "-----BEGIN CERTIFICATE-----",
      "-----END CERTIFICATE-----",
    );
    const SIGNER_CERT = rebuildPemBlock(
      Deno.env.get("APPLE_PASS_CERT") || "",
      "-----BEGIN CERTIFICATE-----",
      "-----END CERTIFICATE-----",
    );
    const SIGNER_KEY = rebuildPemBlock(
      Deno.env.get("APPLE_PASS_KEY") || "",
      "-----BEGIN PRIVATE KEY-----",
      "-----END PRIVATE KEY-----",
    );
    const KEY_PASSWORD = Deno.env.get("APPLE_PASS_KEY_PASSWORD") || "";
    const PASS_STRIP_PNG_BASE64_VIP = String(Deno.env.get("PASS_STRIP_PNG_BASE64_VIP") || "").trim();
    const PASS_STRIP_PNG_BASE64_PREMIUM = String(Deno.env.get("PASS_STRIP_PNG_BASE64_PREMIUM") || "").trim();
    const PASS_STRIP_PNG_BASE64_GOLD = String(Deno.env.get("PASS_STRIP_PNG_BASE64_GOLD") || "").trim();

    if (!WWDR_CERT || !SIGNER_CERT || !SIGNER_KEY) {
      console.error("[ERROR] Certificados Apple no configurados en secretos de Supabase.");
      return new Response(JSON.stringify({ error: "Apple Wallet no está configurado en este entorno: faltan certificados de firma.", code: "WALLET_NOT_CONFIGURED" }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const pemSummary = (name: string, value: string) => ({
      name,
      length: value.length,
      hasBeginCert: value.includes("-----BEGIN CERTIFICATE-----"),
      hasEndCert: value.includes("-----END CERTIFICATE-----"),
      hasBeginKey: value.includes("-----BEGIN PRIVATE KEY-----") || value.includes("-----BEGIN ENCRYPTED PRIVATE KEY-----"),
      hasEndKey: value.includes("-----END PRIVATE KEY-----") || value.includes("-----END ENCRYPTED PRIVATE KEY-----"),
      hasLiteralSlashN: value.includes("\\n"),
      firstLine: String(value.split("\n")[0] || ""),
      lastLine: String(value.split("\n").slice(-1)[0] || ""),
    });

    try {
      forge.pki.certificateFromPem(WWDR_CERT);
    } catch (e: any) {
      console.error("[PEM] WWDR INVALID:", String(e?.message || e));
      const summary = pemSummary("wwdr", WWDR_CERT);
      throw new Error(
        `APPLE_WWDR_CERT inválido: ${String(e?.message || e)} | len=${summary.length} | begin=${summary.hasBeginCert} | end=${summary.hasEndCert} | first=${summary.firstLine} | last=${summary.lastLine}`,
      );
    }

    const signerCertObj = (() => {
      try {
        return forge.pki.certificateFromPem(SIGNER_CERT);
      } catch (e: any) {
        console.error("[PEM] PASS CERT INVALID:", String(e?.message || e));
        throw new Error(`APPLE_PASS_CERT inválido: ${String(e?.message || e)}`);
      }
    })();

    const signerCommonName = signerCertObj.subject.attributes.find((attr: any) =>
      attr?.name === "commonName" || attr?.shortName === "CN"
    )?.value;
    const signerOrgUnit = signerCertObj.subject.attributes.find((attr: any) =>
      attr?.name === "organizationalUnitName" || attr?.shortName === "OU"
    )?.value;

    try {
      if (KEY_PASSWORD) {
        const decryptedKey = forge.pki.decryptRsaPrivateKey(SIGNER_KEY, KEY_PASSWORD);
        if (!decryptedKey) throw new Error("La contraseña no permite abrir la clave de firma.");
      } else {
        forge.pki.privateKeyFromPem(SIGNER_KEY);
      }
    } catch (e: any) {
      console.error("[PEM] PASS KEY INVALID:", String(e?.message || e));
      throw new Error(`APPLE_PASS_KEY inválido: ${String(e?.message || e)}`);
    }

    const isPlaceholderPassTypeId = (value: string) => {
      const normalized = String(value || "").trim().toLowerCase();
      return !normalized || normalized === "tu.identificador.de.pase" || !normalized.startsWith("pass.");
    };

    const isPlaceholderTeamId = (value: string) => {
      const normalized = String(value || "").trim().toUpperCase();
      return !normalized || normalized === "TU_TEAM_ID";
    };

    const certPassTypeId = String(signerCommonName || "").replace(/^Pass Type ID:\s*/i, "").trim();
    const certTeamId = String(signerOrgUnit || "").trim();
    const APPLE_PASS_TYPE_ID = isPlaceholderPassTypeId(RAW_APPLE_PASS_TYPE_ID) ? certPassTypeId : RAW_APPLE_PASS_TYPE_ID;
    const APPLE_TEAM_ID = isPlaceholderTeamId(RAW_APPLE_TEAM_ID) ? certTeamId : RAW_APPLE_TEAM_ID;

    if (!APPLE_PASS_TYPE_ID || !APPLE_TEAM_ID) {
      throw new Error("No se pudo resolver passTypeIdentifier/teamIdentifier validos para Apple Wallet.");
    }

    if (APPLE_PASS_TYPE_ID !== certPassTypeId || APPLE_TEAM_ID !== certTeamId) {
      console.warn("[WARN] Pass identity mismatch:", JSON.stringify({
        envPassTypeIdentifier: RAW_APPLE_PASS_TYPE_ID || null,
        envTeamIdentifier: RAW_APPLE_TEAM_ID || null,
        resolvedPassTypeIdentifier: APPLE_PASS_TYPE_ID,
        resolvedTeamIdentifier: APPLE_TEAM_ID,
        certPassTypeIdentifier: certPassTypeId || null,
        certTeamIdentifier: certTeamId || null,
      }));
    }

    const decodeBase64ToUint8Array = (b64: string) => {
      const clean = String(b64 || "").trim().replace(/^data:.*;base64,/, "");
      const bin = atob(clean);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    };

    // 4. Parámetros del Request
    let ticket_id;
    try {
      const body = await req.json();
      ticket_id = body.ticket_id;
    } catch (e) {
      console.error("[ERROR] No se pudo parsear el JSON del body.");
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (!ticket_id) {
      console.error("[ERROR] Falta ticket_id en el body.");
      return new Response(JSON.stringify({ error: "Missing ticket_id" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 5. Query de Base de Datos (Seguridad RLS activa)
    const { data: ticket, error: dbError } = await supabase
      .from("tickets")
      .select(`
        id,
        buyer_name,
        buyer_email,
        quantity,
        qr_token,
        qr_code,
        user_id,
        ticket_type,
        ticket_type_id,
        event_ticket_types (
          id,
          name,
          category,
          metadata
        ),
        events (
          title,
          event_date,
          venues (name, address, latitude, longitude)
        )
      `)
      .eq("id", ticket_id)
      .eq("user_id", user.id) // Doble verificación de seguridad
      .single();

    if (dbError || !ticket) {
      console.error("[ERROR] Ticket no encontrado o el usuario no es el dueño:", dbError);
      return new Response(JSON.stringify({ error: "Ticket not found or access denied" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 6. Configuración de Passkit
    const ticketTypeObj = Array.isArray((ticket as any).event_ticket_types)
      ? (ticket as any).event_ticket_types[0]
      : (ticket as any).event_ticket_types;
    const rawCategory = String(
      ticketTypeObj?.category || (ticket as any).ticket_type || ticketTypeObj?.name || "",
    )
      .trim()
      .toLowerCase();

    const tier =
      rawCategory.includes("backstage") || rawCategory.includes("founder")
        ? "gold"
        : rawCategory.includes("vip")
          ? "vip"
          : "premium";

    const certificates: Record<string, string> = {
      wwdr: WWDR_CERT,
      signerCert: SIGNER_CERT,
      signerKey: SIGNER_KEY,
    };
    if (KEY_PASSWORD) {
      certificates.signerKeyPassphrase = KEY_PASSWORD;
    }

    const eventDate = new Date(ticket.events.event_date);
    const eventDateIso = String(ticket.events.event_date || "");

    const title = String(ticket.events?.title || "ECLIPSE").trim();
    const titleDisplay = title.toUpperCase();
    const ticketTypeMetadata =
      ticketTypeObj?.metadata && typeof ticketTypeObj.metadata === "object"
        ? ticketTypeObj.metadata as Record<string, unknown>
        : {};
    const eventYear = eventDate && Number.isFinite(eventDate.getTime())
      ? String(eventDate.getFullYear())
      : "2026";
    const dateDisplay = walletDate(eventDate);
    const timeDisplay = walletDate(eventDate, true);

    const venueName = String(ticket.events?.venues?.name || "Local por confirmar");
    const venueAddress = String(ticket.events?.venues?.address || "").trim();
    const venueLat = Number.parseFloat(String(ticket.events?.venues?.latitude ?? ""));
    const venueLng = Number.parseFloat(String(ticket.events?.venues?.longitude ?? ""));
    const hasVenueCoords = Number.isFinite(venueLat) && Number.isFinite(venueLng) && !(venueLat === 0 && venueLng === 0);

    const barcode = {
      format: "PKBarcodeFormatQR",
      message: ticket.qr_token || ticket.qr_code || ticket.id,
      messageEncoding: "iso-8859-1",
      altText: ticket.id.substring(0, 8).toUpperCase(),
    };

    const nonEmpty = (value: unknown) => {
      const s = String(value ?? "").trim();
      return s ? s : null;
    };
    const parsePositiveNumber = (value: unknown) => {
      const raw = String(value ?? "").trim();
      if (!raw) return null;
      const parsed = Number(raw);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    };
    const bottleSummary = Array.isArray(ticketTypeMetadata.vipBottles)
      ? ticketTypeMetadata.vipBottles
          .map((item) => {
            if (!item || typeof item !== "object") return null;
            const label = nonEmpty((item as Record<string, unknown>).brand) || nonEmpty((item as Record<string, unknown>).label);
            const quantity = parsePositiveNumber((item as Record<string, unknown>).quantity);
            if (!label || !quantity) return null;
            return `${label} x${quantity}`;
          })
          .filter(Boolean)
          .join(" • ")
      : null;
    const ticketTypeName = nonEmpty(ticketTypeObj?.name) || WALLET_THEMES[walletTier(rawCategory, ticketTypeObj?.name)].label;

    const passVisualTier = walletTier(rawCategory, ticketTypeObj?.name);
    const theme = WALLET_THEMES[passVisualTier];
    const palette = { backgroundColor: walletRgb(theme.background), foregroundColor: walletRgb(theme.foreground), labelColor: walletRgb(theme.accent) };
    const files: Record<string, Buffer> = {};
    for (const scale of [1, 2, 3]) {
      const suffix = scale === 1 ? "" : `@${scale}x`;
      for (const name of ["icon", "logo"]) {
        files[`${name}${suffix}.png`] = Buffer.from(decodeBase64ToUint8Array(WALLET_ASSETS[`${name}${suffix}.png`]));
      }
      files[`strip${suffix}.png`] = Buffer.from(decodeBase64ToUint8Array(WALLET_ASSETS[`strip_${passVisualTier}${suffix}.png`]));
    }
    const entryLeadMinutes =
      parsePositiveNumber(ticketTypeMetadata.earlyEntryMinutes) ||
      0;
    const entryDisplay = walletDate(new Date(eventDate.getTime() - entryLeadMinutes * 60 * 1000), true);
    const dedicatedLane = ticketTypeMetadata.dedicatedLane === true ? "Acceso prioritario" : null;
    const entryDate =
      eventDate && Number.isFinite(eventDate.getTime())
        ? new Date(eventDate.getTime() - entryLeadMinutes * 60 * 1000)
        : null;
    const relevantDate =
      entryDate && Number.isFinite(entryDate.getTime()) ? entryDate.toISOString() : undefined;
    // ══════════════════════════════════════════════════════════════════════════
    // DISPLAY VALUES
    // ══════════════════════════════════════════════════════════════════════════

    const passIdDisplay   = `ECL-${eventYear}-${ticket.id.slice(0,6).toUpperCase()}`;
    const holderName      = nonEmpty(ticket.buyer_name) || nonEmpty(user.email) || "Titular de la entrada";
    const benefits        = nonEmpty(ticketTypeMetadata.benefits);
    const vipGroupSize    = parsePositiveNumber(ticketTypeMetadata.vipGroupSize);
    const backstageHost   = nonEmpty(ticketTypeMetadata.backstageHost);
    const gateDisplay     = nonEmpty(ticketTypeMetadata.gate);
    const sectionDisplay  = nonEmpty(ticketTypeMetadata.section) || nonEmpty(ticketTypeMetadata.accessZone);
    const seatDisplay     = nonEmpty(ticketTypeMetadata.seat);
    const ticketCodeDisplay = passIdDisplay;
    const dateTimeDisplay   = `${dateDisplay} · ${timeDisplay}`;

    // Compact date in the launch market timezone.
    const shortDateDisplay = walletDate(eventDate);
    const expirationDate = eventDate && Number.isFinite(eventDate.getTime())
      ? new Date(eventDate.getTime() + 8 * 60 * 60 * 1000).toISOString()
      : undefined;

    // ── Tier badge for header field ─────────────────────────────────────────
    // Shown right of the ECLIPSE logo — first thing security sees at the gate.
    const tierBadge = theme.label;
    const accessLabel = theme.label;
    const categoryLabel = ticketTypeObj?.name || theme.label;
    const venueShort = venueName;
    const backFields: any[] = [];
    const pushBackField = (key: string, label: string, value: unknown) => {
      const v = nonEmpty(value);
      if (!v) return;
      backFields.push({ key: `back_${key}`, label, value: v });
    };

    const passJson = {
      formatVersion:      1,
      passTypeIdentifier: APPLE_PASS_TYPE_ID,
      teamIdentifier:     APPLE_TEAM_ID,
      serialNumber:       ticket.id,
      organizationName:   "ECLIPSE",
      description:        `${title} — ECLIPSE`,
      backgroundColor:    palette.backgroundColor,
      foregroundColor:    palette.foregroundColor,
      labelColor:         palette.labelColor,
      suppressStripShine: true,
      sharingProhibited:  true,
      groupingIdentifier: `eclipse.events.${eventYear}`,
      ...(relevantDate   ? { relevantDate }   : {}),
      ...(expirationDate ? { expirationDate } : {}),
      ...(hasVenueCoords ? {
        locations: [{
          latitude:     venueLat,
          longitude:    venueLng,
          relevantText: `${title} · Muestra tu entrada en el acceso`,
        }],
      } : {}),
      barcode:  { ...barcode, altText: ticketCodeDisplay },
      barcodes: [{ ...barcode, altText: ticketCodeDisplay }],

      eventTicket: {
        // ── HEADER ── (appears right of logo, small)
        // Shows tier badge — security sees this first at the gate.
        headerFields: [
          { key:  "tier",
            label: tierBadge,
            value: shortDateDisplay,
            textAlignment: "PKTextAlignmentRight" },
        ],

        // Keep the illustrated strip unobstructed. The event remains native,
        // accessible and available on Apple Watch, which omits strip artwork.
        primaryFields: [],

        // ── SECONDARY ── (two columns, medium weight)
        // Event and time sit on the solid background below the artwork.
        secondaryFields: [
          { key:   "eventName",
            label: categoryLabel,
            value: title,
            textAlignment: "PKTextAlignmentLeft" },
          { key:   "date",
            label: "HORA",
            value: walletDate(eventDate, true),
            textAlignment: "PKTextAlignmentRight" },
        ],

        // Venue, holder and optional group remain native, never painted in art.
        auxiliaryFields: [
          { key: "venue", label: "LOCAL", value: venueShort, textAlignment: "PKTextAlignmentLeft" },
          { key: "holder", label: "TITULAR", value: holderName, textAlignment: "PKTextAlignmentLeft" },
          ...(vipGroupSize ? [{ key: "group", label: "GRUPO", value: `${vipGroupSize} personas`, textAlignment: "PKTextAlignmentRight" }] : []),
        ],

        backFields,
      },
    };

    // ── BACK FIELDS (flip side — complete information) ─────────────────────
    pushBackField("holder",     "TITULAR",       holderName.toUpperCase());
    pushBackField("passId",     "REFERENCIA",             ticketCodeDisplay);
    pushBackField("tier",       "CATEGORÍA",         tierBadge);
    pushBackField("access",     "TIPO DE ENTRADA",         (ticketTypeName || accessLabel).toUpperCase());
    pushBackField("section",    "ZONA",             sectionDisplay);
    pushBackField("seat",       "ASIENTO",                seatDisplay);
    pushBackField("gate",       "PUERTA",          gateDisplay);
    pushBackField("entry",      "HORA DE ACCESO",          entryDisplay);
    pushBackField("showtime",   "INICIO",         timeDisplay);
    pushBackField("datetime",   "FECHA Y HORA · MADRID",         dateTimeDisplay);
    pushBackField("venue",      "LOCAL",               venueName);
    pushBackField("address",    "DIRECCIÓN",             venueAddress);
    pushBackField("lane",       "ACCESO PRIORITARIO",       dedicatedLane);
    pushBackField("benefits",   "INCLUYE",            benefits);
    pushBackField("groupSize",  "GRUPO",          vipGroupSize ? `${vipGroupSize} personas` : null);
    pushBackField("bottles",    "BOTELLAS",       bottleSummary);
    pushBackField("host",       "ANFITRIÓN",           backstageHost);
    pushBackField("terms", "INFORMACIÓN", "Presenta el QR en el acceso. Consulta las condiciones de tu compra y los detalles actualizados en Eclipse. No compartas el código de tu entrada.");
    const pass = new PKPass(
      {
        ...files,
        "pass.json": Buffer.from(JSON.stringify(passJson), "utf8"),
      },
      certificates,
    );

    // 7. Exportación a Buffer y Base64 Seguro
    const buffer = pass.getAsBuffer();
    
    // Conversión segura de Buffer -> Base64 en Deno Edge Runtime
    const uint8Array = new Uint8Array(buffer);
    let binaryString = "";
    for (let i = 0; i < uint8Array.byteLength; i++) {
      binaryString += String.fromCharCode(uint8Array[i]);
    }
    const base64 = btoa(binaryString);

    // 8. Respuesta Exitosa
    return new Response(JSON.stringify({ base64 }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err: any) {
    console.error("[CRITICAL ERROR] Fallo total en la función:", err);
    return new Response(JSON.stringify({ error: err.message || "Internal Server Error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
