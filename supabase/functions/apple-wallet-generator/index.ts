import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { PKPass } from "https://esm.sh/passkit-generator@3.1.10";
import forge from "https://esm.sh/node-forge@1.4.0";
import JSZip from "https://esm.sh/jszip@3.10.1";
import { Buffer } from "node:buffer";
import {
  BUNDLED_FOOTER_PNG_BASE64,
  BUNDLED_ICON_PNG_BASE64,
  BUNDLED_LOGO_PNG_BASE64,
  BUNDLED_STRIP_PNG_BASE64_ART,
  BUNDLED_STRIP_PNG_BASE64_CORPORATE,
  BUNDLED_STRIP_PNG_BASE64_DEFAULT,
  BUNDLED_STRIP_PNG_BASE64_MUSIC,
  BUNDLED_STRIP_PNG_BASE64_SPORTS,
} from "./bundledAssets.ts";

// Headers CORS requeridos para Expo/React Native
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * REESCRITURA TOTAL: APPLE WALLET GENERATOR
 * Esta versión incluye logs detallados para el panel de Supabase y validación extrema.
 */
Deno.serve(async (req) => {
  // 1. Manejo de CORS (Preflight)
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    console.log("[START] Petición de generación de Wallet recibida.");

    const tryDecodeBase64Text = (value: string) => {
      try {
        const cleaned = String(value || "").replace(/\s+/g, "");
        if (!cleaned || cleaned.includes("-----BEGIN")) return String(value || "");
        if (!/^[A-Za-z0-9+/=]+$/.test(cleaned) || cleaned.length % 4 !== 0) return String(value || "");
        return new TextDecoder().decode(Uint8Array.from(atob(cleaned), (c) => c.charCodeAt(0)));
      } catch {
        return String(value || "");
      }
    };

    const normalizePem = (value: string) =>
      tryDecodeBase64Text(String(value || ""))
        .replace(/^\uFEFF/, "")
        .replace(/\r\n/g, "\n")
        .replace(/\\n/g, "\n")
        .replace(/^"+|"+$/g, "")
        .trim();

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
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
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
    const PASS_ICON_PNG_BASE64 = String(Deno.env.get("PASS_ICON_PNG_BASE64") || "").trim();
    const PASS_LOGO_PNG_BASE64 = String(Deno.env.get("PASS_LOGO_PNG_BASE64") || "").trim();
    const PASS_STRIP_PNG_BASE64_VIP = String(Deno.env.get("PASS_STRIP_PNG_BASE64_VIP") || "").trim();
    const PASS_STRIP_PNG_BASE64_PREMIUM = String(Deno.env.get("PASS_STRIP_PNG_BASE64_PREMIUM") || "").trim();
    const PASS_STRIP_PNG_BASE64_GOLD = String(Deno.env.get("PASS_STRIP_PNG_BASE64_GOLD") || "").trim();

    if (!WWDR_CERT || !SIGNER_CERT || !SIGNER_KEY) {
      console.error("[ERROR] Certificados Apple no configurados en secretos de Supabase.");
      throw new Error("Missing Apple Certificates in Environment Variables.");
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

    console.log("[PEM] Summary:", JSON.stringify({
      wwdr: pemSummary("wwdr", WWDR_CERT),
      signerCert: pemSummary("signerCert", SIGNER_CERT),
      signerKey: pemSummary("signerKey", SIGNER_KEY),
    }));

    try {
      forge.pki.certificateFromPem(WWDR_CERT);
      console.log("[PEM] WWDR OK");
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
      console.log("[PEM] PASS CERT SUBJECT:", JSON.stringify({
        commonName: signerCommonName || null,
        organizationalUnit: signerOrgUnit || null,
      }));
      console.log("[PEM] PASS CERT OK");
    } catch (e: any) {
      console.error("[PEM] PASS CERT INVALID:", String(e?.message || e));
      throw new Error(`APPLE_PASS_CERT inválido: ${String(e?.message || e)}`);
    }

    try {
      forge.pki.privateKeyFromPem(SIGNER_KEY);
      console.log("[PEM] PASS KEY OK");
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

    const hexPrefix = (bytes: Uint8Array, length = 8) =>
      Array.from(bytes.slice(0, length)).map((b) => b.toString(16).padStart(2, "0")).join("");

    const pngInfo = (bytes: Uint8Array | null) => {
      if (!bytes || bytes.length < 33) return null;
      const signature = hexPrefix(bytes);
      if (signature !== "89504e470d0a1a0a") {
        return {
          validPng: false,
          length: bytes.length,
          hexPrefix: signature,
        };
      }

      const width =
        (bytes[16] << 24) |
        (bytes[17] << 16) |
        (bytes[18] << 8) |
        bytes[19];
      const height =
        (bytes[20] << 24) |
        (bytes[21] << 16) |
        (bytes[22] << 8) |
        bytes[23];

      return {
        validPng: true,
        length: bytes.length,
        width: width >>> 0,
        height: height >>> 0,
        bitDepth: bytes[24],
        colorType: bytes[25],
      };
    };

    // 3. Validación de JWT (Sesión del Usuario)
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      console.error("[ERROR] No se recibió header de Authorization.");
      return new Response(JSON.stringify({ error: "No Authorization header" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      console.error("[ERROR] Sesión de usuario inválida o expirada:", authError);
      return new Response(JSON.stringify({ error: "Invalid session" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

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

    console.log(`[INFO] Generando pase para ticket: ${ticket_id} | Usuario: ${user.id}`);
    console.log("[INFO] Pass identity:", JSON.stringify({
      passTypeIdentifier: APPLE_PASS_TYPE_ID,
      teamIdentifier: APPLE_TEAM_ID,
    }));

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
    console.log("[INFO] Construyendo pass.json...");
    const iconPng = decodeBase64ToUint8Array(PASS_ICON_PNG_BASE64 || BUNDLED_ICON_PNG_BASE64);
    if (!iconPng || iconPng.length === 0) {
      console.error("[ERROR] No se encontró icon.png ni por secret ni empaquetado en el módulo.");
      throw new Error("Missing PASS_ICON_PNG_BASE64 and bundled icon.png.");
    }

    const logoPng = decodeBase64ToUint8Array(PASS_LOGO_PNG_BASE64 || BUNDLED_LOGO_PNG_BASE64);
    const effectiveLogoPng = logoPng || iconPng;
    const footerPng = decodeBase64ToUint8Array(BUNDLED_FOOTER_PNG_BASE64 || BUNDLED_LOGO_PNG_BASE64 || BUNDLED_ICON_PNG_BASE64);

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

    const categorySource = `${rawCategory} ${(ticket.events?.title || "")} ${(ticketTypeObj?.name || "")}`.toLowerCase();
    const eventStyle =
      /(conference|summit|corporate|business|forum|networking|expo)/.test(categorySource)
        ? "corporate"
        : /(sport|match|game|league|cup|stadium|football|soccer|basket|tennis|padel|ufc|formula|f1)/.test(categorySource)
          ? "sports"
          : /(museum|gallery|exhibition|art|installation|editorial)/.test(categorySource)
            ? "art"
            : /(concert|music|festival|dj|tour|live|party|show|amapiano)/.test(categorySource)
              ? "music"
              : "default";

    const eventTypeLabel =
      eventStyle === "music"
        ? "CONCERT"
        : eventStyle === "sports"
          ? "SPORT"
          : eventStyle === "corporate"
            ? "CONFERENCE"
            : eventStyle === "art"
              ? "EXHIBITION"
              : "EVENT";

    const palette =
      eventStyle === "music"
        ? {
            name: "eclipse-music",
            backgroundColor: "rgb(11, 11, 16)",
            foregroundColor: "rgb(255, 255, 255)",
            labelColor: "rgb(255, 179, 107)",
          }
        : eventStyle === "sports"
          ? {
              name: "eclipse-sports",
              backgroundColor: "rgb(10, 10, 16)",
              foregroundColor: "rgb(255, 255, 255)",
              labelColor: "rgb(125, 211, 255)",
            }
          : eventStyle === "corporate"
            ? {
                name: "eclipse-corporate",
                backgroundColor: "rgb(17, 17, 24)",
                foregroundColor: "rgb(255, 255, 255)",
                labelColor: "rgb(182, 187, 198)",
              }
            : eventStyle === "art"
              ? {
                  name: "eclipse-art",
                  backgroundColor: "rgb(15, 11, 24)",
                  foregroundColor: "rgb(255, 255, 255)",
                  labelColor: "rgb(199, 178, 255)",
                }
              : {
                  name: "eclipse-default",
                  backgroundColor: "rgb(14, 14, 20)",
                  foregroundColor: "rgb(255, 255, 255)",
                  labelColor: "rgb(154, 135, 255)",
                };

    const bundledStripBase64 =
      eventStyle === "music"
        ? BUNDLED_STRIP_PNG_BASE64_MUSIC
        : eventStyle === "sports"
          ? BUNDLED_STRIP_PNG_BASE64_SPORTS
          : eventStyle === "corporate"
            ? BUNDLED_STRIP_PNG_BASE64_CORPORATE
            : eventStyle === "art"
              ? BUNDLED_STRIP_PNG_BASE64_ART
              : BUNDLED_STRIP_PNG_BASE64_DEFAULT;
    const stripPng = decodeBase64ToUint8Array(
      bundledStripBase64 || BUNDLED_LOGO_PNG_BASE64 || BUNDLED_ICON_PNG_BASE64,
    );
    console.log("[INFO] Asset signatures:", JSON.stringify({
      iconLength: iconPng.length,
      iconHexPrefix: hexPrefix(iconPng),
      logoLength: logoPng?.length || 0,
      logoHexPrefix: logoPng ? hexPrefix(logoPng) : null,
      stripLength: stripPng?.length || 0,
      stripHexPrefix: stripPng ? hexPrefix(stripPng) : null,
      iconInfo: pngInfo(iconPng),
      logoInfo: pngInfo(logoPng),
      effectiveLogoInfo: pngInfo(effectiveLogoPng),
      footerInfo: pngInfo(footerPng),
      stripInfo: pngInfo(stripPng),
      tier,
      palette: palette.name,
    }));
    const iconBuffer = Buffer.from(iconPng);
    const logoBuffer = Buffer.from(effectiveLogoPng);
    const footerBuffer = Buffer.from(footerPng);
    const files: Record<string, Buffer> = {
      "icon.png": iconBuffer,
      "icon@2x.png": iconBuffer,
      "icon@3x.png": iconBuffer,
      "logo.png": logoBuffer,
      "logo@2x.png": logoBuffer,
      "logo@3x.png": logoBuffer,
      "footer.png": footerBuffer,
      "footer@2x.png": footerBuffer,
      "footer@3x.png": footerBuffer,
    };
    if (stripPng && stripPng.length > 0) {
      const stripBuffer = Buffer.from(stripPng);
      files["strip.png"] = stripBuffer;
      files["strip@2x.png"] = stripBuffer;
      files["strip@3x.png"] = stripBuffer;
    }

    const certificates: Record<string, string> = {
      wwdr: WWDR_CERT,
      signerCert: SIGNER_CERT,
      signerKey: SIGNER_KEY,
    };
    if (KEY_PASSWORD.trim()) {
      certificates.signerKeyPassphrase = KEY_PASSWORD.trim();
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
    const dateDisplay = eventDate && Number.isFinite(eventDate.getTime())
      ? eventDate
          .toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
          .replace(/\./g, "")
          .toUpperCase()
      : "TBA";
    const timeDisplay = eventDate && Number.isFinite(eventDate.getTime())
      ? eventDate.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
      : "TBA";

    const venueName = String(ticket.events?.venues?.name || "Venue to be announced");
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
            const label = nonEmpty((item as Record<string, unknown>).label);
            const quantity = parsePositiveNumber((item as Record<string, unknown>).quantity);
            if (!label || !quantity) return null;
            return `${label} x${quantity}`;
          })
          .filter(Boolean)
          .join(" • ")
      : null;
    const tierLabel =
      tier === "vip" ? "VIP" : tier === "gold" ? "FOUNDERS" : "PREMIUM";
    const editionLabel = Boolean(ticketTypeMetadata.featured) ? "SIGNATURE" : tierLabel;
    const ticketTypeName = nonEmpty(ticketTypeObj?.name) || `${tierLabel} ACCESS`;
    const accessZone =
      nonEmpty(ticketTypeMetadata.accessZone) ||
      (tier === "vip"
        ? "PREMIUM LOUNGE"
        : tier === "gold"
          ? "BACKSTAGE SALON"
          : "MAIN FLOOR");
    const entryLeadMinutes =
      parsePositiveNumber(ticketTypeMetadata.earlyEntryMinutes) ||
      (tier === "gold" ? 60 : tier === "vip" ? 45 : 30);
    const entryDisplay =
      eventDate && Number.isFinite(eventDate.getTime())
        ? new Date(eventDate.getTime() - entryLeadMinutes * 60 * 1000).toLocaleTimeString("en-GB", {
            hour: "2-digit",
            minute: "2-digit",
          })
        : "TBA";
    const dedicatedLane = ticketTypeMetadata.dedicatedLane === true
      ? "PRIORITY LANE"
      : tier === "vip" || tier === "gold"
        ? "VIP PRIORITY"
        : null;
    const entryDate =
      eventDate && Number.isFinite(eventDate.getTime())
        ? new Date(eventDate.getTime() - entryLeadMinutes * 60 * 1000)
        : null;
    const relevantDate =
      entryDate && Number.isFinite(entryDate.getTime()) ? entryDate.toISOString() : undefined;
    const passIdDisplay = `ECL-${eventYear}-${ticket.id.slice(0, 6).toUpperCase()}`;
    const holderName = nonEmpty(ticket.buyer_name) || nonEmpty(user.email) || "ECLIPSE MEMBER";
    const benefits = nonEmpty(ticketTypeMetadata.benefits);
    const vipGroupSize = parsePositiveNumber(ticketTypeMetadata.vipGroupSize);
    const backstageHost = nonEmpty(ticketTypeMetadata.backstageHost);
    const gateDisplay = nonEmpty(ticketTypeMetadata.gate) || dedicatedLane || "MAIN";
    const sectionDisplay = nonEmpty(ticketTypeMetadata.section) || tierLabel;
    const rowDisplay = nonEmpty(ticketTypeMetadata.row) || "OPEN";
    const seatDisplay = nonEmpty(ticketTypeMetadata.seat) || "GENERAL";
    const ticketCodeDisplay = passIdDisplay;
    const dateTimeDisplay = `${dateDisplay} • ${timeDisplay}`;
    const backFields: any[] = [];
    const pushBackField = (key: string, label: string, value: unknown) => {
      const v = nonEmpty(value);
      if (!v) return;
      backFields.push({ key, label, value: v });
    };

    // Short date label: "Thu · 19 Jun" style
    const shortDateDisplay = eventDate && Number.isFinite(eventDate.getTime())
      ? (() => {
          const day = eventDate.toLocaleDateString("en-GB", { weekday: "short" });
          const num = eventDate.getDate();
          const mon = eventDate.toLocaleDateString("en-GB", { month: "short" });
          return `${day} · ${num} ${mon}`;
        })()
      : "TBA";

    const expirationDate = eventDate && Number.isFinite(eventDate.getTime())
      ? new Date(eventDate.getTime() + 8 * 60 * 60 * 1000).toISOString()
      : undefined;

    const passJson = {
      formatVersion: 1,
      passTypeIdentifier: APPLE_PASS_TYPE_ID,
      teamIdentifier: APPLE_TEAM_ID,
      serialNumber: ticket.id,
      organizationName: "ECLIPSE",
      description: "ECLIPSE Event Ticket",
      backgroundColor: palette.backgroundColor,
      foregroundColor: palette.foregroundColor,
      labelColor: palette.labelColor,
      logoText: "",
      suppressStripShine: true,
      sharingProhibited: true,
      groupingIdentifier: `eclipse.events.${eventYear}`,
      ...(relevantDate ? { relevantDate } : {}),
      ...(expirationDate ? { expirationDate } : {}),
      voided: false,
      ...(hasVenueCoords
        ? {
            locations: [
              {
                latitude: venueLat,
                longitude: venueLng,
                relevantText: `Your ECLIPSE event is here`,
              },
            ],
          }
        : {}),
      barcode: {
        ...barcode,
        altText: ticketCodeDisplay,
      },
      barcodes: [
        {
          ...barcode,
          altText: ticketCodeDisplay,
        },
      ],
      semantics: {
        eventType: "PKEventTypeGeneric",
        eventName: title,
        venueName: venueName,
        ...(hasVenueCoords
          ? { venueLocation: { latitude: venueLat, longitude: venueLng } }
          : {}),
        ...(eventDate && Number.isFinite(eventDate.getTime())
          ? { eventStartDate: eventDate.toISOString() }
          : {}),
        ...(expirationDate ? { eventEndDate: expirationDate } : {}),
      },
      eventTicket: {
        headerFields: [
          {
            key: "eventDate",
            label: "DATE",
            value: shortDateDisplay,
            textAlignment: "PKTextAlignmentRight",
          },
        ],
        primaryFields: [
          {
            key: "eventName",
            label: "",
            value: title,
            textAlignment: "PKTextAlignmentLeft",
          },
        ],
        secondaryFields: [
          {
            key: "venue",
            label: "VENUE",
            value: venueName,
            textAlignment: "PKTextAlignmentLeft",
          },
          {
            key: "time",
            label: "TIME",
            value: timeDisplay,
            textAlignment: "PKTextAlignmentRight",
          },
        ],
        auxiliaryFields: [
          {
            key: "section",
            label: "SECTION",
            value: sectionDisplay,
          },
          {
            key: "seat",
            label: "SEAT",
            value: seatDisplay,
          },
          {
            key: "ticketId",
            label: "TICKET",
            value: ticketCodeDisplay,
          },
        ],
        backFields,
      },
    };
    pushBackField("holder", "TICKET HOLDER", holderName);
    pushBackField("access", "ACCESS", ticketTypeName.toUpperCase());
    pushBackField("zone", "ZONE", accessZone);
    pushBackField("gate", "GATE", gateDisplay);
    pushBackField("entry", "ENTRY WINDOW", entryDisplay);
    pushBackField("lane", "LANE", dedicatedLane);
    pushBackField("benefits", "BENEFITS", benefits);
    pushBackField("group", "VIP GROUP SIZE", vipGroupSize ? `${vipGroupSize} GUESTS` : null);
    pushBackField("bottles", "TABLE SERVICE", bottleSummary);
    pushBackField("host", "BACKSTAGE HOST", backstageHost);
    pushBackField("showtime-full", "SHOWTIME", dateTimeDisplay);
    pushBackField("venue-full", "VENUE", venueName);
    pushBackField("address", "ADDRESS", venueAddress);
    pushBackField("ticket", "TICKET ID", ticket.id);
    pushBackField("terms", "TERMS", "This ticket is non-transferable. Valid only for the date shown. No refunds.");
    pushBackField("support", "SUPPORT", "help@eclipse.app");
    console.log("[INFO] pass.json preview:", JSON.stringify({
      formatVersion: passJson.formatVersion,
      passTypeIdentifier: passJson.passTypeIdentifier,
      teamIdentifier: passJson.teamIdentifier,
      serialNumber: passJson.serialNumber,
      description: passJson.description,
      organizationName: passJson.organizationName,
      hasEventTicket: !!passJson.eventTicket,
      primaryFields: passJson.eventTicket?.primaryFields?.length || 0,
      secondaryFields: passJson.eventTicket?.secondaryFields?.length || 0,
      auxiliaryFields: passJson.eventTicket?.auxiliaryFields?.length || 0,
      backFields: passJson.eventTicket?.backFields?.length || 0,
      barcodeMessageLength: String(passJson.barcodes?.[0]?.message || "").length,
    }));

    const pass = new PKPass(
      {
        ...files,
        "pass.json": Buffer.from(JSON.stringify(passJson), "utf8"),
      },
      certificates,
    );

    // 7. Exportación a Buffer y Base64 Seguro
    console.log("[INFO] Firmando y exportando .pkpass...");
    const buffer = pass.getAsBuffer();
    
    // Conversión segura de Buffer -> Base64 en Deno Edge Runtime
    const uint8Array = new Uint8Array(buffer);
    try {
      const zip = await JSZip.loadAsync(uint8Array);
      const zipEntries = Object.keys(zip.files).sort();
      const manifestText = await zip.file("manifest.json")?.async("string");
      const manifestJson = manifestText ? JSON.parse(manifestText) : null;
      const signatureBytes = await zip.file("signature")?.async("uint8array");
      const packedPassJsonText = await zip.file("pass.json")?.async("string");
      const packedPassJson = packedPassJsonText ? JSON.parse(packedPassJsonText) : null;

      console.log("[INFO] ZIP entries:", JSON.stringify(zipEntries));
      console.log("[INFO] manifest preview:", JSON.stringify(
        manifestJson
          ? Object.fromEntries(
              Object.entries(manifestJson).map(([key, value]) => [
                key,
                String(value).slice(0, 12),
              ]),
            )
          : null,
      ));
      console.log("[INFO] signature info:", JSON.stringify({
        length: signatureBytes?.length || 0,
        hexPrefix: signatureBytes
          ? Array.from(signatureBytes.slice(0, 8)).map((b) => b.toString(16).padStart(2, "0")).join("")
          : null,
      }));
      console.log("[INFO] packed pass.json preview:", JSON.stringify(
        packedPassJson
          ? {
              passTypeIdentifier: packedPassJson.passTypeIdentifier || null,
              teamIdentifier: packedPassJson.teamIdentifier || null,
              serialNumber: packedPassJson.serialNumber || null,
              hasEventTicketObject: !!packedPassJson.eventTicket,
              topLevelKeys: Object.keys(packedPassJson).sort(),
            }
          : null,
      ));
    } catch (zipDebugError: any) {
      console.error("[ZIP DEBUG] No se pudo inspeccionar el pkpass generado:", String(zipDebugError?.message || zipDebugError));
    }

    let binaryString = "";
    for (let i = 0; i < uint8Array.byteLength; i++) {
      binaryString += String.fromCharCode(uint8Array[i]);
    }
    const base64 = btoa(binaryString);

    console.log("[SUCCESS] Pase generado correctamente en Base64.");

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
