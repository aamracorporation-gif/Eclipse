import { Platform } from 'react-native';
import { supabase } from '@/lib/supabase';
import { decode as decodeBase64ToArrayBuffer } from 'base64-arraybuffer';
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

function base64ToUtf8(base64: string): string {
  const atobFn = (globalThis as any)?.atob;
  if (typeof atobFn === 'function') return atobFn(base64);
  const arrayBuffer = decodeBase64ToArrayBuffer(base64);
  const bytes = new Uint8Array(arrayBuffer);
  const td = (globalThis as any)?.TextDecoder;
  if (typeof td === 'function') return new td().decode(bytes);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i] ?? 0);
  try {
    return decodeURIComponent(escape(s));
  } catch {
    return s;
  }
}

function getJwtIssuer(accessToken: string): string {
  try {
    const parts = accessToken.split('.');
    if (parts.length < 2) return '';
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    const json = base64ToUtf8(padded);
    const payload = JSON.parse(json) as any;
    return typeof payload?.iss === 'string' ? payload.iss : '';
  } catch {
    return '';
  }
}

function getUrlHost(value: string): string {
  try {
    return new URL(value).host;
  } catch {
    return '';
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms));
}

async function getAccessTokenForPayment(): Promise<string> {
  // Use getSession() which is faster and often more reliable for immediate token access
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;
  
  if (token) {
    console.log('[DEBUG] Token retrieved from getSession. Length:', token.length);
    const issuerHost = getUrlHost(getJwtIssuer(token));
    const supabaseHost = getUrlHost(String(process.env.EXPO_PUBLIC_SUPABASE_URL || ''));
    if (issuerHost && supabaseHost && issuerHost !== supabaseHost) {
      console.error('[DEBUG] JWT issuer mismatch. Clearing session.', { issuerHost, supabaseHost });
      try {
        await supabase.auth.signOut({ scope: 'local' } as any);
      } catch {
        try {
          await supabase.auth.signOut();
        } catch {}
      }
      return '';
    }
    return token;
  }

  console.log('[DEBUG] No token in getSession, attempting refreshSession...');
  const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
  if (refreshError) {
    console.error('[DEBUG] refreshSession failed in getAccessToken:', refreshError.message);
  }
  
  const refreshedToken = refreshed?.session?.access_token || '';
  if (refreshedToken) {
    console.log('[DEBUG] Token retrieved after refreshSession. Length:', refreshedToken.length);
    const issuerHost = getUrlHost(getJwtIssuer(refreshedToken));
    const supabaseHost = getUrlHost(String(process.env.EXPO_PUBLIC_SUPABASE_URL || ''));
    if (issuerHost && supabaseHost && issuerHost !== supabaseHost) {
      console.error('[DEBUG] JWT issuer mismatch after refresh. Clearing session.', { issuerHost, supabaseHost });
      try {
        await supabase.auth.signOut({ scope: 'local' } as any);
      } catch {
        try {
          await supabase.auth.signOut();
        } catch {}
      }
      return '';
    }
  }
  return refreshedToken;
}

async function invokeEdgeFunctionViaFetch<T>(
  functionName: string,
  params: { body: any; accessToken?: string }
): Promise<{ data: T | null; error: any }> {
  const supabaseUrl = String(process.env.EXPO_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
  const supabaseAnonKey = String(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '');
  if (!supabaseUrl || !supabaseAnonKey) {
    return { data: null, error: { message: 'Falta configuración de Supabase (URL o ANON KEY).' } };
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    apikey: supabaseAnonKey,
  };
  if (params.accessToken) {
    headers.Authorization = `Bearer ${params.accessToken}`;
  }

  const endpoint = `${supabaseUrl}/functions/v1/${functionName}`;
  const sentAuthorization = Boolean(params.accessToken);
  const sentIssuerHost = params.accessToken ? getUrlHost(getJwtIssuer(params.accessToken)) : '';
  console.log('[payments] Calling Edge Function', {
    name: functionName,
    endpointHost: getUrlHost(endpoint),
    sentAuthorization,
    sentIssuerHost: sentIssuerHost || null,
  });
  let response: Response;
  try {
    response = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(params.body ?? {}) });
  } catch (e: any) {
    return { data: null, error: { message: String(e?.message || e || 'Network error') } };
  }

  if (!response.ok) {
    let bodyText = '';
    try {
      bodyText = await response.clone().text();
    } catch {}
    const details = bodyText && bodyText.length > 600 ? `${bodyText.slice(0, 600)}…` : bodyText;
    const message = details
      ? `Edge Function error (${response.status}): ${details}`
      : `Edge Function error (${response.status})`;
    return {
      data: null,
      error: {
        message,
        context: { response, body: bodyText, endpoint, sentAuthorization, sentIssuerHost: sentIssuerHost || null },
      },
    };
  }

  try {
    const data = (await response.json()) as T;
    return { data, error: null };
  } catch {
    return { data: null, error: { message: 'Respuesta inválida del servidor.' } };
  }
}

async function invokeAuthed<T>(functionName: string, body: any): Promise<{ data: T | null; error: any }> {
  const { data: { session } } = await supabase.auth.getSession();
  const hasToken = Boolean(session?.access_token);
  console.log('[DEBUG] Sending JWT to function:', functionName, hasToken);

  const r = await invokeEdgeFunction<T>(functionName, body ?? {});
  if (r.error) return { data: null, error: r.error };
  return { data: r.data as T, error: null };
}

async function invokeWithJwtRecovery<T>(functionName: string, body: any): Promise<{ data: T | null; error: any }> {
  console.log(`[DEBUG] invokeWithJwtRecovery START for: ${functionName}`);
  const first = await invokeAuthed<T>(functionName, body);
  
  if (!first.error) {
    return first as any;
  }

  const firstMsg = String(first?.error?.message || '');
  const firstDetails = await getEdgeFunctionErrorMessage(first.error, '');
  const combinedFirst = `${firstMsg} ${firstDetails}`.trim();
  
  console.log(`[DEBUG] ${functionName} first attempt failed. Error:`, combinedFirst);

  if (!isInvalidJwtMessage(combinedFirst)) {
    console.log(`[DEBUG] Error is NOT a JWT error. Returning error to caller.`);
    return first as any;
  }

  console.log(`[DEBUG] JWT Error detected. Attempting session refresh...`);

  try {
    const { error: refreshError } = await supabase.auth.refreshSession();
    if (refreshError) {
      console.error('[DEBUG] Session refresh failed:', refreshError.message);
      // COMENTADO: No cerrar sesión automáticamente para evitar que la app se cierre al entrar
      // await supabase.auth.signOut();
      // throw new Error('Tu sesión ha expirado. Por favor, inicia sesión de nuevo.');
      return first as any;
    }
    console.log('[DEBUG] Session refreshed successfully. New token ready.');
  } catch (e: any) {
    console.error('[DEBUG] Refresh logic critical error:', e.message);
    return first as any;
  }

  console.log(`[DEBUG] Retrying ${functionName} with new token...`);
  const second = await invokeAuthed<T>(functionName, body);
  
  if (second.error) {
    const secondMsg = String(second?.error?.message || '');
    const secondDetails = await getEdgeFunctionErrorMessage(second.error, '');
    const combinedSecond = `${secondMsg} ${secondDetails}`.trim();
    console.error(`[DEBUG] ${functionName} retry failed too:`, combinedSecond);
    
    if (isInvalidJwtMessage(combinedSecond)) {
      console.error('[DEBUG] Still getting 401 after refresh.');
      try {
        await supabase.auth.signOut({ scope: 'local' } as any);
      } catch {}
    }
  } else {
    console.log(`[DEBUG] ${functionName} SUCCEEDED on second attempt!`);
  }

  return second as any;
}

export async function createPaymentIntent(req: CreatePaymentIntentRequest): Promise<CreatePaymentIntentResponse> {
  if (Platform.OS === 'web') {
    throw new Error('Payments are not supported on web.');
  }

  const { data, error } = await invokeWithJwtRecovery<CreatePaymentIntentResponse>('create-payment-intent-v2', req);

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
      console.log('[payments] Invalid JWT en create-payment-intent', {
        issuerHost: sentIssuerHost || null,
        supabaseHost: supabaseHost || null,
        hasAccessToken: sentAuthorization,
      });
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
    throw new Error('Payments are not supported on web.');
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
      console.log('[payments] Invalid JWT en confirm-payment', {
        issuerHost: sentIssuerHost || null,
        supabaseHost: supabaseHost || null,
        hasAccessToken: sentAuthorization,
      });
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
  console.log('[DEBUG] EXPLICIT CALL to createStripeConnectAccount');
  const { data, error } = await invokeWithJwtRecovery<CreateStripeConnectAccountResponse>('stripe-connect-create-account', {});
  if (error) {
    console.error('[DEBUG] createStripeConnectAccount error after recovery:', error);
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
