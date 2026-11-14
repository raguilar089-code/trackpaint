import type { LngLat } from './geometry';

// Free public services. Both ask for light use: requests are only made on user
// actions (a search, or finishing a point edit), never in a loop.
const VALHALLA = 'https://valhalla1.openstreetmap.de/route';
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';

/**
 * Street-following path between two points, or null if no route was found.
 * Uses car roads but ignores one-way streets, turn restrictions and closures:
 * a circuit can run either way along any street.
 */
export async function routeSegment(a: LngLat, b: LngLat, signal?: AbortSignal): Promise<LngLat[] | null> {
  const request = {
    locations: [
      { lon: a[0], lat: a[1] },
      { lon: b[0], lat: b[1] },
    ],
    costing: 'auto',
    costing_options: { auto: { ignore_oneways: true, ignore_restrictions: true, ignore_closures: true } },
    directions_type: 'none',
  };
  const res = await fetch(`${VALHALLA}?json=${encodeURIComponent(JSON.stringify(request))}`, { signal });
  if (res.status === 400) return null; // no route between these points
  if (!res.ok) throw new Error(`Routing ${res.status}`);
  const body = await res.json();
  const shape = body?.trip?.legs?.[0]?.shape as string | undefined;
  if (!shape) return null;
  const coords = decodePolyline(shape, 6);
  if (coords.length < 2) return null;
  // Pin the ends to the exact control points so segments join cleanly.
  return [a, ...coords.slice(1, -1), b];
}

/** Decode an encoded polyline (Google format) into [lng, lat] pairs. */
export function decodePolyline(str: string, precision = 6): LngLat[] {
  const factor = 10 ** precision;
  const out: LngLat[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  const next = () => {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = str.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < str.length);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (index < str.length) {
    lat += next();
    lng += next();
    out.push([lng / factor, lat / factor]);
  }
  return out;
}

export interface Place {
  name: string;
  center: LngLat;
  bbox?: [number, number, number, number];
}

export async function searchPlaces(query: string): Promise<Place[]> {
  const url = `${NOMINATIM}?format=json&limit=6&accept-language=es&q=${encodeURIComponent(query)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Búsqueda ${res.status}`);
  const body = (await res.json()) as Array<{ display_name: string; lat: string; lon: string; boundingbox?: string[] }>;
  return body.map((r) => {
    const place: Place = { name: r.display_name, center: [Number(r.lon), Number(r.lat)] };
    if (r.boundingbox?.length === 4) {
      const [s, n, w, e] = r.boundingbox.map(Number);
      place.bbox = [w, s, e, n];
    }
    return place;
  });
}

export interface Locality {
  city: string;
  country: string;
  /** ISO 3166-1 alpha-2, lower case (e.g. "es"). */
  countryCode: string;
}

/** City and country at a point (Nominatim reverse geocoding). */
export async function reverseGeocode(p: LngLat): Promise<Locality | null> {
  const url = `https://nominatim.openstreetmap.org/reverse?format=json&zoom=10&accept-language=es&lat=${p[1]}&lon=${p[0]}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const body = await res.json();
  const a = body?.address;
  if (!a) return null;
  return {
    city: a.city ?? a.town ?? a.village ?? a.municipality ?? a.county ?? a.state ?? '',
    country: a.country ?? '',
    countryCode: String(a.country_code ?? '').toLowerCase(),
  };
}

// Flag SVGs ship with the app; each one is only downloaded when used.
const FLAGS = import.meta.glob('../node_modules/flag-icons/flags/4x3/*.svg', {
  query: '?url',
  import: 'default',
}) as Record<string, () => Promise<string>>;

/** URL of the country's flag (4:3 SVG), or null if unknown. */
export async function flagUrl(countryCode: string): Promise<string | null> {
  const load = FLAGS[`../node_modules/flag-icons/flags/4x3/${countryCode.toLowerCase()}.svg`];
  return load ? load() : null;
}
