import { supabase } from '@/lib/supabase';

export const organizerBillingVisible = process.env.EXPO_PUBLIC_ORGANIZER_CANCELLATION_BILLING === 'true';
export type BillingPolicy = { version: string; text: string; sha256: string };
export type Collection = { id: string; amount_cents: number; commission_cents: number; stripe_costs_cents: number; status: string; residual_costs_status: string; collection_costs_cents: number | null; reconciled_total_costs_cents: number | null };
export type Cancellation = { id: string; event_id: string; status: string; reason: string; cancellation_refunds: { status: string; amount_cents: number }[]; cancellation_collections: Collection[] };
export type CostEntry = { id: string; amountCents: number; settledCents: number; reservedCents: number; outstandingCents: number; noticeAcknowledged: boolean };
export type BillingOverview = { policy: BillingPolicy; ready: boolean; cancellations: Cancellation[]; costs: CostEntry[] };

export async function organizerBillingRequest<T>(path = '', body?: unknown): Promise<T> {
  const base = String(process.env.EXPO_PUBLIC_API_URL || '').trim().replace(/\/+$/, '').replace(/\/api$/, '');
  if (!/^https:\/\//.test(base)) throw new Error('El servicio de cancelaciones todavía no está disponible.');
  const { data } = await supabase.auth.getSession();
  if (!data.session?.access_token) throw new Error('Vuelve a iniciar sesión para continuar.');
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 20000);
  try {
    const response = await fetch(`${base}/api/stripe/organizer-billing${path}`, {
      method: body === undefined ? 'GET' : 'POST', signal: abort.signal,
      headers: { Authorization: `Bearer ${data.session.access_token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'No se pudo completar la operación.');
    return result;
  } finally { clearTimeout(timeout); }
}
