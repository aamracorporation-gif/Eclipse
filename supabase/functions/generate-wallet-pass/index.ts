import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { SignJWT, importPKCS8 } from "https://esm.sh/jose@5.9.6";

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
        events (
          id,
          title,
          event_date,
          poster_url,
          venues (name)
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

    const objectId = `${GOOGLE_WALLET_ISSUER_ID}.${ticket.id}`;
    const eventTitle = String(ticket.events?.title || "Entrada");
    const eventDateIso = String(ticket.events?.event_date || "");
    const venueName = String(ticket.events?.venues?.name || "Ubicación por confirmar");
    const heroImage = String(ticket.events?.poster_url || "");
    const qrValue = String(ticket.qr_token || ticket.qr_code || ticket.id);
    const eventDateText = (() => {
      try {
        const d = eventDateIso ? new Date(eventDateIso) : null;
        if (!d || !Number.isFinite(d.getTime())) return "";
        return d.toLocaleString("es-ES", { year: "numeric", month: "long", day: "2-digit", hour: "2-digit", minute: "2-digit" });
      } catch {
        return "";
      }
    })();

    const genericObject: any = {
      id: objectId,
      classId: GOOGLE_WALLET_CLASS_ID,
      state: "ACTIVE",
      hexBackgroundColor: "#0F0F1A",
      barcode: {
        type: "QR_CODE",
        value: qrValue,
        alternateText: String(ticket.id).slice(0, 8).toUpperCase(),
      },
      cardTitle: { defaultValue: { language: "es-ES", value: eventTitle } },
      header: { defaultValue: { language: "es-ES", value: "Entrada" } },
      subheader: { defaultValue: { language: "es-ES", value: venueName } },
      textModulesData: [
        { id: "event", header: "Evento", body: eventTitle },
        ...(eventDateText ? [{ id: "date", header: "Fecha", body: eventDateText }] : []),
        { id: "venue", header: "Lugar", body: venueName },
      ],
    };

    if (heroImage) {
      genericObject.heroImage = {
        sourceUri: { uri: heroImage },
        contentDescription: { defaultValue: { language: "es-ES", value: "Cartel del evento" } },
      };
    }

    const privateKeyPem = GOOGLE_WALLET_PRIVATE_KEY.replace(/\\n/g, "\n");
    const key = await importPKCS8(privateKeyPem, "RS256");
    const nowSeconds = Math.floor(Date.now() / 1000);
    const jwt = await new SignJWT({
      payload: { genericObjects: [genericObject] },
    })
      .setProtectedHeader({ alg: "RS256", typ: "JWT" })
      .setIssuedAt(nowSeconds)
      .setIssuer(GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL)
      .setAudience("google")
      .setExpirationTime(nowSeconds + 60 * 5)
      .setSubject("savetowallet")
      .sign(key);

    const url = `https://pay.google.com/gp/v/save/${jwt}`;
    console.log(`[WALLET] Success! Generated Google Wallet link for ticket ${ticket_id}`);
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
