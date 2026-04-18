import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { PKPass } from "https://esm.sh/passkit-generator@3.1.10";

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

    // 2. Validación de Secretos (Entorno)
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const APPLE_PASS_TYPE_ID = Deno.env.get("APPLE_PASS_TYPE_ID")!;
    const APPLE_TEAM_ID = Deno.env.get("APPLE_TEAM_ID")!;
    const WWDR_CERT = Deno.env.get("APPLE_WWDR_CERT")!;
    const SIGNER_CERT = Deno.env.get("APPLE_PASS_CERT")!;
    const SIGNER_KEY = Deno.env.get("APPLE_PASS_KEY")!;
    const KEY_PASSWORD = Deno.env.get("APPLE_PASS_KEY_PASSWORD") || "";

    if (!WWDR_CERT || !SIGNER_CERT || !SIGNER_KEY) {
      console.error("[ERROR] Certificados Apple no configurados en secretos de Supabase.");
      throw new Error("Missing Apple Certificates in Environment Variables.");
    }

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

    // 5. Query de Base de Datos (Seguridad RLS activa)
    const { data: ticket, error: dbError } = await supabase
      .from("tickets")
      .select(`
        id,
        buyer_name,
        qr_token,
        qr_code,
        user_id,
        events (
          title,
          event_date,
          venues (name)
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
    const pass = new PKPass({}, {
      wwdr: WWDR_CERT,
      signerCert: SIGNER_CERT,
      signerKey: SIGNER_KEY,
      signerKeyPassword: KEY_PASSWORD,
    });

    pass.type = "eventTicket";
    pass.passTypeIdentifier = APPLE_PASS_TYPE_ID;
    pass.teamIdentifier = APPLE_TEAM_ID;
    pass.serialNumber = ticket.id;
    pass.organizationName = "Eclipse App";
    pass.description = ticket.events.title;
    
    // Estilo Visual
    pass.backgroundColor = "rgb(15, 15, 26)";
    pass.foregroundColor = "rgb(255, 255, 255)";
    pass.labelColor = "rgb(124, 58, 237)";

    // Campos del Ticket
    pass.eventTicket.primaryFields.add({
      key: "event",
      label: "EVENTO",
      value: ticket.events.title
    });

    const eventDate = new Date(ticket.events.event_date);
    pass.eventTicket.secondaryFields.add({
      key: "date",
      label: "FECHA",
      value: eventDate.toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' })
    });

    pass.eventTicket.auxiliaryFields.add({
      key: "location",
      label: "LUGAR",
      value: ticket.events.venues?.name || "Ubicación por confirmar"
    });

    pass.eventTicket.backFields.add({
      key: "owner",
      label: "ASISTENTE",
      value: ticket.buyer_name || user.email || "Usuario Eclipse"
    });

    // Código QR
    pass.barcodes.set({
      format: "PKBarcodeFormatQR",
      message: ticket.qr_token || ticket.qr_code || ticket.id,
      messageEncoding: "iso-8859-1",
      altText: ticket.id.substring(0, 8).toUpperCase()
    });

    // 7. Exportación a Buffer y Base64 Seguro
    console.log("[INFO] Firmando y exportando .pkpass...");
    const buffer = await pass.export();
    
    // Conversión segura de Buffer -> Base64 en Deno Edge Runtime
    const uint8Array = new Uint8Array(buffer);
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
