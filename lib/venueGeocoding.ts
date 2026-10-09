export type VenueLocation = { latitude: number; longitude: number; address: string; city: string; postalCode: string; country: string };
type Feature = { id?: string; text?: string; place_name?: string; place_type?: string[]; center?: number[]; context?: Feature[] };

export function parseVenueFeature(feature: Feature): VenueLocation | null {
  const [longitude, latitude] = feature.center || [];
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  const context = [feature, ...(feature.context || [])];
  const field = (...types: string[]) => context.find(item => types.some(type => item.id?.startsWith(`${type}.`) || item.place_type?.includes(type)))?.text || '';
  return { latitude, longitude, address: feature.place_name || feature.text || '', city: field('municipality', 'place', 'locality'), postalCode: field('postal_code', 'postcode'), country: field('country') };
}

export async function findVenueLocations(query: string, signal?: AbortSignal): Promise<VenueLocation[]> {
  const key = process.env.EXPO_PUBLIC_MAPTILER_KEY;
  if (!key) throw new Error('El mapa no está configurado en esta versión. Puedes escribir la dirección manualmente.');
  const response = await fetch(`https://api.maptiler.com/geocoding/${encodeURIComponent(query)}.json?key=${encodeURIComponent(key)}&language=es`, { signal });
  if (!response.ok) throw new Error('No se pudo consultar la dirección. Vuelve a intentarlo.');
  const data = await response.json() as { features?: Feature[] };
  return (data.features || []).map(parseVenueFeature).filter((item): item is VenueLocation => item !== null && !!item.address);
}
