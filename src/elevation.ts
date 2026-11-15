// Terrain height along the track, from free elevation tiles (Terrarium PNG
// encoding, Mapzen/AWS open data: SRTM, ASTER and national surveys).

import { type LngLat, distance } from './geometry';

const TERRARIUM = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
const TILE = 256;

/** Height in metres from a Terrarium-encoded pixel. */
export const decodeTerrarium = (r: number, g: number, b: number) => r * 256 + g + b / 256 - 32768;

export interface ElevationPoint {
  /** Distance along the track (metres). */
  dist: number;
  elev: number;
  coord: LngLat;
}
export interface ElevationProfile {
  points: ElevationPoint[];
  highest: ElevationPoint;
  lowest: ElevationPoint;
  /** Total metres climbed over the lap. */
  climb: number;
  /** Steepest climb and descent over 100 m, as a fraction (0.05 = 5 %). */
  maxUphill: number;
  maxDownhill: number;
}

/** Height at a point, or NaN where there is no data. */
export type HeightSampler = (p: LngLat) => number;

/**
 * Heights every `step` metres along the track, smoothed over ~`smooth` metres
 * (the terrain data has a few metres of noise, more in built-up areas), with the highest and lowest
 * points and the total climb.
 */
export function elevationProfile(
  centre: LngLat[],
  closed: boolean,
  height: HeightSampler,
  step = 10,
  smooth = 120,
): ElevationProfile | null {
  if (centre.length < 2) return null;
  // Resample at a fixed spacing.
  const raw: ElevationPoint[] = [];
  let dist = 0;
  let next = 0;
  for (let i = 1; i < centre.length; i++) {
    const a = centre[i - 1];
    const b = centre[i];
    const len = distance(a, b);
    while (next <= dist + len) {
      const t = len ? (next - dist) / len : 0;
      const coord: LngLat = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      raw.push({ dist: next, elev: height(coord), coord });
      next += step;
    }
    dist += len;
  }
  const last = centre[centre.length - 1];
  if (dist - raw[raw.length - 1].dist > 1) raw.push({ dist, elev: height(last), coord: last });
  if (raw.some((p) => !Number.isFinite(p.elev))) return null;

  const n = raw.length;
  const w = Math.max(0, Math.round(smooth / step / 2));
  const loop = closed && n > 2 * w + 2;
  const points = raw.map((p, i) => {
    let sum = 0;
    let count = 0;
    for (let j = -w; j <= w; j++) {
      let k = i + j;
      if (loop) k = ((k % n) + n) % n;
      else if (k < 0 || k >= n) continue;
      sum += raw[k].elev;
      count++;
    }
    return { ...p, elev: sum / count };
  });

  let highest = points[0];
  let lowest = points[0];
  let climb = 0;
  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    if (p.elev > highest.elev) highest = p;
    if (p.elev < lowest.elev) lowest = p;
    climb += Math.max(0, p.elev - points[i - 1].elev);
  }
  if (closed) climb += Math.max(0, points[0].elev - points[points.length - 1].elev);

  // Steepest gradients over 100 m.
  const span = Math.max(1, Math.round(100 / step));
  let maxUphill = 0;
  let maxDownhill = 0;
  for (let i = 0; i + span < points.length; i++) {
    const g = (points[i + span].elev - points[i].elev) / (points[i + span].dist - points[i].dist || 1);
    maxUphill = Math.max(maxUphill, g);
    maxDownhill = Math.max(maxDownhill, -g);
  }
  return { points, highest, lowest, climb, maxUphill, maxDownhill };
}

function lngLatToTile(p: LngLat, z: number): [number, number] {
  const n = 2 ** z;
  const x = ((p[0] + 180) / 360) * n;
  const lat = (p[1] * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2) * n;
  return [x, y];
}

/** Decoded heights of one tile, row by row. */
async function loadTile(z: number, x: number, y: number, signal?: AbortSignal): Promise<Float32Array> {
  const url = TERRARIUM.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Elevación ${res.status}`);
  const bitmap = await createImageBitmap(await res.blob());
  const canvas = new OffscreenCanvas(TILE, TILE);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0, TILE, TILE);
  bitmap.close();
  const data = ctx.getImageData(0, 0, TILE, TILE).data;
  const out = new Float32Array(TILE * TILE);
  for (let i = 0; i < out.length; i++) out[i] = decodeTerrarium(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
  return out;
}

/**
 * Load the elevation tiles under the track (the most detailed zoom that
 * needs at most `maxTiles` tiles) and return a bilinear height sampler.
 */
export async function fetchHeights(coords: LngLat[], maxTiles = 12, signal?: AbortSignal): Promise<HeightSampler> {
  let z = 15;
  let tiles: [number, number][] = [];
  for (; z >= 8; z--) {
    const set = new Set<string>();
    for (const p of coords) {
      const [tx, ty] = lngLatToTile(p, z);
      // Neighbours too, so bilinear sampling near a tile edge has data.
      for (const dx of [-0.01, 0.01]) for (const dy of [-0.01, 0.01]) set.add(`${Math.floor(tx + dx)},${Math.floor(ty + dy)}`);
    }
    if (set.size <= maxTiles) {
      tiles = [...set].map((s) => s.split(',').map(Number) as [number, number]);
      break;
    }
  }
  if (!tiles.length) throw new Error('Circuito demasiado grande para la elevación');
  const data = new Map<string, Float32Array>();
  await Promise.all(tiles.map(async ([x, y]) => data.set(`${x},${y}`, await loadTile(z, x, y, signal))));
  const at = (px: number, py: number) => {
    const tx = Math.floor(px / TILE);
    const ty = Math.floor(py / TILE);
    const tile = data.get(`${tx},${ty}`);
    if (!tile) return NaN;
    return tile[(py - ty * TILE) * TILE + (px - tx * TILE)];
  };
  return (p) => {
    const [tx, ty] = lngLatToTile(p, z);
    const px = tx * TILE - 0.5;
    const py = ty * TILE - 0.5;
    const x0 = Math.floor(px);
    const y0 = Math.floor(py);
    const fx = px - x0;
    const fy = py - y0;
    const h00 = at(x0, y0);
    const h10 = at(x0 + 1, y0);
    const h01 = at(x0, y0 + 1);
    const h11 = at(x0 + 1, y0 + 1);
    return (h00 * (1 - fx) + h10 * fx) * (1 - fy) + (h01 * (1 - fx) + h11 * fx) * fy;
  };
}
