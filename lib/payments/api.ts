import { checkoutUnavailableReason } from '@/lib/launchFeatures';
import { Platform } from 'react-native';
import { supabase } from '@/lib/supabase';
import type {
  ConfirmPaymentRequest,
  ConfirmPaymentResponse,
  CreatePaymentIntentRequest,
  CreatePaymentIntentResponse,
  CreateStripeConnectAccountResponse,
  CreateStripeConnectOnboardingLinkRequest,
  CreateStripeConnectOnboardingLinkResponse,
  StripeConnectAccountStatus,
} from './types';

async function getValidSession() {
  const { data: sessionData } = await supabase.auth.getSession();
  if (sessionData?.session?.access_token) return sessionData.session;

  const { data: refreshed, error } = await supabase.auth.refreshSession();
  if (error) {
    throw new Error('Sesión perdida: no se pudo refrescar la sesión. Inicia sesión de nuevo.');
  }
  if (refreshed?.session?.access_token) return refreshed.session;

  throw new Error('Sesión perdida: no hay access_token. Inicia sesión de nuevo.');
}

async function invokeEdgeFunction<T>(functionName: string, body: any): Promise<{ data: T | null; error: any }> {
  const supabaseUrl = String(process.env.EXPO_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
  const anonKey = String(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '');
  if (!supabaseUrl || !anonKey) {
    return { data: null, error: { message: 'Falta EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY.' } };
  }

  let session;
  try {
    session = await getValidSession();
  } catch (e: any) {
    return { data: null, error: { message: String(e?.message || e) } };
  }

  const url = `${supabaseUrl}/functions/v1/${functionName}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
      apikey: anonKey,
    },
    body: JSON.stringify(body ?? {}),
  });

  const text = await res.text().catch(() => '');
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  if (!res.ok) {
    const message = String(json?.error || json?.message || text || `HTTP ${res.status}`);
    return { data: null, error: { ...(json && typeof json === 'object' ? json : {}), message, status: res.status } };
  }

  if (json && typeof json === 'object' && (json as any).ok === false) {
    const message = String((json as any).error || (json as any).message || 'Edge Function error');
    return { data: null, error: { ...(json as any), message, status: res.status } };
  }

  return { data: (json as T) ?? ({} as T), error: null };
}

async function getEdgeFunctionErrorMessage(error: any, fallback: string): Promise<string> {
  // If error is a string, check if it's JSON
  if (typeof error === 'string') {
    try {
      const parsed = JSON.parse(error);
      if (parsed.message) return parsed.message;
      if (parsed.error) return parsed.error;
    } catch {}
    return error;
  }

  const base = typeof error?.message === 'string' && error.message.trim() ? error.message.trim() : '';
  
  // Robust check for Supabase Functions error structure
  if (base) {
    try {
      // Sometimes message is a stringified JSON: "[FunctionsError: {"code":401,...}]"
      const jsonMatch = base.match(/\{.*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.message) return parsed.message;
      }
    } catch {}
  }
  const ctx = error?.context;
  const response = ctx?.response && typeof ctx.response === 'object' ? ctx.response : ctx;

  const extractFromUnknown = (value: unknown): string => {
    if (typeof value === 'string' && value.trim()) {
      const raw = value.trim();
      try {
        const parsed = JSON.parse(raw);
        const msg = (parsed as any)?.error;
        if (typeof msg === 'string' && msg.trim()) return msg.trim();
      } catch {}
      return raw;
    }

    if (value && typeof value === 'object') {
      const msg = (value as any)?.error;
      if (typeof msg === 'string' && msg.trim()) return msg.trim();
      const msg2 = (value as any)?.message;
      if (typeof msg2 === 'string' && msg2.trim()) return msg2.trim();
    }

    return '';
  };

  if (response && (typeof response.json === 'function' || typeof response.text === 'function')) {
    try {
      const r = typeof response.clone === 'function' ? response.clone() : response;
      if (typeof r.json === 'function') {
        const data = await r.json();
        const extracted = extractFromUnknown(data);
        if (extracted) return extracted;
      }
      if (typeof r.text === 'function') {
        const text = await r.text();
        const extracted = extractFromUnknown(text);
        if (extracted) return extracted;
      }
      if (base) return base;
      return fallback;
    } catch {
      try {
        const r = typeof response.clone === 'function' ? response.clone() : response;
        if (typeof r.text === 'function') {
          const text = await r.text();
          const extracted = extractFromUnknown(text);
          if (extracted) return extracted;
        }
      } catch {}

      const extracted =
        extractFromUnknown(error?.details) ||
        extractFromUnknown(error?.cause) ||
        extractFromUnknown(ctx?.data) ||
        extractFromUnknown(ctx?.body);
      if (extracted) return extracted;

      if (base) return base;
      return fallback;
    }
  }

  {
    const extracted =
      extractFromUnknown(error?.details) ||
      extractFromUnknown(error?.cause) ||
      extractFromUnknown(ctx?.data) ||
      extractFromUnknown(ctx?.body) ||
      extractFromUnknown(ctx);
    if (extracted) return extracted;
  }

  if (base.includes('Edge Function returned a non-2xx status code')) {
    return 'Error del servidor (Edge Function). Revisa los logs de Supabase Functions para ver el motivo exacto.';
  }

  if (base) return base;
  return fallback;
}

function isInvalidJwtMessage(message: string): boolean {
  const msg = String(message || '').toLowerCase();
  return (
    msg.includes('invalid jwt') ||
    msg.includes('jwt expired') ||
    msg.includes('invalid signature') ||
    msg.includes('jwt is required') ||
    msg.includes('missing authorization') ||
    msg.includes('authorization header') ||
    msg.includes('401') ||
    msg.includes('unauthorized')
  );
}

function getUrlHost(value: string): string {
  try {
    return new URL(value).host;
  } catch {
    return '';
  }
}

async function invokeAuthed<T>(functionName: string, body: any): Promise<{ data: T | null; error: any }> {
  const r = await invokeEdgeFunction<T>(functionName, body ?? {});
  if (r.error) return { data: null, error: r.error };
  return { data: r.data as T, error: null };
}

async function invokeWithJwtRecovery<T>(functionName: string, body: any): Promise<{ data: T | null; error: any }> {
  const first = await invokeAuthed<T>(functionName, body);
  
  if (!first.error) {
    return first as any;
  }

  const firstMsg = String(first?.error?.message || '');
  const firstDetails = await getEdgeFunctionErrorMessage(first.error, '');
  const combinedFirst = `${firstMsg} ${firstDetails}`.trim();
  
  if (!isInvalidJwtMessage(combinedFirst)) {
    return first as any;
  }

  try {
    const { error: refreshError } = await supabase.auth.refreshSession();
    if (refreshError) {
      return first as any;
    }
  } catch {
    return first as any;
  }

  const second = await invokeAuthed<T>(functionName, body);
  
  if (second.error) {
    const secondMsg = String(second?.error?.message || '');
    const secondDetails = await getEdgeFunctionErrorMessage(second.error, '');
    const combinedSecond = `${secondMsg} ${secondDetails}`.trim();
    if (isInvalidJwtMessage(combinedSecond)) {
      try {
        await supabase.auth.signOut({ scope: 'local' } as any);
      } catch {}
    }
  }

  return second as any;
}

export async function createPaymentIntent(req: CreatePaymentIntentRequest): Promise<CreatePaymentIntentResponse> {
  const unavailable = checkoutUnavailableReason(req);
  if (unavailable) throw new Error(unavailable);
  if (Platform.OS === 'web') {
    throw new Error('Las compras están disponibles en la app para iOS y Android.');
  }

  // One key per checkout attempt. The same object is reused by the JWT retry path,
  // so network/auth retries cannot create a second Stripe PaymentIntent.
  const request = {
    ...req,
    idempotency_key:
      req.idempotency_key ||
      `eclipse_${Date.now()}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`,
  };
  const { data, error } = await invokeWithJwtRecovery<CreatePaymentIntentResponse>('create-payment-intent-v2', request);

  if (error) {
    const msg = String(error?.message || '');
    if (msg.includes('Requested function was not found')) {
      throw new Error(
        'No existe la Edge Function "create-payment-intent-v2" en este proyecto de Supabase. Despliégala (supabase functions deploy create-payment-intent-v2) o verifica que EXPO_PUBLIC_SUPABASE_URL apunta al proyecto correcto.'
      );
    }
    const extracted = await getEdgeFunctionErrorMessage(error, 'Failed to create payment intent.');
    if (isInvalidJwtMessage(`${msg} ${extracted}`)) {
      const supabaseHost = getUrlHost(String(process.env.EXPO_PUBLIC_SUPABASE_URL || ''));
      const sentAuthorization = Boolean((error as any)?.context?.sentAuthorization);
      const sentIssuerHost = String((error as any)?.context?.sentIssuerHost || '');
      const jwtHostLabel = sentIssuerHost || (sentAuthorization ? 'desconocido' : '');
      const mismatchHint =
        jwtHostLabel || supabaseHost
          ? ` (JWT=${jwtHostLabel || 'desconocido'}; app=${supabaseHost || 'desconocido'})`
          : '';
      if (!sentAuthorization) {
        throw new Error(
          `No se pudo obtener tu sesión de autenticación (access_token).${mismatchHint} Reinicia la app o reinicia Expo con caché limpia (npx expo start -c) e inténtalo de nuevo.`
        );
      }
      try {
        await supabase.auth.signOut();
      } catch {}
      throw new Error(
        `Tu sesión no es válida. Cierra sesión e inicia sesión de nuevo.${mismatchHint} Si persiste, reinicia Expo con caché limpia (npx expo start -c) y verifica que las Functions están en el mismo proyecto de Supabase.`
      );
    }
    throw new Error(extracted);
  }

  return data as CreatePaymentIntentResponse;
}

export async function confirmPayment(req: ConfirmPaymentRequest): Promise<ConfirmPaymentResponse> {
  if (Platform.OS === 'web') {
    throw new Error('Las compras están disponibles en la app para iOS y Android.');
  }

  const { data, error } = await invokeWithJwtRecovery<ConfirmPaymentResponse>('confirm-payment', req);

  if (error) {
    const msg = String(error?.message || '');
    if (msg.includes('Requested function was not found')) {
      throw new Error(
        'No existe la Edge Function "confirm-payment" en este proyecto de Supabase. Despliégala (supabase functions deploy confirm-payment) o verifica que EXPO_PUBLIC_SUPABASE_URL apunta al proyecto correcto.'
      );
    }
    const extracted = await getEdgeFunctionErrorMessage(error, 'Failed to confirm payment.');
    if (isInvalidJwtMessage(`${msg} ${extracted}`)) {
      const supabaseHost = getUrlHost(String(process.env.EXPO_PUBLIC_SUPABASE_URL || ''));
      const sentAuthorization = Boolean((error as any)?.context?.sentAuthorization);
      const sentIssuerHost = String((error as any)?.context?.sentIssuerHost || '');
      const jwtHostLabel = sentIssuerHost || (sentAuthorization ? 'desconocido' : '');
      const mismatchHint =
        jwtHostLabel || supabaseHost
          ? ` (JWT=${jwtHostLabel || 'desconocido'}; app=${supabaseHost || 'desconocido'})`
          : '';
      if (!sentAuthorization) {
        throw new Error(
          `No se pudo obtener tu sesión de autenticación (access_token).${mismatchHint} Reinicia la app o reinicia Expo con caché limpia (npx expo start -c) e inténtalo de nuevo.`
        );
      }
      try {
        await supabase.auth.signOut();
      } catch {}
      throw new Error(
        `Tu sesión no es válida. Cierra sesión e inicia sesión de nuevo.${mismatchHint} Si persiste, reinicia Expo con caché limpia (npx expo start -c) y verifica que las Functions están en el mismo proyecto de Supabase.`
      );
    }
    throw new Error(extracted);
  }

  return data as ConfirmPaymentResponse;
}

export async function createStripeConnectAccount(): Promise<CreateStripeConnectAccountResponse> {
  const { data, error } = await invokeWithJwtRecovery<CreateStripeConnectAccountResponse>('stripe-connect-create-account', {});
  if (error) {
    throw new Error(await getEdgeFunctionErrorMessage(error, 'Failed to create Stripe Connect account.'));
  }
  return data as CreateStripeConnectAccountResponse;
}

export async function createStripeConnectOnboardingLink(
  req: CreateStripeConnectOnboardingLinkRequest
): Promise<CreateStripeConnectOnboardingLinkResponse> {
  const { data, error } = await invokeWithJwtRecovery<CreateStripeConnectOnboardingLinkResponse>('stripe-connect-onboarding-link', req);
  if (error) throw new Error(await getEdgeFunctionErrorMessage(error, 'Failed to create onboarding link.'));
  return data as CreateStripeConnectOnboardingLinkResponse;
}

export async function refreshStripeConnectStatus(): Promise<StripeConnectAccountStatus> {
  const { data, error } = await invokeWithJwtRecovery<StripeConnectAccountStatus>('stripe-connect-refresh-status', {});
  if (error) throw new Error(await getEdgeFunctionErrorMessage(error, 'Failed to refresh Stripe status.'));
  return data as StripeConnectAccountStatus;
}

export interface StripeAccountStats {
  available_balance: number;
  pending_balance: number;
  revenue_30d: number;
  currency: string;
  charges_count: number;
}

export async function getStripeAccountStats(): Promise<StripeAccountStats> {
  const { data, error } = await invokeWithJwtRecovery<StripeAccountStats>('stripe-get-account-stats', {});
  if (error) throw new Error(await getEdgeFunctionErrorMessage(error, 'Failed to get Stripe stats.'));
  return data as StripeAccountStats;
}

