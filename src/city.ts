// Streets, water, parks and buildings around the circuit, taken from the
// vector tiles already loaded by the map, to draw behind the poster.
import type * as maplibregl from 'maplibre-gl';
import type { LngLat } from './geometry';

export type RoadKind = 'major' | 'medium' | 'minor' | 'service';
export interface CityLayer {
  roads: { kind: RoadKind; coords: LngLat[] }[];
  water: LngLat[][][];
  parks: LngLat[][][];
  buildings: LngLat[][][];
}

const SOURCE = 'openmaptiles';
const ROAD_KIND: Record<string, RoadKind> = {
  motorway: 'major',
  trunk: 'major',
  primary: 'major',
  secondary: 'medium',
  tertiary: 'medium',
  minor: 'minor',
  residential: 'minor',
  unclassified: 'minor',
  service: 'service',
  track: 'service',
  path: 'service',
};

function lines(g: GeoJSON.Geometry): LngLat[][] {
  if (g.type === 'LineString') return [g.coordinates as LngLat[]];
  if (g.type === 'MultiLineString') return g.coordinates as LngLat[][];
  return [];
}
function polygons(g: GeoJSON.Geometry): LngLat[][][] {
  if (g.type === 'Polygon') return [g.coordinates as LngLat[][]];
  if (g.type === 'MultiPolygon') return g.coordinates as LngLat[][][];
  return [];
}

/** Read the city features currently loaded in the map. */
export function readCity(map: maplibregl.Map): CityLayer | null {
  if (!map.getSource(SOURCE)) return null;
  const q = (sourceLayer: string) => map.querySourceFeatures(SOURCE, { sourceLayer });
  const city: CityLayer = { roads: [], water: [], parks: [], buildings: [] };
  for (const f of q('transportation')) {
    const kind = ROAD_KIND[String(f.properties?.class ?? '')];
    if (!kind || f.properties?.brunnel === 'tunnel') continue;
    for (const l of lines(f.geometry)) city.roads.push({ kind, coords: l });
  }
  for (const f of q('water')) city.water.push(...polygons(f.geometry));
  for (const f of q('park')) city.parks.push(...polygons(f.geometry));
  for (const f of q('landcover')) {
    if (['grass', 'wood', 'farmland'].includes(String(f.properties?.class))) city.parks.push(...polygons(f.geometry));
  }
  for (const f of q('building')) city.buildings.push(...polygons(f.geometry));
  const empty = !city.roads.length && !city.water.length && !city.buildings.length;
  return empty ? null : city;
}

/**
 * Show the whole area around the track for a moment so its tiles load, read
 * the city, then put the camera back where it was.
 */
export async function captureCity(map: maplibregl.Map, bounds: [LngLat, LngLat]): Promise<CityLayer | null> {
  if (!map.getSource(SOURCE)) return null;
  const camera = { center: map.getCenter(), zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() };
  map.jumpTo({ pitch: 0, bearing: 0 });
  map.fitBounds(bounds, { animate: false, padding: 10, maxZoom: 16 });
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 8000); // don't wait forever on a slow connection
    map.once('idle', () => {
      clearTimeout(timer);
      resolve();
    });
    map.triggerRepaint();
  });
  const city = readCity(map);
  map.jumpTo(camera);
  return city;
}
