import type { LngLat } from './geometry';

// Free public services. Both ask for light use: requests are only made on user
// actions (a search, or finishing a point edit), never in a loop.
const OSRM = 'https://router.project-osrm.org/route/v1/driving';
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';

/** Road-following path between two points, or null if no route was found. */
export async function routeSegment(a: LngLat, b: LngLat, signal?: AbortSignal): Promise<LngLat[] | null> {
  const url = `${OSRM}/${a[0]},${a[1]};${b[0]},${b[1]}?overview=full&geometries=geojson`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Routing ${res.status}`);
  const body = await res.json();
  const coords = body?.routes?.[0]?.geometry?.coordinates as LngLat[] | undefined;
  if (!coords || coords.length < 2) return null;
  // Pin the ends to the exact control points so segments join cleanly.
  return [a, ...coords.slice(1, -1), b];
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
