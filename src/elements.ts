// Track furniture: kerbs, walls, fences, tyre barriers, run-off areas, pit lane,
// pit garages and grandstands. Pure data + geometry; rendering lives elsewhere.

import { type LngLat, LocalProjection, distance, ribbonEdges } from './geometry';
import type { Corner } from './analysis';

export type Side = 'left' | 'right';
export type KerbColor = 'red' | 'blue' | 'yellow';

/** Kerb attached to the track edge between two distances along the centreline. */
export interface KerbElement {
  id: string;
  type: 'kerb';
  from: number;
  to: number;
  side: Side;
  color: KerbColor;
}
/** Free-drawn line. */
export interface LineElement {
  id: string;
  type: 'wall' | 'fence' | 'tyres' | 'pitlane';
  coords: LngLat[];
}
/** Free-drawn area. */
export interface AreaElement {
  id: string;
  type: 'gravel' | 'runoff' | 'grass';
  ring: LngLat[];
}
/** Building placed beside the track. */
export interface BlockElement {
  id: string;
  type: 'pits' | 'grandstand';
  center: LngLat;
  /** Direction of the long side, degrees clockwise from north. */
  bearing: number;
  length: number;
  depth: number;
}
export type TrackElement = KerbElement | LineElement | AreaElement | BlockElement;
export type ElementType = TrackElement['type'];

export const ELEMENT_LABELS: Record<ElementType, string> = {
  kerb: 'Piano',
  wall: 'Muro',
  fence: 'Valla',
  tyres: 'Neumáticos',
  pitlane: 'Pit lane',
  gravel: 'Grava',
  runoff: 'Escapatoria',
  grass: 'Césped',
  pits: 'Boxes',
  grandstand: 'Grada',
};

export const KERB_WIDTH = 1.2;
const KERB_STRIPE = 2;
export const PITLANE_WIDTH = 8;
export const BLOCK_SIZES: Record<BlockElement['type'], { length: number; depth: number; height: number; gap: number }> = {
  pits: { length: 90, depth: 16, height: 7, gap: PITLANE_WIDTH + 4 },
  grandstand: { length: 60, depth: 14, height: 12, gap: 6 },
};

export const newId = () => crypto.randomUUID().slice(0, 8);

// ---------- Validation ----------

const isLngLat = (p: unknown): p is LngLat =>
  Array.isArray(p) && p.length >= 2 && Number.isFinite(Number(p[0])) && Number.isFinite(Number(p[1]));
const toLngLat = (p: unknown): LngLat => [Number((p as number[])[0]), Number((p as number[])[1])];

/** Keep only well-formed elements from stored or imported data. */
export function parseElements(data: unknown): TrackElement[] {
  if (!Array.isArray(data)) return [];
  const out: TrackElement[] = [];
  for (const raw of data) {
    if (!raw || typeof raw !== 'object') continue;
    const e = raw as Record<string, unknown>;
    const id = typeof e.id === 'string' && e.id ? e.id : newId();
    switch (e.type) {
      case 'kerb': {
        const from = Number(e.from);
        const to = Number(e.to);
        if (!Number.isFinite(from) || !Number.isFinite(to)) break;
        out.push({
          id,
          type: 'kerb',
          from,
          to,
          side: e.side === 'left' ? 'left' : 'right',
          color: e.color === 'blue' || e.color === 'yellow' ? e.color : 'red',
        });
        break;
      }
      case 'wall':
      case 'fence':
      case 'tyres':
      case 'pitlane':
        if (Array.isArray(e.coords) && e.coords.length >= 2 && e.coords.every(isLngLat)) {
          out.push({ id, type: e.type, coords: e.coords.map(toLngLat) });
        }
        break;
      case 'gravel':
      case 'runoff':
      case 'grass':
        if (Array.isArray(e.ring) && e.ring.length >= 3 && e.ring.every(isLngLat)) {
          out.push({ id, type: e.type, ring: e.ring.map(toLngLat) });
        }
        break;
      case 'pits':
      case 'grandstand': {
        const length = Number(e.length);
        const depth = Number(e.depth);
        if (!isLngLat(e.center) || !Number.isFinite(length) || !Number.isFinite(depth)) break;
        out.push({
          id,
          type: e.type,
          center: toLngLat(e.center),
          bearing: Number(e.bearing) || 0,
          length: Math.min(500, Math.max(5, length)),
          depth: Math.min(100, Math.max(3, depth)),
        });
        break;
      }
    }
  }
  return out;
}

// ---------- Geometry ----------

/** Cumulative distance (metres) at each vertex. */
export function cumulative(coords: LngLat[]): number[] {
  const out = [0];
  for (let i = 1; i < coords.length; i++) out.push(out[i - 1] + distance(coords[i - 1], coords[i]));
  return out;
}

function pointAt(coords: LngLat[], cum: number[], d: number): LngLat {
  if (d <= 0) return coords[0];
  const total = cum[cum.length - 1];
  if (d >= total) return coords[coords.length - 1];
  let i = 1;
  while (cum[i] < d) i++;
  const t = (d - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
  const a = coords[i - 1];
  const b = coords[i];
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/**
 * Part of a line between two distances, resampled every `step` metres.
 * On a closed loop, `from > to` wraps through the start line.
 */
export function sliceLine(coords: LngLat[], from: number, to: number, closed: boolean, step: number): LngLat[] {
  const cum = cumulative(coords);
  const total = cum[cum.length - 1];
  if (total <= 0) return [];
  let end = to;
  if (closed && to < from) end = to + total;
  if (!closed) {
    from = Math.max(0, Math.min(total, from));
    end = Math.max(0, Math.min(total, end));
  }
  if (end - from < 0.5) return [];
  const n = Math.max(1, Math.round((end - from) / step));
  const out: LngLat[] = [];
  for (let k = 0; k <= n; k++) {
    let d = from + ((end - from) * k) / n;
    if (closed) d = ((d % total) + total) % total;
    out.push(pointAt(coords, cum, d));
  }
  return out;
}

/** Line offset sideways by `offset` metres (left of travel direction). */
export function offsetLine(coords: LngLat[], offset: number, side: Side): LngLat[] {
  const { left, right } = ribbonEdges(coords, 2 * Math.abs(offset));
  return side === 'left' ? left : right;
}

/** Distance along the centreline and side of the track nearest to a point. */
export function locateOnTrack(centre: LngLat[], p: LngLat): { dist: number; side: Side; offset: number } {
  const proj = new LocalProjection(p);
  const xy = centre.map((c) => proj.toXY(c));
  const cum = cumulative(centre);
  let best = { dist: 0, side: 'right' as Side, offset: Infinity };
  for (let i = 1; i < xy.length; i++) {
    const [ax, ay] = xy[i - 1];
    const [bx, by] = xy[i];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, (-ax * dx - ay * dy) / len2)); // p is the origin
    const cx = ax + t * dx;
    const cy = ay + t * dy;
    const d = Math.hypot(cx, cy);
    if (d < best.offset) {
      const cross = dx * -ay - dy * -ax; // > 0: p is left of travel
      best = { dist: cum[i - 1] + t * Math.sqrt(len2), side: cross > 0 ? 'left' : 'right', offset: d };
    }
  }
  return best;
}

export interface Stripe {
  ring: LngLat[];
  color: string;
}

/** Colours sampled from the Circuit Tycoon kerb textures (kerb_*_PORTIMAO.png). */
export const KERB_COLORS: Record<KerbColor, [string, string]> = {
  red: ['#dd1745', '#d1d1d1'],
  blue: ['#2552e1', '#d1d1d1'],
  yellow: ['#e1b01d', '#242424'],
};

/** Alternating stripes of a kerb along the track edge. */
export function kerbStripes(k: KerbElement, centre: LngLat[], closed: boolean, trackWidth: number): Stripe[] {
  const path = sliceLine(centre, k.from, k.to, closed, KERB_STRIPE);
  if (path.length < 2) return [];
  const inner = offsetLine(path, trackWidth / 2, k.side);
  const outer = offsetLine(path, trackWidth / 2 + KERB_WIDTH, k.side);
  const [c1, c2] = KERB_COLORS[k.color];
  const out: Stripe[] = [];
  for (let i = 0; i < path.length - 1; i++) {
    out.push({ ring: [inner[i], inner[i + 1], outer[i + 1], outer[i], inner[i]], color: i % 2 ? c2 : c1 });
  }
  return out;
}

/** Corners of a block's footprint (closed ring). */
export function blockRing(b: BlockElement): LngLat[] {
  const proj = new LocalProjection(b.center);
  const a = (b.bearing * Math.PI) / 180;
  const ux = Math.sin(a); // along the long side
  const uy = Math.cos(a);
  const vx = -uy; // across
  const vy = ux;
  const hl = b.length / 2;
  const hd = b.depth / 2;
  const corners: [number, number][] = [
    [-hl * ux - hd * vx, -hl * uy - hd * vy],
    [hl * ux - hd * vx, hl * uy - hd * vy],
    [hl * ux + hd * vx, hl * uy + hd * vy],
    [-hl * ux + hd * vx, -hl * uy + hd * vy],
  ];
  const ring = corners.map((c) => proj.toLngLat(c));
  ring.push(ring[0]);
  return ring;
}

/**
 * Place a block beside the track at the point nearest to `p`: its long side
 * runs parallel to the track, set back from the edge on the clicked side.
 */
export function placeBlock(
  type: BlockElement['type'],
  centre: LngLat[],
  trackWidth: number,
  p: LngLat,
): BlockElement {
  const size = BLOCK_SIZES[type];
  const base: BlockElement = { id: newId(), type, center: p, bearing: 0, length: size.length, depth: size.depth };
  if (centre.length < 2) return base;
  const at = locateOnTrack(centre, p);
  const cum = cumulative(centre);
  const a = pointAt(centre, cum, Math.max(0, at.dist - 5));
  const b = pointAt(centre, cum, Math.min(cum[cum.length - 1], at.dist + 5));
  const proj = new LocalProjection(a);
  const [bx, by] = proj.toXY(b);
  const bearing = ((Math.atan2(bx, by) * 180) / Math.PI + 360) % 360;
  const onTrack = pointAt(centre, cum, at.dist);
  const offset = trackWidth / 2 + size.gap + size.depth / 2;
  const [cx, cy] = proj.toXY(onTrack);
  const l = Math.hypot(bx, by) || 1;
  // Left normal of the travel direction.
  let nx = -by / l;
  let ny = bx / l;
  if (at.side === 'right') {
    nx = -nx;
    ny = -ny;
  }
  return { ...base, bearing, center: proj.toLngLat([cx + nx * offset, cy + ny * offset]) };
}

export function moveBlock(b: BlockElement, center: LngLat): BlockElement {
  return { ...b, center };
}

/** Kerbs on the inside of every corner and on the outside at the exit. */
export function autoKerbs(corners: Corner[], lapLength: number, closed: boolean): KerbElement[] {
  const out: KerbElement[] = [];
  const clamp = (d: number) => (closed ? ((d % lapLength) + lapLength) % lapLength : Math.max(0, Math.min(lapLength, d)));
  for (const c of corners) {
    const inside: Side = c.angle > 0 ? 'left' : 'right';
    const outside: Side = inside === 'left' ? 'right' : 'left';
    out.push({ id: newId(), type: 'kerb', from: clamp(c.from), to: clamp(c.to), side: inside, color: 'red' });
    out.push({ id: newId(), type: 'kerb', from: clamp(c.apexDist), to: clamp(c.to + 20), side: outside, color: 'red' });
  }
  return out;
}

/** Walls along both sides of the whole track, a little outside the edge. */
export function autoWalls(centre: LngLat[], trackWidth: number, closed: boolean): LineElement[] {
  if (centre.length < 2) return [];
  const gap = trackWidth / 2 + 2;
  return (['left', 'right'] as Side[]).map((side) => {
    const coords = offsetLine(centre, gap, side);
    if (closed) coords[coords.length - 1] = coords[0];
    return { id: newId(), type: 'wall' as const, coords };
  });
}
