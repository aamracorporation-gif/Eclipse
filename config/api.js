const PROD_API_URL = 'https://api.weareeclipseoficial.com';
const LOCAL_API_URL = 'http://localhost:8081';

// En móvil (Expo Go) "localhost" apunta al dispositivo, no al PC.
// Si pruebas en un teléfono físico, exporta EXPO_PUBLIC_API_URL con tu IP LAN (ej: http://192.168.1.X:8081).
export const API_URL =
  (process.env.EXPO_PUBLIC_API_URL && String(process.env.EXPO_PUBLIC_API_URL).trim()) ||
  (__DEV__ ? LOCAL_API_URL : PROD_API_URL);

export function apiUrl(pathname = '/') {
  const base = API_URL.replace(/\/$/, '');
  const path = String(pathname || '/');
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

export async function apiFetch(pathname, options) {
  const res = await fetch(apiUrl(pathname), {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options && options.headers ? options.headers : {}),
    },
  });
  return res;
}
