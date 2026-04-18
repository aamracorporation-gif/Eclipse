import { supabase } from '@/lib/supabase';

type EdgeFunctionResult<T> = {
  data: T | null;
  error: any | null;
  status: number;
};

function getSupabaseFunctionUrl(functionName: string) {
  const supabaseUrl = String(process.env.EXPO_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
  if (!supabaseUrl) throw new Error('Falta EXPO_PUBLIC_SUPABASE_URL.');
  return `${supabaseUrl}/functions/v1/${functionName}`;
}

function getAnonKey() {
  const anonKey = String(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '');
  if (!anonKey) throw new Error('Falta EXPO_PUBLIC_SUPABASE_ANON_KEY.');
  return anonKey;
}

async function parseResponse(res: Response) {
  const text = await res.text().catch(() => '');
  try {
    return { text, json: text ? JSON.parse(text) : null };
  } catch {
    return { text, json: null };
  }
}

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

export async function invokeEdgeFunction<T = any>(functionName: string, body: any): Promise<EdgeFunctionResult<T>> {
  const url = getSupabaseFunctionUrl(functionName);
  const anonKey = getAnonKey();

  let accessToken = '';
  try {
    const session = await getValidSession();
    accessToken = session.access_token;
  } catch (e: any) {
    return { data: null, error: { message: String(e?.message || e) }, status: 0 };
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      apikey: anonKey,
    },
    body: JSON.stringify(body ?? {}),
  });

  const { json, text } = await parseResponse(res);
  if (!res.ok) {
    const message = String(json?.error || json?.message || text || `HTTP ${res.status}`);
    return { data: null, error: { ...(json && typeof json === 'object' ? json : {}), message }, status: res.status };
  }

  if (json && typeof json === 'object' && (json as any).ok === false) {
    const message = String((json as any).error || (json as any).message || 'Edge Function error');
    return { data: null, error: { ...(json as any), message }, status: res.status };
  }

  return { data: (json as T) ?? ({} as T), error: null, status: res.status };
}
