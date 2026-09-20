type Json = Record<string, unknown>;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: Json) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function toInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && value.trim() && !Number.isNaN(Number(value))) return Math.trunc(Number(value));
  return null;
}

function getStripeSecretKey(): string {
  const key = (Deno.env.get("STRIPE_SECRET_KEY") ?? "").trim();
  if (!key) throw new Error("Stripe no configurado: falta STRIPE_SECRET_KEY en Supabase Secrets");
  if (!(key.startsWith("sk_") || key.startsWith("rk_"))) throw new Error("Stripe no configurado: STRIPE_SECRET_KEY inválida");
  if (/\s/.test(key)) throw new Error("Stripe no configurado: STRIPE_SECRET_KEY contiene espacios o saltos de línea");
  return key;
}

function getStripeMode(): "test" | "live" {
  const key = getStripeSecretKey();
  if (key.startsWith("sk_test_") || key.startsWith("rk_test_")) return "test";
  return "live";
}

function getEclipseNetRateBps(): number {
  const raw = (Deno.env.get("STRIPE_PLATFORM_FEE_BPS") ?? "").trim();
  const parsed = raw ? Number(raw) : 1000; // default 10%
  if (!Number.isFinite(parsed)) return 1000;
  const bps = Math.trunc(parsed);
  if (bps < 0) return 0;
  if (bps > 10000) return 10000;
  return bps;
}

// Tasa de servicio que paga el COMPRADOR: cubre únicamente el coste de Stripe (1.5% + €0.25).
// La comisión de Eclipse (eclipseNetRateBps%) se cobra aparte al ORGANIZADOR vía application_fee_amount.
// Formula: stripePassthrough × (1 - 0.015) = ticketCents × 0.015 + 0.25
//          stripePassthrough = (ticketCents × 0.015 + 25) / 0.985
function computeStripePassthroughCents(ticketAmountCents: number): number {
  const fee = Math.round((ticketAmountCents * 0.015 + 25) / 0.985);
  return Math.max(fee, 50); // mínimo de Stripe EUR
}

function isStripeConnectPlatformError(message: string): boolean {
  const msg = String(message || "").toLowerCase();
  return msg.includes("only stripe connect platforms can work with other accounts");
}

function isStripeNoSuchDestinationError(message: string): boolean {
  const msg = String(message || "").toLowerCase();
  return msg.includes("no such destination");
}

async function stripeGetPlatformAccount() {
  const STRIPE_SECRET_KEY = getStripeSecretKey();
  const res = await fetch("https://api.stripe.com/v1/account", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
    },
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = (data as any)?.error?.message || "Stripe error";
    throw new Error(String(msg));
  }
  return data as { id: string; charges_enabled?: boolean; payouts_enabled?: boolean; details_submitted?: boolean };
}

async function getStripePlatformAccountIdSafe() {
  try {
    const platform = await stripeGetPlatformAccount();
    return typeof (platform as any)?.id === "string" ? (platform as any).id : null;
  } catch {
    return null;
  }
}

async function stripeGetAccount(accountId: string) {
  const STRIPE_SECRET_KEY = getStripeSecretKey();
  const res = await fetch(`https://api.stripe.com/v1/accounts/${encodeURIComponent(accountId)}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
    },
  });

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 404) return null;
    if (res.status === 401 || res.status === 403) {
      const msg = String((data as any)?.error?.message || "");
      if (msg.toLowerCase().includes("does not have access to account")) return null;
    }
    const msg = (data as any)?.error?.message || "Stripe error";
    throw new Error(String(msg));
  }

  return data as { id: string };
}

async function stripeCreatePaymentIntent(params: Record<string, string>, idempotencyKey: string) {
  const STRIPE_SECRET_KEY = getStripeSecretKey();
  const res = await fetch("https://api.stripe.com/v1/payment_intents", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Idempotency-Key": idempotencyKey,
    },
    body: new URLSearchParams(params),
  });

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = (data as any)?.error?.message || "Stripe error";
    throw new Error(String(msg));
  }

  return data as { id: string; client_secret: string; amount: number; currency: string };
}

async function stripeRetrievePaymentIntent(paymentIntentId: string) {
  const res = await fetch(`https://api.stripe.com/v1/payment_intents/${encodeURIComponent(paymentIntentId)}`, {
    headers: { Authorization: `Bearer ${getStripeSecretKey()}` },
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(String((data as any)?.error?.message || "Stripe error"));
  return data as { id: string; client_secret: string; amount: number; currency: string };
}

async function authUser(supabaseUrl: string, anonKey: string, authorization: string) {
  const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: anonKey,
      Authorization: authorization,
    },
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) return { user: null, error: (data as any)?.msg || (data as any)?.message || "Unauthorized" };
  return { user: data as any, error: null };
}

async function restGet(supabaseUrl: string, serviceKey: string, path: string) {
  const res = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      Accept: "application/json",
    },
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

async function restPost(supabaseUrl: string, serviceKey: string, table: string, body: unknown) {
  const res = await fetch(`${supabaseUrl}/rest/v1/${table}`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(body),
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return jsonResponse({ ok: true });

  try {
    if (req.method !== "POST") return jsonResponse({ ok: false, error: "Method not allowed" });

    const SUPABASE_URL = (Deno.env.get("SUPABASE_URL") ?? "").trim();
    const SUPABASE_ANON_KEY = (Deno.env.get("SUPABASE_ANON_KEY") ?? "").trim();
    const SUPABASE_SERVICE_ROLE_KEY = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim();
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
      return jsonResponse({ ok: false, error: "Missing Supabase env vars" });
    }

    const authorization = req.headers.get("Authorization") || "";
    if (!authorization) return jsonResponse({ ok: false, error: "Unauthorized" });

    const { user, error: userErr } = await authUser(SUPABASE_URL, SUPABASE_ANON_KEY, authorization);
    if (!user || userErr) return jsonResponse({ ok: false, error: String(userErr || "Unauthorized") });

    const userId = String((user as any)?.id || "");
    if (!userId) return jsonResponse({ ok: false, error: "Unauthorized" });

    let body: any;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ ok: false, error: "Invalid JSON" });
    }

    const kind = body?.kind;
    if (kind !== "event_ticket" && kind !== "vip_table" && kind !== "resale_ticket") {
      return jsonResponse({ ok: false, error: "Not implemented" });
    }

    const idempotencyKey = String(body?.idempotency_key || "").trim();
    if (!/^[A-Za-z0-9_.:-]{16,200}$/.test(idempotencyKey)) {
      return jsonResponse({ ok: false, error: "Missing or invalid idempotency_key" });
    }

    const previous = await restGet(
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY,
      `payment_transactions?idempotency_key=eq.${encodeURIComponent(idempotencyKey)}&user_id=eq.${encodeURIComponent(userId)}&select=id,stripe_payment_intent_id`,
    );
    if (previous.ok && Array.isArray(previous.json) && previous.json.length > 0) {
      const tx = previous.json[0];
      const intent = await stripeRetrievePaymentIntent(String(tx.stripe_payment_intent_id));
      return jsonResponse({
        ok: true,
        client_secret: intent.client_secret,
        payment_intent_id: intent.id,
        amount_cents: intent.amount,
        currency: intent.currency,
        transaction_id: String(tx.id),
        idempotent_replay: true,
        stripe_mode: getStripeMode(),
      });
    }

    const requireOrganizerConnect = (Deno.env.get("REQUIRE_ORGANIZER_STRIPE_CONNECT") ?? "").trim().toLowerCase() === "true";

    if (kind === "event_ticket") {
      const eventId = String(body?.event_id || "");
      const ticketTypeId = body?.ticket_type_id ? String(body.ticket_type_id) : null;
      const quantity = toInt(body?.quantity) ?? 0;
      if (!eventId || quantity < 1 || quantity > 10) return jsonResponse({ ok: false, error: "Invalid request" });

      const ev = await restGet(
        SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY,
        `events?id=eq.${encodeURIComponent(eventId)}&select=id,title,creator_id,ticket_price,available_tickets,event_ticket_types(id,price,quantity,sold)`,
      );
      if (!ev.ok || !Array.isArray(ev.json) || ev.json.length === 0) return jsonResponse({ ok: false, error: "Event not found" });
      const eventRow = ev.json[0];

      if (Number(eventRow.available_tickets ?? 0) < quantity) return jsonResponse({ ok: false, error: "Not enough tickets available" });

      let price = Number(eventRow.ticket_price ?? 0);
      if (ticketTypeId) {
        const types = Array.isArray(eventRow.event_ticket_types) ? eventRow.event_ticket_types : [];
        const selected = types.find((t: any) => String(t.id) === ticketTypeId);
        if (!selected) return jsonResponse({ ok: false, error: "Ticket type not found" });
        const available = Number(selected.quantity ?? 0) - Number(selected.sold ?? 0);
        if (available < quantity) return jsonResponse({ ok: false, error: "Ticket type sold out" });
        price = Number(selected.price ?? price);
      }

      const originalTotalCents = Math.round(price * 100) * quantity;
      if (!Number.isFinite(originalTotalCents) || originalTotalCents <= 0) return jsonResponse({ ok: false, error: "Invalid price" });

      // --- Discount code (server-side validation) ---
      const discountCodeId = body?.discount_code_id ? String(body.discount_code_id) : null;
      let discountAmountCents = 0;
      if (discountCodeId) {
        const dcRes = await restGet(
          SUPABASE_URL,
          SUPABASE_SERVICE_ROLE_KEY,
          `discount_codes?id=eq.${encodeURIComponent(discountCodeId)}&select=id,event_id,discount_type,discount_value,max_uses,uses_count,valid_from,valid_until,is_active`,
        );
        const dcRow = Array.isArray(dcRes.json) && dcRes.json.length > 0 ? dcRes.json[0] : null;
        if (!dcRow) return jsonResponse({ ok: false, error: "Discount code not found" });
        if (String(dcRow.event_id) !== eventId) return jsonResponse({ ok: false, error: "Discount code not valid for this event" });
        if (!dcRow.is_active) return jsonResponse({ ok: false, error: "Discount code is inactive" });
        const now = new Date().toISOString();
        if (dcRow.valid_until && String(dcRow.valid_until) < now) return jsonResponse({ ok: false, error: "Discount code has expired" });
        if (dcRow.valid_from && String(dcRow.valid_from) > now) return jsonResponse({ ok: false, error: "Discount code is not yet active" });
        if (dcRow.max_uses !== null && Number(dcRow.uses_count ?? 0) >= Number(dcRow.max_uses)) {
          return jsonResponse({ ok: false, error: "Discount code has reached its usage limit" });
        }
        if (String(dcRow.discount_type) === "percentage") {
          discountAmountCents = Math.round(originalTotalCents * (Number(dcRow.discount_value) / 100));
        } else {
          discountAmountCents = Math.min(Math.round(Number(dcRow.discount_value) * 100), originalTotalCents);
        }
      }
      const discountedTotalCents = originalTotalCents - discountAmountCents;
      if (discountedTotalCents < 0) return jsonResponse({ ok: false, error: "Invalid discount" });

      // Tasa de servicio (paga el COMPRADOR): solo cubre el coste de Stripe
      const eclipseNetRateBps = getEclipseNetRateBps();
      const eclipseRate = eclipseNetRateBps / 10000;
      // Fees and commission calculated on the discounted price
      const stripePassthroughCents = computeStripePassthroughCents(discountedTotalCents);
      // Comisión Eclipse (paga el ORGANIZADOR): eclipseRate% del precio descontado
      const eclipseCommissionCents = Math.round(discountedTotalCents * eclipseRate);
      // application_fee = comisión + passthrough; Stripe transfiere automáticamente el resto al organizador
      const applicationFeeAmountCents = eclipseCommissionCents + stripePassthroughCents;

      // El crédito puede cubrir hasta (ticket descontado - comisión)
      const creditDebitRaw = body?.credit_debit_eur ?? body?.wallet_debit_eur;
      let creditDebitCents = 0;
      if (typeof creditDebitRaw === "number" && Number.isFinite(creditDebitRaw)) creditDebitCents = Math.round(creditDebitRaw * 100);
      if (typeof creditDebitRaw === "string" && creditDebitRaw.trim()) {
        const n = Number(creditDebitRaw);
        if (Number.isFinite(n)) creditDebitCents = Math.round(n * 100);
      }
      if (!Number.isFinite(creditDebitCents) || creditDebitCents < 0) creditDebitCents = 0;
      const maxCreditCents = discountedTotalCents - eclipseCommissionCents;
      if (creditDebitCents > maxCreditCents) creditDebitCents = maxCreditCents;

      const amountCents = discountedTotalCents + stripePassthroughCents - creditDebitCents;
      if (!Number.isFinite(amountCents) || amountCents <= 0) return jsonResponse({ ok: false, error: "Invalid price" });

      const organizerId = eventRow.creator_id ? String(eventRow.creator_id) : "";
      if (!organizerId) return jsonResponse({ ok: false, error: "Organizer not found" });

      const org = await restGet(
        SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY,
        `profiles?id=eq.${encodeURIComponent(organizerId)}&select=stripe_account_id,stripe_charges_enabled`,
      );
      const organizerProfile = Array.isArray(org.json) && org.json.length ? org.json[0] : null;
      const rawStripeAccountId = organizerProfile?.stripe_account_id ? String(organizerProfile.stripe_account_id) : "";
      let hasConnect = !!rawStripeAccountId && Boolean(organizerProfile?.stripe_charges_enabled);

      if (hasConnect) {
        const exists = await stripeGetAccount(rawStripeAccountId);
        if (!exists) {
          hasConnect = false;
        }
      }

      if (!hasConnect && requireOrganizerConnect) {
        return jsonResponse({
          ok: false,
          error:
            rawStripeAccountId
              ? `Stripe Connect inválido o en otro modo (test/live). Re-vincula Stripe del organizador. (acct=${rawStripeAccountId})`
              : "El organizador debe vincular Stripe para poder cobrar.",
        });
      }

      // Eclipse retiene comisión + passthrough como application_fee; organizer recibe el resto (90%)
      const platformFeeCents = eclipseCommissionCents;
      const destinationAmountCents = hasConnect ? (amountCents - applicationFeeAmountCents) : 0;

      const intentParams: Record<string, string> = {
        amount: String(amountCents),
        currency: "eur",
        "automatic_payment_methods[enabled]": "true",
        description: `Event ticket(s) - ${eventId}`,
        "metadata[kind]": "event_ticket",
        "metadata[user_id]": userId,
        "metadata[event_id]": eventId,
        ...(ticketTypeId ? { "metadata[ticket_type_id]": ticketTypeId } : {}),
        "metadata[quantity]": String(quantity),
        "metadata[original_total_cents]": String(originalTotalCents),
        "metadata[discount_amount_cents]": String(discountAmountCents),
        "metadata[discounted_total_cents]": String(discountedTotalCents),
        "metadata[service_fee_cents]": String(stripePassthroughCents),
        "metadata[eclipse_commission_cents]": String(eclipseCommissionCents),
        "metadata[credit_debit_cents]": String(creditDebitCents),
        ...(discountCodeId ? { "metadata[discount_code_id]": discountCodeId } : {}),
      };
      if (hasConnect) {
        intentParams["transfer_data[destination]"] = rawStripeAccountId;
        intentParams.application_fee_amount = String(applicationFeeAmountCents);
      }

      let intent;
      try {
        intentParams["metadata[idempotency_key]"] = idempotencyKey;
        intent = await stripeCreatePaymentIntent(intentParams, idempotencyKey);
      } catch (e: any) {
        const message = String(e?.message || e || "");
        if (hasConnect && isStripeConnectPlatformError(message)) {
          let platformId = "desconocido";
          try {
            const platform = await stripeGetPlatformAccount();
            platformId = platform?.id || platformId;
          } catch {}
          return jsonResponse({
            ok: false,
            error:
              "Stripe Connect no está habilitado en tu cuenta plataforma o estás usando una STRIPE_SECRET_KEY que no pertenece a una Connect platform. " +
              "Ve a Stripe Dashboard → Settings → Connect y habilítalo (y asegúrate de usar la clave secreta de ESA cuenta plataforma). " +
              `Cuenta plataforma detectada: ${platformId}. Error: ${message}`,
          });
        }

        if (hasConnect && isStripeNoSuchDestinationError(message)) {
          return jsonResponse({
            ok: false,
            error:
              `Stripe Connect destination inválido: ${rawStripeAccountId}. ` +
              "Esto suele pasar por mezcla test/live o porque el acct fue desconectado/borrado. " +
              `Re-vincula Stripe del organizador. Error: ${message}`,
          });
        }

        throw e;
      }

      const buyerName = typeof body?.buyer_name === "string" ? body.buyer_name : "";
      const buyerEmail = typeof body?.buyer_email === "string" ? body.buyer_email : "";

      const metadata = {
        event_id: eventId,
        ticket_type_id: ticketTypeId ?? "",
        quantity,
        buyer_name: buyerName,
        buyer_email: buyerEmail,
        original_total_cents: originalTotalCents,
        discount_amount_cents: discountAmountCents,
        discounted_total_cents: discountedTotalCents,
        discount_code_id: discountCodeId ?? "",
        service_fee_cents: stripePassthroughCents,
        eclipse_commission_cents: eclipseCommissionCents,
        credit_debit_cents: creditDebitCents,
        event_title: String(eventRow.title || ""),
        platform_fee_cents: platformFeeCents,
        destination_amount_cents: destinationAmountCents,
      };

      const txInsert = await restPost(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, "payment_transactions", {
        user_id: userId,
        kind: "event_ticket",
        amount_cents: intent.amount,
        currency: intent.currency,
        stripe_payment_intent_id: intent.id,
        status: "created",
        platform_fee_cents: platformFeeCents,
        destination_account_id: hasConnect ? String(organizerProfile?.stripe_account_id || rawStripeAccountId) : null,
        destination_amount_cents: hasConnect ? destinationAmountCents : 0,
        commission_bps: eclipseNetRateBps,
        idempotency_key: idempotencyKey,
        metadata,
      });

      if (!txInsert.ok || !Array.isArray(txInsert.json) || txInsert.json.length === 0) {
        return jsonResponse({ ok: false, error: "Failed to store transaction" });
      }

      return jsonResponse({
        ok: true,
        client_secret: intent.client_secret,
        payment_intent_id: intent.id,
        amount_cents: intent.amount,
        ticket_amount_cents: originalTotalCents,
        service_fee_cents: stripePassthroughCents,
        currency: intent.currency,
        transaction_id: String(txInsert.json[0]?.id || ""),
        stripe_mode: getStripeMode(),
        stripe_platform_account_id: await getStripePlatformAccountIdSafe(),
      });
    }

    if (kind === "resale_ticket") {
      const listingId = String(body?.listing_id || "");
      if (!listingId) return jsonResponse({ ok: false, error: "Invalid request" });

      const listingRes = await restGet(
        SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY,
        `resale_listings?id=eq.${encodeURIComponent(listingId)}&select=id,ticket_id,seller_id,price,status`,
      );
      if (!listingRes.ok || !Array.isArray(listingRes.json) || listingRes.json.length === 0) {
        return jsonResponse({ ok: false, error: "Listing not found" });
      }
      const listing = listingRes.json[0];
      if (String(listing.status || "") !== "active") return jsonResponse({ ok: false, error: "Listing not active" });
      if (String(listing.seller_id || "") === userId) return jsonResponse({ ok: false, error: "Cannot buy your own ticket" });

      const ticketId = String(listing.ticket_id || "");
      if (!ticketId) return jsonResponse({ ok: false, error: "Listing not found" });

      const ticketRes = await restGet(
        SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY,
        `tickets?id=eq.${encodeURIComponent(ticketId)}&select=id,event_id,total_price,status,ticket_status,user_id,scanned_at,validation_status,payment_status,wallet_added`,
      );
      if (!ticketRes.ok || !Array.isArray(ticketRes.json) || ticketRes.json.length === 0) {
        return jsonResponse({ ok: false, error: "Ticket not found" });
      }
      const ticket = ticketRes.json[0];
      if (String(ticket.user_id || "") !== String(listing.seller_id || "")) {
        return jsonResponse({ ok: false, error: "Listing owner no longer owns the ticket" });
      }

      const inResaleState =
        String(ticket.ticket_status || "") === "reselling" && String(ticket.status || "") === "resale";
      if (!inResaleState || ticket.scanned_at || ticket.validation_status === "used" || ticket.wallet_added) {
        return jsonResponse({ ok: false, error: "Ticket is not eligible for resale" });
      }
      if (ticket.payment_status !== "paid") {
        return jsonResponse({ ok: false, error: "Ticket payment is not complete" });
      }

      const eventId = String(ticket.event_id || "");
      if (!eventId) return jsonResponse({ ok: false, error: "Event not found" });

      const ev = await restGet(
        SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY,
        `events?id=eq.${encodeURIComponent(eventId)}&select=id,title,creator_id,allow_resale,event_date,end_datetime,is_cancelled,status`,
      );
      if (!ev.ok || !Array.isArray(ev.json) || ev.json.length === 0) return jsonResponse({ ok: false, error: "Event not found" });
      const eventRow = ev.json[0];
      const allowResale = eventRow?.allow_resale ?? true;
      if (allowResale === false) return jsonResponse({ ok: false, error: "Resale not allowed for this event" });
      if (eventRow.is_cancelled || ["cancelled", "deleted"].includes(String(eventRow.status || ""))) {
        return jsonResponse({ ok: false, error: "Event is not available" });
      }
      const endDate = eventRow.end_datetime
        ? new Date(eventRow.end_datetime)
        : new Date(new Date(eventRow.event_date).getTime() + 5 * 60 * 60 * 1000);
      if (!Number.isFinite(endDate.getTime()) || endDate.getTime() <= Date.now()) {
        return jsonResponse({ ok: false, error: "Event has ended" });
      }

      const priceEur = Number(listing.price ?? 0);
      const originalResaleCents = Math.round(priceEur * 100);
      if (!Number.isFinite(originalResaleCents) || originalResaleCents <= 0) return jsonResponse({ ok: false, error: "Invalid price" });

      const resaleEclipseRateBps = getEclipseNetRateBps();
      // Reventa: sin Connect, la comisión se descuenta del crédito del vendedor en fulfill.
      // El comprador solo paga la tasa de Stripe.
      const resaleServiceFeeCents = computeStripePassthroughCents(originalResaleCents);
      const resaleAmountCents = originalResaleCents + resaleServiceFeeCents;

      const intentParams: Record<string, string> = {
        amount: String(resaleAmountCents),
        currency: "eur",
        "automatic_payment_methods[enabled]": "true",
        description: `Resale ticket - ${eventId}`,
        "metadata[kind]": "resale_ticket",
        "metadata[user_id]": userId,
        "metadata[event_id]": eventId,
        "metadata[listing_id]": listingId,
        "metadata[ticket_id]": ticketId,
        "metadata[seller_id]": String(listing.seller_id || ""),
        "metadata[original_total_cents]": String(originalResaleCents),
        "metadata[service_fee_cents]": String(resaleServiceFeeCents),
        "metadata[credit_debit_cents]": "0",
      };

      intentParams["metadata[idempotency_key]"] = idempotencyKey;
      const intent = await stripeCreatePaymentIntent(intentParams, idempotencyKey);

      const metadata = {
        event_id: eventId,
        event_title: String(eventRow.title || ""),
        listing_id: listingId,
        ticket_id: ticketId,
        seller_id: String(listing.seller_id || ""),
        original_total_cents: originalResaleCents,
        service_fee_cents: resaleServiceFeeCents,
        credit_debit_cents: 0,
      };

      const txInsert = await restPost(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, "payment_transactions", {
        user_id: userId,
        kind: "resale_ticket",
        amount_cents: intent.amount,
        currency: intent.currency,
        stripe_payment_intent_id: intent.id,
        status: "created",
        platform_fee_cents: resaleServiceFeeCents,
        destination_account_id: null,
        destination_amount_cents: 0,
        commission_bps: resaleEclipseRateBps,
        idempotency_key: idempotencyKey,
        metadata,
      });

      if (!txInsert.ok || !Array.isArray(txInsert.json) || txInsert.json.length === 0) {
        return jsonResponse({ ok: false, error: "Failed to store transaction" });
      }

      return jsonResponse({
        ok: true,
        client_secret: intent.client_secret,
        payment_intent_id: intent.id,
        amount_cents: intent.amount,
        ticket_amount_cents: originalResaleCents,
        service_fee_cents: resaleServiceFeeCents,
        currency: intent.currency,
        transaction_id: String(txInsert.json[0]?.id || ""),
        stripe_mode: getStripeMode(),
        stripe_platform_account_id: await getStripePlatformAccountIdSafe(),
      });
    }

    if (kind === "vip_table") {
      const vipId = String(body?.reference_id || "");
      if (!vipId) return jsonResponse({ ok: false, error: "Invalid request" });

      const vipRes = await restGet(
        SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY,
        `reservados_vip?id=eq.${encodeURIComponent(vipId)}&select=id,event_id,base_price,quantity_available,capacity_people,name`,
      );
      if (!vipRes.ok || !Array.isArray(vipRes.json) || vipRes.json.length === 0) return jsonResponse({ ok: false, error: "VIP not found" });
      const vip = vipRes.json[0];

      if (Number(vip.quantity_available ?? 0) < 1) return jsonResponse({ ok: false, error: "VIP sold out" });

      const eventId = String(vip.event_id || "");
      if (!eventId) return jsonResponse({ ok: false, error: "VIP not found" });

      const ev = await restGet(
        SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY,
        `events?id=eq.${encodeURIComponent(eventId)}&select=id,title,creator_id`,
      );
      if (!ev.ok || !Array.isArray(ev.json) || ev.json.length === 0) return jsonResponse({ ok: false, error: "Event not found" });
      const eventRow = ev.json[0];

      const basePrice = Number(vip.base_price ?? 0);
      const vipOriginalCents = Math.round(basePrice * 100);
      if (!Number.isFinite(vipOriginalCents) || vipOriginalCents <= 0) return jsonResponse({ ok: false, error: "Invalid price" });

      const vipEclipseRateBps = getEclipseNetRateBps();
      const vipEclipseRate = vipEclipseRateBps / 10000;
      const vipStripePassthroughCents = computeStripePassthroughCents(vipOriginalCents);
      const vipEclipseCommissionCents = Math.round(vipOriginalCents * vipEclipseRate);
      const vipApplicationFeeAmountCents = vipEclipseCommissionCents + vipStripePassthroughCents;

      const creditDebitRaw = body?.credit_debit_eur ?? body?.wallet_debit_eur;
      let creditDebitCents = 0;
      if (typeof creditDebitRaw === "number" && Number.isFinite(creditDebitRaw)) creditDebitCents = Math.round(creditDebitRaw * 100);
      if (typeof creditDebitRaw === "string" && creditDebitRaw.trim()) {
        const n = Number(creditDebitRaw);
        if (Number.isFinite(n)) creditDebitCents = Math.round(n * 100);
      }
      if (!Number.isFinite(creditDebitCents) || creditDebitCents < 0) creditDebitCents = 0;
      const vipMaxCreditCents = vipOriginalCents - vipEclipseCommissionCents;
      if (creditDebitCents > vipMaxCreditCents) creditDebitCents = vipMaxCreditCents;

      const amountCents = vipOriginalCents + vipStripePassthroughCents - creditDebitCents;
      if (!Number.isFinite(amountCents) || amountCents <= 0) return jsonResponse({ ok: false, error: "Invalid price" });

      const organizerId = eventRow.creator_id ? String(eventRow.creator_id) : "";
      if (!organizerId) return jsonResponse({ ok: false, error: "Organizer not found" });

      const org = await restGet(
        SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY,
        `profiles?id=eq.${encodeURIComponent(organizerId)}&select=stripe_account_id,stripe_charges_enabled`,
      );
      const organizerProfile = Array.isArray(org.json) && org.json.length ? org.json[0] : null;
      const rawStripeAccountId = organizerProfile?.stripe_account_id ? String(organizerProfile.stripe_account_id) : "";
      let hasConnect = !!rawStripeAccountId && Boolean(organizerProfile?.stripe_charges_enabled);

      if (hasConnect) {
        const exists = await stripeGetAccount(rawStripeAccountId);
        if (!exists) hasConnect = false;
      }

      if (!hasConnect && requireOrganizerConnect) {
        return jsonResponse({
          ok: false,
          error:
            rawStripeAccountId
              ? `Stripe Connect inválido o en otro modo (test/live). Re-vincula Stripe del organizador. (acct=${rawStripeAccountId})`
              : "El organizador debe vincular Stripe para poder cobrar.",
        });
      }

      const vipPlatformFeeCents = vipEclipseCommissionCents;
      const destinationAmountCents = hasConnect ? (amountCents - vipApplicationFeeAmountCents) : 0;

      const intentParams: Record<string, string> = {
        amount: String(amountCents),
        currency: "eur",
        "automatic_payment_methods[enabled]": "true",
        description: `VIP reservado - ${vipId}`,
        "metadata[kind]": "vip_table",
        "metadata[user_id]": userId,
        "metadata[event_id]": eventId,
        "metadata[reference_id]": vipId,
        "metadata[vip_reservado_id]": vipId,
        "metadata[original_total_cents]": String(vipOriginalCents),
        "metadata[service_fee_cents]": String(vipStripePassthroughCents),
        "metadata[eclipse_commission_cents]": String(vipEclipseCommissionCents),
        "metadata[credit_debit_cents]": String(creditDebitCents),
      };
      if (hasConnect) {
        intentParams["transfer_data[destination]"] = rawStripeAccountId;
        intentParams.application_fee_amount = String(vipApplicationFeeAmountCents);
      }

      let intent;
      try {
        intentParams["metadata[idempotency_key]"] = idempotencyKey;
        intent = await stripeCreatePaymentIntent(intentParams, idempotencyKey);
      } catch (e: any) {
        const message = String(e?.message || e || "");
        if (hasConnect && isStripeConnectPlatformError(message)) {
          let platformId = "desconocido";
          try {
            const platform = await stripeGetPlatformAccount();
            platformId = platform?.id || platformId;
          } catch {}
          return jsonResponse({
            ok: false,
            error:
              "Stripe Connect no está habilitado en tu cuenta plataforma o estás usando una STRIPE_SECRET_KEY que no pertenece a una Connect platform. " +
              "Ve a Stripe Dashboard → Settings → Connect y habilítalo (y asegúrate de usar la clave secreta de ESA cuenta plataforma). " +
              `Cuenta plataforma detectada: ${platformId}. Error: ${message}`,
          });
        }
        if (hasConnect && isStripeNoSuchDestinationError(message)) {
          return jsonResponse({
            ok: false,
            error:
              `Stripe Connect destination inválido: ${rawStripeAccountId}. ` +
              "Esto suele pasar por mezcla test/live o porque el acct fue desconectado/borrado. " +
              `Re-vincula Stripe del organizador. Error: ${message}`,
          });
        }
        throw e;
      }

      const buyerName = typeof body?.buyer_name === "string" ? body.buyer_name : "";
      const buyerEmail = typeof body?.buyer_email === "string" ? body.buyer_email : "";

      const metadata = {
        event_id: eventId,
        vip_reservado_id: vipId,
        reference_id: vipId,
        buyer_name: buyerName,
        buyer_email: buyerEmail,
        original_total_cents: vipOriginalCents,
        service_fee_cents: vipStripePassthroughCents,
        eclipse_commission_cents: vipEclipseCommissionCents,
        credit_debit_cents: creditDebitCents,
        event_title: String(eventRow.title || ""),
        vip_name: String(vip.name || ""),
        platform_fee_cents: vipPlatformFeeCents,
        destination_amount_cents: destinationAmountCents,
      };

      const txInsert = await restPost(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, "payment_transactions", {
        user_id: userId,
        kind: "vip_table",
        amount_cents: intent.amount,
        currency: intent.currency,
        stripe_payment_intent_id: intent.id,
        status: "created",
        platform_fee_cents: vipPlatformFeeCents,
        destination_account_id: hasConnect ? rawStripeAccountId : null,
        destination_amount_cents: hasConnect ? destinationAmountCents : 0,
        commission_bps: vipEclipseRateBps,
        idempotency_key: idempotencyKey,
        metadata,
      });

      if (!txInsert.ok || !Array.isArray(txInsert.json) || txInsert.json.length === 0) {
        return jsonResponse({ ok: false, error: "Failed to store transaction" });
      }

      return jsonResponse({
        ok: true,
        client_secret: intent.client_secret,
        payment_intent_id: intent.id,
        amount_cents: intent.amount,
        ticket_amount_cents: vipOriginalCents,
        service_fee_cents: vipStripePassthroughCents,
        currency: intent.currency,
        transaction_id: String(txInsert.json[0]?.id || ""),
        stripe_mode: getStripeMode(),
        stripe_platform_account_id: await getStripePlatformAccountIdSafe(),
      });
    }

    return jsonResponse({ ok: false, error: "Not implemented" });
  } catch (e: any) {
    return jsonResponse({ ok: false, error: `create-payment-intent: ${e?.message || "Internal error"}` });
  }
});
