// Streets, water, parks and buildings around the circuit, read from the same
// vector tiles the map uses, to draw behind the poster.
import type * as maplibregl from 'maplibre-gl';
import type { LngLat } from './geometry';
import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';

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

/** Add one vector-tile feature to the city layers. */
function addFeature(city: CityLayer, layer: string, props: Record<string, unknown>, g: GeoJSON.Geometry) {
  if (layer === 'transportation') {
    const kind = ROAD_KIND[String(props.class ?? '')];
    if (!kind || props.brunnel === 'tunnel') return;
    for (const l of lines(g)) city.roads.push({ kind, coords: l });
  } else if (layer === 'water') city.water.push(...polygons(g));
  else if (layer === 'park') city.parks.push(...polygons(g));
  else if (layer === 'landcover') {
    if (['grass', 'wood', 'farmland'].includes(String(props.class))) city.parks.push(...polygons(g));
  } else if (layer === 'building') city.buildings.push(...polygons(g));
}

const LAYERS = ['transportation', 'water', 'park', 'landcover', 'building'];

/** Tile URL template and max zoom of the map's OpenMapTiles source. */
async function tileTemplate(map: maplibregl.Map): Promise<{ url: string; maxzoom: number } | null> {
  const src = map.getStyle()?.sources?.[SOURCE] as { url?: string; tiles?: string[]; maxzoom?: number } | undefined;
  if (!src) return null;
  if (src.tiles?.length) return { url: src.tiles[0], maxzoom: src.maxzoom ?? 14 };
  if (!src.url) return null;
  const tj = await (await fetch(src.url)).json();
  return tj.tiles?.length ? { url: tj.tiles[0], maxzoom: tj.maxzoom ?? 14 } : null;
}

const tileX = (lng: number, z: number) => Math.floor(((lng + 180) / 360) * 2 ** z);
const tileY = (lat: number, z: number) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
};

/**
 * Download the map's vector tiles that cover `bounds` (at the most detailed
 * zoom, so every street and building is there) and read the city from them.
 */
export async function fetchCity(
  map: maplibregl.Map,
  bounds: [LngLat, LngLat],
  /** Width in pixels the area is drawn at; buildings smaller than a pixel are not read. */
  drawWidth = 1760,
  maxTiles = 24,
): Promise<CityLayer | null> {
  const src = await tileTemplate(map);
  if (!src) return null;
  const [[w, s], [e, n]] = bounds;
  let z = Math.min(14, src.maxzoom);
  const count = (zz: number) => (tileX(e, zz) - tileX(w, zz) + 1) * (tileY(s, zz) - tileY(n, zz) + 1);
  while (z > 12 && count(z) > maxTiles) z--;
  // Size of one tile on the poster, to leave out buildings too small to see.
  const cosLat = Math.cos((((s + n) / 2) * Math.PI) / 180);
  const spanM = (e - w) * 111320 * cosLat;
  const tilePx = (40075016.686 * cosLat) / 2 ** z / (spanM / drawWidth);
  const jobs: Promise<void>[] = [];
  const city: CityLayer = { roads: [], water: [], parks: [], buildings: [] };
  for (let x = tileX(w, z); x <= tileX(e, z); x++) {
    for (let y = tileY(n, z); y <= tileY(s, z); y++) {
      const url = src.url.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
      jobs.push(
        fetch(url)
          .then((r) => (r.ok ? r.arrayBuffer() : null))
          .then((buf) => {
            if (!buf) return;
            const tile = new VectorTile(new Pbf(new Uint8Array(buf)));
            for (const name of LAYERS) {
              const layer = tile.layers[name];
              if (!layer) continue;
              const minUnits = (1.2 * layer.extent) / tilePx;
              for (let i = 0; i < layer.length; i++) {
                const f = layer.feature(i);
                if (name === 'building') {
                  const [x1, y1, x2, y2] = f.bbox();
                  if (Math.max(x2 - x1, y2 - y1) < minUnits) continue;
                }
                addFeature(city, name, f.properties, f.toGeoJSON(x, y, z).geometry);
              }
            }
          })
          .catch(() => undefined), // a missing tile just leaves a gap
      );
    }
  }
  await Promise.all(jobs);
  const empty = !city.roads.length && !city.water.length && !city.buildings.length;
  return empty ? null : city;
}
