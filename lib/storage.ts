import { supabase } from '@/lib/supabase';
import * as FileSystem from 'expo-file-system/legacy';
import { Platform, Alert } from 'react-native';
import { encode as encodeBase64FromArrayBuffer } from 'base64-arraybuffer';
import { invokeEdgeFunction } from '@/lib/edgeFunctions';

function decodeBase64UrlToString(input: string): string {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = normalized.length % 4 ? '='.repeat(4 - (normalized.length % 4)) : '';
  const base64 = normalized + pad;
  if (typeof globalThis.atob === 'function') return globalThis.atob(base64);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const buf = require('buffer').Buffer.from(base64, 'base64');
  return buf.toString('utf8');
}

function getJwtIssuer(jwt: string): string {
  try {
    const parts = jwt.split('.');
    if (parts.length < 2) return '';
    const payloadText = decodeBase64UrlToString(parts[1]);
    const payload = JSON.parse(payloadText);
    return typeof payload?.iss === 'string' ? payload.iss : '';
  } catch {
    return '';
  }
}

function getUrlHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

async function getAccessToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (token) return token;
  await supabase.auth.refreshSession();
  const { data: after } = await supabase.auth.getSession();
  return after?.session?.access_token || '';
}

function isInvalidJwtMessage(message: string): boolean {
  const m = String(message || '').toLowerCase();
  return (
    m.includes('invalid jwt') ||
    (m.includes('jwt') && m.includes('invalid')) ||
    (m.includes('jwt') && m.includes('expired')) ||
    (m.includes('token') && m.includes('expired')) ||
    m.includes('jwt expired') ||
    m.includes('token has expired') ||
    (m.includes('signature') && m.includes('invalid'))
  );
}

function isUnauthorizedMessage(message: string): boolean {
  const m = String(message || '').toLowerCase();
  return (
    m.includes('no autorizado') ||
    m.includes('unauthorized') ||
    m.includes('not authorized') ||
    (m.includes('non-2xx') && m.includes('edge function')) ||
    m.includes('edge function returned a non-2xx status code')
  );
}

function getInvokeErrorDetails(error: any): string {
  const body = (error as any)?.context?.body;
  if (typeof body === 'string') return body;
  if (body && typeof body === 'object') {
    try {
      return JSON.stringify(body);
    } catch {}
  }
  return '';
}

async function callEdgeFunction<T>(functionName: string, body: any): Promise<T> {
  try {
    let r = await invokeEdgeFunction<T>(functionName, body ?? {});
    if (r.error && (r.status === 401 || r.status === 403)) {
      try {
        await supabase.auth.refreshSession();
      } catch {}
      r = await invokeEdgeFunction<T>(functionName, body ?? {});
    }
    if (r.error) {
      const msg = String(r.error?.message || r.error || 'Error invocando la Edge Function');
      throw new Error(msg);
    }
    return (r.data as T) ?? ({} as T);
  } catch (e: any) {
    throw e;
  }
}

export async function uploadImage(uri: string, bucket: string = 'events'): Promise<string | null> {
  try {
    let arrayBuffer: ArrayBuffer;
    let contentType = 'image/jpeg';
    
    // Ensure uri is valid
    if (!uri) {
      console.error('No URI provided to uploadImage');
      return null;
    }
    
    const fileExt = uri.split('.').pop()?.toLowerCase() || 'jpg';
    
    // Determine content type based on extension
    if (fileExt === 'png') contentType = 'image/png';
    else if (fileExt === 'webp') contentType = 'image/webp';

    if (Platform.OS === 'web') {
      const response = await fetch(uri);
      const blob = await response.blob();
      arrayBuffer = await new Response(blob).arrayBuffer();
      contentType = blob.type || contentType;
    } else {
      // Use Fetch to read the file as blob/arrayBuffer (modern and works with Expo 50+)
      // This avoids the deprecated readAsStringAsync and simplifies the flow
      const response = await fetch(uri);
      const blob = await response.blob();
      arrayBuffer = await new Response(blob).arrayBuffer();
      contentType = blob.type || contentType;
    }
    
    const fileName = `${Date.now()}.${fileExt}`;
    const filePath = `${fileName}`;

    const { error } = await supabase.storage
      .from(bucket)
      .upload(filePath, arrayBuffer, {
        contentType: contentType,
        upsert: false
      });

    if (error) {
      const errorMsg = error.message || JSON.stringify(error);
      if (errorMsg.includes('Bucket not found') || errorMsg.includes('The resource was not found')) {
        console.log(`Bucket '${bucket}' not found. Attempting to create it...`);
        const { data: bucketData, error: createError } = await supabase.storage.createBucket(bucket, {
          public: true,
          fileSizeLimit: 10485760, // 10MB
          allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp']
        });

        if (createError) {
          console.error('Failed to create bucket:', createError);
          Alert.alert(
            'Error de Configuración',
            `El bucket de almacenamiento '${bucket}' no existe en Supabase y no se pudo crear automáticamente. Por favor, crea un bucket público llamado '${bucket}' en tu panel de Supabase.`,
            [{ text: 'OK' }]
          );
          return null;
        }

        console.log(`Bucket '${bucket}' created successfully.`);

        // Retry upload
        const { error: retryError } = await supabase.storage
          .from(bucket)
          .upload(filePath, arrayBuffer, {
            contentType: contentType,
            upsert: false
          });
        
        if (retryError) {
           console.error('Error uploading image after bucket creation:', retryError);
           throw retryError;
        }
      } else {
        console.error('Error uploading image:', error);
        throw error;
      }
    }

    const { data } = supabase.storage
      .from(bucket)
      .getPublicUrl(filePath);

    return data.publicUrl;
  } catch (error) {
    console.error('Error in uploadImage:', error);
    return null;
  }
}

type OrganizerVerificationFileKind = 'business_license' | 'tax_id' | 'venue_photo';

const KIND_TO_FOLDER: Record<OrganizerVerificationFileKind, string> = {
  business_license: 'business-license',
  tax_id: 'tax-id',
  venue_photo: 'venue-photo',
};

export async function uploadOrganizerVerificationFile(params: {
  uri: string;
  userId: string;
  kind: OrganizerVerificationFileKind;
  fileName?: string | null;
  mimeType?: string | null;
  maxBytes?: number;
}): Promise<{ path: string; contentType: string } | null> {
  const {
    uri,
    userId,
    kind,
    fileName,
    mimeType,
    maxBytes = 10 * 1024 * 1024,
  } = params;

  try {
    if (!uri || !userId) return null;

    let effectiveUserId = userId;
    try {
      const { data, error } = await supabase.auth.getUser();
      if (!error && data?.user?.id) {
        effectiveUserId = data.user.id;
      } else {
        await supabase.auth.refreshSession();
        const { data: afterRefresh } = await supabase.auth.getUser();
        if (afterRefresh?.user?.id) {
          effectiveUserId = afterRefresh.user.id;
        }
      }
    } catch {}

    const allowedMimeTypes =
      kind === 'venue_photo'
        ? ['image/png', 'image/jpeg', 'image/webp']
        : ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];

    if (Platform.OS !== 'web') {
      const info = await FileSystem.getInfoAsync(uri);
      if (info.exists && typeof info.size === 'number' && info.size > maxBytes) {
        return null;
      }
    }

    const response = await fetch(uri);
    const blob = await response.blob();
    const arrayBuffer = await new Response(blob).arrayBuffer();

    const detectedContentType = mimeType || blob.type || 'application/octet-stream';
    if (!allowedMimeTypes.includes(detectedContentType)) {
      return null;
    }

    const extensionFromName = (fileName || uri).split('.').pop()?.toLowerCase();
    const ext =
      extensionFromName && extensionFromName.length <= 8
        ? extensionFromName
        : detectedContentType === 'application/pdf'
          ? 'pdf'
          : detectedContentType === 'image/png'
            ? 'png'
            : detectedContentType === 'image/webp'
              ? 'webp'
              : 'jpg';

    const random = Math.random().toString(16).slice(2);
    const path = `${effectiveUserId}/${KIND_TO_FOLDER[kind]}/${Date.now()}-${random}.${ext}`;

    try {
      const base64 = encodeBase64FromArrayBuffer(arrayBuffer);
      const res = await callEdgeFunction<{ path: string; contentType?: string }>('upload-organizer-verification-file', {
        kind,
        mimeType: detectedContentType,
        fileName: fileName || null,
        base64,
      });

      if (res?.path) {
        return { path: res.path, contentType: res.contentType || detectedContentType };
      }
      throw new Error('Respuesta inválida de la Edge Function.');
    } catch (e: any) {
      const message = String(e?.message || e || '');
      if (isUnauthorizedMessage(message)) {
        const { error: uploadError } = await supabase.storage.from('organizer_verification').upload(path, arrayBuffer, {
          contentType: detectedContentType,
          upsert: true,
        });
        if (!uploadError) {
          return { path, contentType: detectedContentType };
        }
        const msg = String((uploadError as any)?.message || uploadError || '');
        throw new Error(`No se pudo subir por Storage directo: ${msg || 'Error desconocido'}`);
      }
      if (
        message.includes('Requested function was not found') ||
        message.includes('No function with name') ||
        message.includes('not found')
      ) {
        throw new Error('Falta crear la Edge Function "upload-organizer-verification-file" en Supabase para subir documentos.');
      }
      throw new Error(`No se pudo subir por Edge Function: ${message || 'Error desconocido'}`);
    }
  } catch (error) {
    console.error('Error in uploadOrganizerVerificationFile:', error);
    return null;
  }
}

export async function createSignedUrlDetailed(params: {
  bucket: string;
  path: string;
  expiresInSeconds?: number;
}): Promise<{ url: string | null; error: string | null }> {
  const { bucket, path, expiresInSeconds = 60 * 10 } = params;
  try {
    const errors: string[] = [];

    const normalizePath = (raw: string) => {
      const input = String(raw || '').trim();
      if (!input) return '';

      if (/^(file|data):\/\//i.test(input)) return '';

      if (/^https?:\/\//i.test(input)) {
        try {
          const u = new URL(input);
          const parts = u.pathname.split('/').filter(Boolean);
          const objectIdx = parts.findIndex((p) => p === 'object');
          if (objectIdx >= 0) {
            let i = objectIdx + 1;
            if (parts[i] === 'public' || parts[i] === 'sign') i += 1;
            if (parts[i] === bucket) {
              const rest = parts.slice(i + 1).join('/');
              return decodeURIComponent(rest);
            }
          }
        } catch {}
      }

      let p = input.replace(/^\/+/, '');
      const bucketPrefix = `${bucket}/`;
      if (p.startsWith(bucketPrefix)) p = p.slice(bucketPrefix.length);
      const publicBucketPrefix = `public/${bucket}/`;
      if (p.startsWith(publicBucketPrefix)) p = p.slice(publicBucketPrefix.length);
      const objectBucketPrefix = `object/${bucket}/`;
      if (p.startsWith(objectBucketPrefix)) p = p.slice(objectBucketPrefix.length);
      const objectPublicBucketPrefix = `object/public/${bucket}/`;
      if (p.startsWith(objectPublicBucketPrefix)) p = p.slice(objectPublicBucketPrefix.length);
      const objectSignBucketPrefix = `object/sign/${bucket}/`;
      if (p.startsWith(objectSignBucketPrefix)) p = p.slice(objectSignBucketPrefix.length);
      return p;
    };

    const normalized = normalizePath(path);
    const firstPath = normalized || String(path || '').trim();
    if (!firstPath) return { url: null, error: 'Ruta vacía del archivo.' };

    const { data: d1, error: e1 } = await supabase.storage.from(bucket).createSignedUrl(firstPath, expiresInSeconds);
    if (!e1 && d1?.signedUrl) return { url: d1.signedUrl, error: null };
    if (e1) errors.push(String((e1 as any)?.message || e1 || 'Error generando enlace (intento 1)'));

    if (firstPath !== String(path || '').trim()) {
      const { data: d2, error: e2 } = await supabase.storage.from(bucket).createSignedUrl(String(path || '').trim(), expiresInSeconds);
      if (!e2 && d2?.signedUrl) return { url: d2.signedUrl, error: null };
      if (e2) errors.push(String((e2 as any)?.message || e2 || 'Error generando enlace (intento 2)'));
    }

    if (bucket === 'organizer_verification') {
      try {
        const res = await callEdgeFunction<{ signedUrl?: string }>('upload-organizer-verification-file', {
          action: 'sign',
          path: firstPath,
          expiresInSeconds,
        });
        const candidate = String(res?.signedUrl || '').trim();
        if (candidate) return { url: candidate, error: null };
        errors.push('La Edge Function respondió sin URL.');
      } catch (e: any) {
        errors.push(String(e?.message || e || 'Error llamando a la Edge Function'));
      }
    }

    const msg = errors.map((s) => String(s || '').trim()).filter(Boolean).join('\n');
    const lower = msg.toLowerCase();
    if (lower.includes('object not found') || lower.includes('not found')) {
      return { url: null, error: `Objeto no encontrado en Storage.\nRuta: ${firstPath}\n\nSi es un documento antiguo, vuelve a subirlo.` };
    }
    return { url: null, error: msg || null };
  } catch {
    return { url: null, error: 'Error inesperado generando el enlace.' };
  }
}

export async function createSignedUrl(params: {
  bucket: string;
  path: string;
  expiresInSeconds?: number;
}): Promise<string | null> {
  const res = await createSignedUrlDetailed(params);
  return res.url;
}
 
