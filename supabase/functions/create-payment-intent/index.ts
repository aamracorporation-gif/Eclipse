import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

type Json = Record<string, unknown>;

type CreatePaymentIntentRequest =
  | {
      kind: "event_ticket";
      event_id: string;
      ticket_type_id?: string | null;
      quantity: number;
      buyer_name?: string;
      buyer_email?: string;
    }
  | {
      kind: "resale_ticket";
      listing_id: string;
    }
  | {
      kind: "vip_table";
      reference_id: string;
    }
  | {
      kind: "premium_feature";
      reference_id: string;
    };

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

function toInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && value.trim() && !Number.isNaN(Number(value))) return Math.trunc(Number(value));
  return null;
}

function getCommissionBps(): number {
  const raw = (Deno.env.get("STRIPE_PLATFORM_FEE_BPS") ?? "").trim();
  const parsed = raw ? Number(raw) : 1000;
  if (!Number.isFinite(parsed)) return 1000;
  const bps = Math.trunc(parsed);
  if (bps < 0) return 0;
  if (bps > 10000) return 10000;
  return bps;
}

function computeFeeCents(amountCents: number, bps: number): number {
  const fee = Math.round((amountCents * bps) / 10000);
  if (!Number.isFinite(fee)) return 0;
  if (fee < 0) return 0;
  if (fee > amountCents) return amountCents;
  return fee;
}

function isMissingColumnError(error: unknown): boolean {
  const code = (error as any)?.code;
  if (code === "42703") return true;
  const msg = (error as any)?.message;
  return typeof msg === "string" && msg.includes("does not exist");
}

async function insertPaymentTransactionWithFallback(
  serviceClient: any,
  fullRow: Record<string, unknown>,
  fallbackRow: Record<string, unknown>,
) {
  const first = await serviceClient
    .from("payment_transactions")
    .insert(fullRow)
    .select("id")
    .single();

  if (first?.error && isMissingColumnError(first.error)) {
    return await serviceClient
      .from("payment_transactions")
      .insert(fallbackRow)
      .select("id")
      .single();
  }

  return first;
}

function getStripeSecretKey(): string {
  const key = (Deno.env.get("STRIPE_SECRET_KEY") ?? "").trim();
  if (!key) throw new Error("Missing STRIPE_SECRET_KEY");
  if (key.includes("TU_CLAVE") || !(key.startsWith("sk_") || key.startsWith("rk_"))) {
    throw new Error("Stripe no configurado: STRIPE_SECRET_KEY inválida");
  }
  if (/\s/.test(key)) {
    throw new Error("Stripe no configurado: STRIPE_SECRET_KEY contiene espacios o saltos de línea");
  }
  if (/[^\x21-\x7E]/.test(key)) {
    throw new Error("Stripe no configurado: STRIPE_SECRET_KEY contiene caracteres no válidos");
  }
  return key;
}

async function stripeCreatePaymentIntent(params: Record<string, string>) {
  const STRIPE_SECRET_KEY = getStripeSecretKey();

  const res = await fetch("https://api.stripe.com/v1/payment_intents", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(params),
  });

  const data = await res.json();
  if (!res.ok) {
    const msg = (data as any)?.error?.message || "Stripe error";
    if (typeof msg === "string" && msg.toLowerCase().includes("you did not provide an api key")) {
      throw new Error("Stripe no configurado: falta STRIPE_SECRET_KEY válida en Supabase Secrets");
    }
    throw new Error(msg);
  }

  return data as { id: string; client_secret: string; amount: number; currency: string };
}

serve(async (req) => {
  try {
    if (req.method === "OPTIONS") return jsonResponse({ ok: true });
    if (req.method !== "POST") return jsonResponse({ ok: false, error: "Method not allowed" }, 405);

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
      return jsonResponse({ ok: false, error: "Missing Supabase env vars" }, 500);
    }

    const authHeader = req.headers.get("Authorization") || "";
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: authHeader ? { headers: { Authorization: authHeader } } : undefined,
    });
    const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const requireOrganizerConnect = (Deno.env.get("REQUIRE_ORGANIZER_STRIPE_CONNECT") ?? "").trim().toLowerCase() === "true";

    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData?.user) {
      return jsonResponse({ ok: false, error: userError?.message || "Unauthorized" }, 401);
    }

    let body: CreatePaymentIntentRequest;
    try {
      body = (await req.json()) as CreatePaymentIntentRequest;
    } catch {
      return jsonResponse({ ok: false, error: "Invalid JSON" }, 400);
    }

    const userId = userData.user.id;
    const kind = (body as any)?.kind;
    if (
      kind !== "event_ticket" &&
      kind !== "resale_ticket" &&
      kind !== "vip_table" &&
      kind !== "premium_feature"
    ) {
      return jsonResponse({ ok: false, error: "Invalid kind" }, 400);
    }

    try {
    if (kind === "event_ticket") {
      const eventId = (body as any).event_id as string;
      const ticketTypeId = ((body as any).ticket_type_id ?? null) as string | null;
      const quantity = toInt((body as any).quantity) ?? 0;

      if (!eventId || quantity < 1 || quantity > 10) {
        return jsonResponse({ ok: false, error: "Invalid request" }, 400);
      }

      const { data: eventRow, error: eventError } = await serviceClient
        .from("events")
        .select("id, creator_id, ticket_price, available_tickets, event_date, event_ticket_types ( id, price, quantity, sold )")
        .eq("id", eventId)
        .maybeSingle();

      if (eventError || !eventRow) return jsonResponse({ ok: false, error: "Event not found" }, 404);

      if (new Date((eventRow as any).event_date) < new Date()) {
        return jsonResponse({ ok: false, error: "Este evento ya ha finalizado. No es posible comprar entradas." }, 400);
      }

      const buyer_email = typeof (body as any).buyer_email === "string" ? (body as any).buyer_email : "";
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (buyer_email && !emailRegex.test(buyer_email)) {
        return jsonResponse({ ok: false, error: "El formato del email no es válido." }, 400);
      }

      if ((eventRow as any).available_tickets < quantity) {
        return jsonResponse({ ok: false, error: "Not enough tickets available" }, 409);
      }

      let price = (eventRow as any).ticket_price as number;
      if (ticketTypeId) {
        const types = (eventRow as any).event_ticket_types as any[] | null;
        const selected = (types || []).find((t) => t.id === ticketTypeId);
        if (!selected) return jsonResponse({ ok: false, error: "Ticket type not found" }, 404);
        const available = (selected.quantity as number) - ((selected.sold as number) || 0);
        if (available < quantity) return jsonResponse({ ok: false, error: "Ticket type sold out" }, 409);
        price = selected.price as number;
      }

      const originalTotalCents = Math.round(price * 100) * quantity;
      if (!Number.isFinite(originalTotalCents) || originalTotalCents <= 0) {
        return jsonResponse({ ok: false, error: "Invalid price" }, 400);
      }

      const walletDebitRaw = (body as any).wallet_debit_eur;
      let walletDebitCents = 0;
      if (typeof walletDebitRaw === "number" && Number.isFinite(walletDebitRaw)) {
        walletDebitCents = Math.round(walletDebitRaw * 100);
      } else if (typeof walletDebitRaw === "string" && walletDebitRaw.trim()) {
        const n = Number(walletDebitRaw);
        if (Number.isFinite(n)) walletDebitCents = Math.round(n * 100);
      }
      if (!Number.isFinite(walletDebitCents) || walletDebitCents < 0) walletDebitCents = 0;
      if (walletDebitCents > originalTotalCents) walletDebitCents = originalTotalCents;

      const amountCents = originalTotalCents - walletDebitCents;
      if (!Number.isFinite(amountCents) || amountCents <= 0) return jsonResponse({ ok: false, error: "Invalid price" }, 400);

      const organizerId = (eventRow as any).creator_id as string | null;
      if (!organizerId) return jsonResponse({ ok: false, error: "Organizer not found" }, 409);

      const { data: organizerProfile, error: organizerError } = await serviceClient
        .from("profiles")
        .select("stripe_account_id, stripe_charges_enabled")
        .eq("id", organizerId)
        .maybeSingle();

      if (organizerError) {
        if (isMissingColumnError(organizerError)) {
          return jsonResponse(
            { ok: false, error: "Stripe Connect no está configurado en la base de datos (faltan columnas)." },
            409,
          );
        }
        return jsonResponse({ ok: false, error: "Failed to load organizer" }, 500);
      }
      const hasConnect =
        !!organizerProfile?.stripe_account_id && Boolean((organizerProfile as any).stripe_charges_enabled);
      if (!hasConnect && requireOrganizerConnect) {
        return jsonResponse({ ok: false, error: "El organizador debe vincular Stripe para poder cobrar." }, 409);
      }

      const commissionBps = getCommissionBps();
      const platformFeeCents = hasConnect ? computeFeeCents(amountCents, commissionBps) : 0;
      const destinationAmountCents = hasConnect ? amountCents - platformFeeCents : 0;

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
        "metadata[wallet_debit_cents]": String(walletDebitCents),
      };

      if (hasConnect) {
        intentParams["transfer_data[destination]"] = organizerProfile!.stripe_account_id as string;
        if (platformFeeCents > 0) {
          intentParams.application_fee_amount = String(platformFeeCents);
        }
      }

      const intent = await stripeCreatePaymentIntent(intentParams);

      const buyerName = typeof (body as any).buyer_name === "string" ? (body as any).buyer_name : "";
      const buyerEmail = typeof (body as any).buyer_email === "string" ? (body as any).buyer_email : "";

      const txFullRow = {
        user_id: userId,
        kind: "event_ticket",
        amount_cents: intent.amount,
        currency: intent.currency,
        stripe_payment_intent_id: intent.id,
        status: "created",
        platform_fee_cents: platformFeeCents,
        destination_account_id: hasConnect ? organizerProfile!.stripe_account_id : null,
        destination_amount_cents: destinationAmountCents,
        commission_bps: hasConnect ? commissionBps : 0,
        metadata: {
          event_id: eventId,
          ticket_type_id: ticketTypeId ?? "",
          quantity,
          buyer_name: buyerName,
          buyer_email: buyerEmail,
          original_total_cents: originalTotalCents,
          wallet_debit_cents: walletDebitCents,
        },
      };

      const txFallbackRow = {
        user_id: userId,
        kind: "event_ticket",
        amount_cents: intent.amount,
        currency: intent.currency,
        stripe_payment_intent_id: intent.id,
        status: "created",
        metadata: {
          event_id: eventId,
          ticket_type_id: ticketTypeId ?? "",
          quantity,
          buyer_name: buyerName,
          buyer_email: buyerEmail,
          original_total_cents: originalTotalCents,
          wallet_debit_cents: walletDebitCents,
        },
      };

      const { data: tx, error: txError } = await insertPaymentTransactionWithFallback(
        serviceClient,
        txFullRow,
        txFallbackRow,
      );

      if (txError) return jsonResponse({ ok: false, error: "Failed to store transaction" }, 500);

      return jsonResponse({
        client_secret: intent.client_secret,
        payment_intent_id: intent.id,
        amount_cents: intent.amount,
        currency: intent.currency,
        transaction_id: (tx as any).id,
      });
    }

    if (kind === "resale_ticket") {
      const listingId = (body as any).listing_id as string;
      if (!listingId) return jsonResponse({ ok: false, error: "Invalid request" }, 400);

      const { data: listing, error: listingError } = await serviceClient
        .from("resale_listings")
        .select("id, price, seller_id, status, ticket_id, tickets ( total_price )")
        .eq("id", listingId)
        .maybeSingle();

      if (listingError || !listing) return jsonResponse({ ok: false, error: "Listing not found" }, 404);
      if ((listing as any).status !== "active") return jsonResponse({ ok: false, error: "Listing not active" }, 409);
      if ((listing as any).seller_id === userId) return jsonResponse({ ok: false, error: "Cannot buy your own ticket" }, 400);

      const price = (listing as any).price as number;
      const original = ((listing as any).tickets?.total_price as number | undefined) ?? price;
      if (price > original) return jsonResponse({ ok: false, error: "Invalid resale price" }, 400);

      const amountCents = Math.round(price * 100);
      if (!Number.isFinite(amountCents) || amountCents <= 0) return jsonResponse({ ok: false, error: "Invalid price" }, 400);

      const commissionBps = 1200;
      const platformFeeCents = computeFeeCents(amountCents, commissionBps);
      const destinationAmountCents = amountCents - platformFeeCents;

      const intent = await stripeCreatePaymentIntent({
        amount: String(amountCents),
        currency: "eur",
        "automatic_payment_methods[enabled]": "true",
        description: `Resale ticket - ${listingId}`,
        "metadata[kind]": "resale_ticket",
        "metadata[user_id]": userId,
        "metadata[listing_id]": listingId,
      });

      const txFullRow = {
        user_id: userId,
        kind: "resale_ticket",
        amount_cents: intent.amount,
        currency: intent.currency,
        stripe_payment_intent_id: intent.id,
        status: "created",
        platform_fee_cents: platformFeeCents,
        destination_account_id: null,
        destination_amount_cents: destinationAmountCents,
        commission_bps: commissionBps,
        metadata: {
          listing_id: listingId,
        },
      };

      const txFallbackRow = {
        user_id: userId,
        kind: "resale_ticket",
        amount_cents: intent.amount,
        currency: intent.currency,
        stripe_payment_intent_id: intent.id,
        status: "created",
        metadata: {
          listing_id: listingId,
        },
      };

      const { data: tx, error: txError } = await insertPaymentTransactionWithFallback(
        serviceClient,
        txFullRow,
        txFallbackRow,
      );

      if (txError) return jsonResponse({ ok: false, error: "Failed to store transaction" }, 500);

      return jsonResponse({
        client_secret: intent.client_secret,
        payment_intent_id: intent.id,
        amount_cents: intent.amount,
        currency: intent.currency,
        transaction_id: (tx as any).id,
      });
    }

    const referenceId = (body as any).reference_id as string;
    if (!referenceId) return jsonResponse({ ok: false, error: "Invalid request" }, 400);

    if (kind === "vip_table") {
      const { data: product, error: productError } = await serviceClient
        .from("paid_products")
        .select("id, kind, price_cents, currency, active, metadata")
        .eq("id", referenceId)
        .maybeSingle();

      if (!productError && product) {
        if (!(product as any).active) return jsonResponse({ ok: false, error: "Product not active" }, 409);
        if ((product as any).kind !== kind) return jsonResponse({ ok: false, error: "Product kind mismatch" }, 400);

        const originalTotalCents = toInt((product as any).price_cents) ?? 0;
        if (originalTotalCents <= 0) return jsonResponse({ ok: false, error: "Invalid price" }, 400);

        const walletDebitRaw = (body as any).wallet_debit_eur;
        let walletDebitCents = 0;
        if (typeof walletDebitRaw === "number" && Number.isFinite(walletDebitRaw)) {
          walletDebitCents = Math.round(walletDebitRaw * 100);
        } else if (typeof walletDebitRaw === "string" && walletDebitRaw.trim()) {
          const n = Number(walletDebitRaw);
          if (Number.isFinite(n)) walletDebitCents = Math.round(n * 100);
        }
        if (!Number.isFinite(walletDebitCents) || walletDebitCents < 0) walletDebitCents = 0;
        if (walletDebitCents > originalTotalCents) walletDebitCents = originalTotalCents;

        const amountCents = originalTotalCents - walletDebitCents;
        if (amountCents <= 0) return jsonResponse({ ok: false, error: "Invalid price" }, 400);

        const currency = ((product as any).currency || "eur") as string;
        const metadata = ((product as any).metadata ?? {}) as Record<string, unknown>;

        let destinationAccountId: string | null = null;
        const commissionBps = getCommissionBps();
        const platformFeeCents = computeFeeCents(amountCents, commissionBps);
        const destinationAmountCents = amountCents - platformFeeCents;

        const metadataOrganizerId =
          typeof (metadata as any).organizer_id === "string" ? ((metadata as any).organizer_id as string) : null;
        const metadataEventId = typeof (metadata as any).event_id === "string" ? ((metadata as any).event_id as string) : null;

        if (metadataOrganizerId || metadataEventId) {
          let organizerId: string | null = metadataOrganizerId;
          if (!organizerId && metadataEventId) {
            const { data: e, error: eErr } = await serviceClient
              .from("events")
              .select("creator_id")
              .eq("id", metadataEventId)
              .maybeSingle();
            if (eErr) return jsonResponse({ ok: false, error: "Failed to load event" }, 500);
            organizerId = (e as any)?.creator_id ?? null;
          }

          if (organizerId) {
            const { data: org, error: orgErr } = await serviceClient
              .from("profiles")
              .select("stripe_account_id, stripe_charges_enabled")
              .eq("id", organizerId)
              .maybeSingle();
            if (orgErr) {
              if (isMissingColumnError(orgErr)) {
                return jsonResponse(
                  { ok: false, error: "Stripe Connect no está configurado en la base de datos (faltan columnas)." },
                  409,
                );
              }
              return jsonResponse({ ok: false, error: "Failed to load organizer" }, 500);
            }
            if (!org?.stripe_account_id || !(org as any).stripe_charges_enabled) {
              return jsonResponse({ ok: false, error: "El organizador debe vincular Stripe para poder cobrar." }, 409);
            }
            destinationAccountId = org.stripe_account_id;
          }
        }

        if (!destinationAccountId) {
          return jsonResponse({ ok: false, error: "Missing organizer destination for product" }, 409);
        }

        const intent = await stripeCreatePaymentIntent({
          amount: String(amountCents),
          currency,
          "automatic_payment_methods[enabled]": "true",
          ...(platformFeeCents > 0 ? { application_fee_amount: String(platformFeeCents) } : {}),
          "transfer_data[destination]": destinationAccountId,
          description: `Product - ${kind} - ${referenceId}`,
          "metadata[kind]": kind,
          "metadata[user_id]": userId,
          "metadata[reference_id]": referenceId,
          "metadata[original_total_cents]": String(originalTotalCents),
          "metadata[wallet_debit_cents]": String(walletDebitCents),
        });

        const txFullRow = {
          user_id: userId,
          kind,
          amount_cents: intent.amount,
          currency: intent.currency,
          stripe_payment_intent_id: intent.id,
          status: "created",
          platform_fee_cents: platformFeeCents,
          destination_account_id: destinationAccountId,
          destination_amount_cents: destinationAmountCents,
          commission_bps: commissionBps,
          metadata: {
            reference_id: referenceId,
            original_total_cents: originalTotalCents,
            wallet_debit_cents: walletDebitCents,
          },
        };

        const txFallbackRow = {
          user_id: userId,
          kind,
          amount_cents: intent.amount,
          currency: intent.currency,
          stripe_payment_intent_id: intent.id,
          status: "created",
          metadata: {
            reference_id: referenceId,
            original_total_cents: originalTotalCents,
            wallet_debit_cents: walletDebitCents,
          },
        };

        const { data: tx, error: txError } = await insertPaymentTransactionWithFallback(
          serviceClient,
          txFullRow,
          txFallbackRow,
        );

        if (txError) return jsonResponse({ ok: false, error: "Failed to store transaction" }, 500);

        return jsonResponse({
          client_secret: intent.client_secret,
          payment_intent_id: intent.id,
          amount_cents: intent.amount,
          currency: intent.currency,
          transaction_id: (tx as any).id,
        });
      }

      const { data: vip, error: vipError } = await serviceClient
        .from("reservados_vip")
        .select("id, event_id, name, base_price, quantity_available")
        .eq("id", referenceId)
        .maybeSingle();

      if (vipError || !vip) return jsonResponse({ ok: false, error: "VIP reservado no encontrado" }, 404);

      const vipAvailable = toInt((vip as any).quantity_available) ?? 0;
      if (vipAvailable < 1) return jsonResponse({ ok: false, error: "VIP agotado" }, 409);

      const vipPrice = typeof (vip as any).base_price === "number" ? ((vip as any).base_price as number) : Number((vip as any).base_price);
      const originalTotalCents = Math.round(vipPrice * 100);
      if (!Number.isFinite(originalTotalCents) || originalTotalCents <= 0) return jsonResponse({ ok: false, error: "Invalid price" }, 400);

      const walletDebitRaw = (body as any).wallet_debit_eur;
      let walletDebitCents = 0;
      if (typeof walletDebitRaw === "number" && Number.isFinite(walletDebitRaw)) {
        walletDebitCents = Math.round(walletDebitRaw * 100);
      } else if (typeof walletDebitRaw === "string" && walletDebitRaw.trim()) {
        const n = Number(walletDebitRaw);
        if (Number.isFinite(n)) walletDebitCents = Math.round(n * 100);
      }
      if (!Number.isFinite(walletDebitCents) || walletDebitCents < 0) walletDebitCents = 0;
      if (walletDebitCents > originalTotalCents) walletDebitCents = originalTotalCents;

      const amountCents = originalTotalCents - walletDebitCents;
      if (!Number.isFinite(amountCents) || amountCents <= 0) return jsonResponse({ ok: false, error: "Invalid price" }, 400);

      const eventId = (vip as any).event_id as string;
      const { data: eventRow, error: eventError } = await serviceClient
        .from("events")
        .select("creator_id")
        .eq("id", eventId)
        .maybeSingle();
      if (eventError || !eventRow) return jsonResponse({ ok: false, error: "Event not found" }, 404);

      const organizerId = (eventRow as any).creator_id as string | null;
      if (!organizerId) return jsonResponse({ ok: false, error: "Organizer not found" }, 409);

      const { data: organizerProfile, error: organizerError } = await serviceClient
        .from("profiles")
        .select("stripe_account_id, stripe_charges_enabled")
        .eq("id", organizerId)
        .maybeSingle();

      if (organizerError) {
        if (isMissingColumnError(organizerError)) {
          return jsonResponse(
            { ok: false, error: "Stripe Connect no está configurado en la base de datos (faltan columnas)." },
            409,
          );
        }
        return jsonResponse({ ok: false, error: "Failed to load organizer" }, 500);
      }

      const hasConnect = !!organizerProfile?.stripe_account_id && Boolean((organizerProfile as any).stripe_charges_enabled);
      if (!hasConnect && requireOrganizerConnect) {
        return jsonResponse({ ok: false, error: "El organizador debe vincular Stripe para poder cobrar." }, 409);
      }

      const commissionBps = getCommissionBps();
      const platformFeeCents = hasConnect ? computeFeeCents(amountCents, commissionBps) : 0;
      const destinationAmountCents = hasConnect ? amountCents - platformFeeCents : 0;

      const buyerName =
        typeof (userData.user.user_metadata as any)?.full_name === "string" ? ((userData.user.user_metadata as any).full_name as string) : "";
      const buyerEmail = userData.user.email || "";

      const intentParams: Record<string, string> = {
        amount: String(amountCents),
        currency: "eur",
        "automatic_payment_methods[enabled]": "true",
        description: `VIP reservado - ${(vip as any).name} - ${referenceId}`,
        "metadata[kind]": "vip_table",
        "metadata[user_id]": userId,
        "metadata[event_id]": eventId,
        "metadata[vip_reservado_id]": referenceId,
        "metadata[original_total_cents]": String(originalTotalCents),
        "metadata[wallet_debit_cents]": String(walletDebitCents),
      };

      if (hasConnect) {
        intentParams["transfer_data[destination]"] = organizerProfile!.stripe_account_id as string;
        if (platformFeeCents > 0) intentParams.application_fee_amount = String(platformFeeCents);
      }

      const intent = await stripeCreatePaymentIntent(intentParams);

      const txFullRow = {
        user_id: userId,
        kind: "vip_table",
        amount_cents: intent.amount,
        currency: intent.currency,
        stripe_payment_intent_id: intent.id,
        status: "created",
        platform_fee_cents: platformFeeCents,
        destination_account_id: hasConnect ? organizerProfile!.stripe_account_id : null,
        destination_amount_cents: destinationAmountCents,
        commission_bps: hasConnect ? commissionBps : 0,
        metadata: {
          vip_reservado_id: referenceId,
          event_id: eventId,
          buyer_name: buyerName,
          buyer_email: buyerEmail,
          original_total_cents: originalTotalCents,
          wallet_debit_cents: walletDebitCents,
        },
      };

      const txFallbackRow = {
        user_id: userId,
        kind: "vip_table",
        amount_cents: intent.amount,
        currency: intent.currency,
        stripe_payment_intent_id: intent.id,
        status: "created",
        metadata: {
          vip_reservado_id: referenceId,
          event_id: eventId,
          buyer_name: buyerName,
          buyer_email: buyerEmail,
          original_total_cents: originalTotalCents,
          wallet_debit_cents: walletDebitCents,
        },
      };

      const { data: tx, error: txError } = await insertPaymentTransactionWithFallback(
        serviceClient,
        txFullRow,
        txFallbackRow,
      );

      if (txError) return jsonResponse({ ok: false, error: "Failed to store transaction" }, 500);

      return jsonResponse({
        client_secret: intent.client_secret,
        payment_intent_id: intent.id,
        amount_cents: intent.amount,
        currency: intent.currency,
        transaction_id: (tx as any).id,
      });
    }

    const { data: product, error: productError } = await serviceClient
      .from("paid_products")
      .select("id, kind, price_cents, currency, active, metadata")
      .eq("id", referenceId)
      .maybeSingle();

    if (productError || !product) return jsonResponse({ ok: false, error: "Product not found" }, 404);
    if (!(product as any).active) return jsonResponse({ ok: false, error: "Product not active" }, 409);
    if ((product as any).kind !== kind) return jsonResponse({ ok: false, error: "Product kind mismatch" }, 400);

    const amountCents = toInt((product as any).price_cents) ?? 0;
    if (amountCents <= 0) return jsonResponse({ ok: false, error: "Invalid price" }, 400);

    const currency = ((product as any).currency || "eur") as string;
    const metadata = ((product as any).metadata ?? {}) as Record<string, unknown>;

    let destinationAccountId: string | null = null;
    const commissionBps = getCommissionBps();
    const platformFeeCents = computeFeeCents(amountCents, commissionBps);
    const destinationAmountCents = amountCents - platformFeeCents;

    const metadataOrganizerId = typeof (metadata as any).organizer_id === "string" ? ((metadata as any).organizer_id as string) : null;
    const metadataEventId = typeof (metadata as any).event_id === "string" ? ((metadata as any).event_id as string) : null;

    if (metadataOrganizerId || metadataEventId) {
      let organizerId: string | null = metadataOrganizerId;
      if (!organizerId && metadataEventId) {
        const { data: e, error: eErr } = await serviceClient
          .from("events")
          .select("creator_id")
          .eq("id", metadataEventId)
          .maybeSingle();
        if (eErr) return jsonResponse({ ok: false, error: "Failed to load event" }, 500);
        organizerId = (e as any)?.creator_id ?? null;
      }

      if (organizerId) {
        const { data: org, error: orgErr } = await serviceClient
          .from("profiles")
          .select("stripe_account_id, stripe_charges_enabled")
          .eq("id", organizerId)
          .maybeSingle();
        if (orgErr) {
          if (isMissingColumnError(orgErr)) {
            return jsonResponse(
              { ok: false, error: "Stripe Connect no está configurado en la base de datos (faltan columnas)." },
              409,
            );
          }
          return jsonResponse({ ok: false, error: "Failed to load organizer" }, 500);
        }
        if (!org?.stripe_account_id || !(org as any).stripe_charges_enabled) {
          return jsonResponse({ ok: false, error: "El organizador debe vincular Stripe para poder cobrar." }, 409);
        }
        destinationAccountId = org.stripe_account_id;
      }
    }

    if (!destinationAccountId) {
      return jsonResponse({ ok: false, error: "Missing organizer destination for product" }, 409);
    }

    const intent = await stripeCreatePaymentIntent({
      amount: String(amountCents),
      currency,
      "automatic_payment_methods[enabled]": "true",
      ...(platformFeeCents > 0 ? { application_fee_amount: String(platformFeeCents) } : {}),
      "transfer_data[destination]": destinationAccountId,
      description: `Product - ${kind} - ${referenceId}`,
      "metadata[kind]": kind,
      "metadata[user_id]": userId,
      "metadata[reference_id]": referenceId,
    });

    const txFullRow = {
      user_id: userId,
      kind,
      amount_cents: intent.amount,
      currency: intent.currency,
      stripe_payment_intent_id: intent.id,
      status: "created",
      platform_fee_cents: platformFeeCents,
      destination_account_id: destinationAccountId,
      destination_amount_cents: destinationAmountCents,
      commission_bps: commissionBps,
      metadata: {
        reference_id: referenceId,
      },
    };

    const txFallbackRow = {
      user_id: userId,
      kind,
      amount_cents: intent.amount,
      currency: intent.currency,
      stripe_payment_intent_id: intent.id,
      status: "created",
      metadata: {
        reference_id: referenceId,
      },
    };

    const { data: tx, error: txError } = await insertPaymentTransactionWithFallback(serviceClient, txFullRow, txFallbackRow);

    if (txError) return jsonResponse({ ok: false, error: "Failed to store transaction" }, 500);

    return jsonResponse({
      client_secret: intent.client_secret,
      payment_intent_id: intent.id,
      amount_cents: intent.amount,
      currency: intent.currency,
      transaction_id: (tx as any).id,
    });
    } catch (e) {
      const msg = (e as any)?.message || "Internal error";
      return jsonResponse({ ok: false, error: `create-payment-intent: ${msg}` }, 500);
    }
  } catch (e) {
    const msg = (e as any)?.message || "Internal error";
    return jsonResponse({ ok: false, error: `create-payment-intent: ${msg}` }, 500);
  }
});
