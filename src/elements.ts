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
  /**
   * Barrier that follows the track edge: `coords` are rebuilt from the
   * centreline between two distances, `gap` metres outside the edge.
   */
  attach?: EdgeAttach;
}
export interface EdgeAttach {
  from: number;
  to: number;
  side: Side;
  gap: number;
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
/**
 * Point on the track at a distance along the centreline: a sector boundary,
 * the speed trap, or the Overtake Mode detection point.
 */
export interface MarkerElement {
  id: string;
  type: 'sector' | 'speedtrap' | 'overtake';
  at: number;
}
/** Straight Mode zone (F1 2026 active aero, replaced DRS zones). */
export interface ZoneElement {
  id: string;
  type: 'straightmode';
  from: number;
  to: number;
}
/** Marshal post or recovery crane beside the track. */
export interface PostElement {
  id: string;
  type: 'marshal' | 'crane';
  at: number;
  side: Side;
}
export type TrackElement =
  | KerbElement
  | LineElement
  | AreaElement
  | BlockElement
  | MarkerElement
  | ZoneElement
  | PostElement;
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
  sector: 'Límite de sector',
  speedtrap: 'Speed trap',
  overtake: 'Detección Overtake Mode',
  straightmode: 'Zona Straight Mode',
  marshal: 'Puesto de comisarios',
  crane: 'Grúa',
};
export const MARSHAL_COLOR = '#f97316';
export const CRANE_COLOR = '#facc15';
/** Footprint and distance from the track edge (metres). */
export const POST_SIZES: Record<PostElement['type'], { length: number; depth: number; height: number; gap: number }> = {
  marshal: { length: 4, depth: 3, height: 2.6, gap: 6 },
  crane: { length: 7, depth: 3, height: 5, gap: 14 },
};

/** Classic timing-screen sector colours. */
export const SECTOR_COLORS = ['#e11d2e', '#16a3e0', '#f2c200'];
export const STRAIGHT_MODE_COLOR = '#22c55e';
export const SPEEDTRAP_COLOR = '#a855f7';
export const OVERTAKE_COLOR = '#f97316';

export const KERB_WIDTH = 1.2;
const KERB_STRIPE = 2;
export const PITLANE_WIDTH = 8;
export const BLOCK_SIZES: Record<BlockElement['type'], { length: number; depth: number; height: number; gap: number }> = {
  pits: { length: 135, depth: 14, height: 7, gap: PITLANE_WIDTH + 4 },
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
          const line: LineElement = { id, type: e.type, coords: e.coords.map(toLngLat) };
          const a = e.attach as Record<string, unknown> | undefined;
          if (a && e.type !== 'pitlane') {
            const from = Number(a.from);
            const to = Number(a.to);
            const gap = Number(a.gap);
            if ([from, to, gap].every(Number.isFinite)) {
              line.attach = { from, to, side: a.side === 'left' ? 'left' : 'right', gap: Math.max(0, gap) };
            }
          }
          out.push(line);
        }
        break;
      case 'gravel':
      case 'runoff':
      case 'grass':
        if (Array.isArray(e.ring) && e.ring.length >= 3 && e.ring.every(isLngLat)) {
          out.push({ id, type: e.type, ring: e.ring.map(toLngLat) });
        }
        break;
      case 'sector':
      case 'speedtrap':
      case 'overtake': {
        const at = Number(e.at);
        if (Number.isFinite(at)) out.push({ id, type: e.type, at });
        break;
      }
      case 'marshal':
      case 'crane': {
        const at = Number(e.at);
        if (Number.isFinite(at)) out.push({ id, type: e.type, at, side: e.side === 'left' ? 'left' : 'right' });
        break;
      }
      case 'straightmode': {
        const from = Number(e.from);
        const to = Number(e.to);
        if (Number.isFinite(from) && Number.isFinite(to)) out.push({ id, type: 'straightmode', from, to });
        break;
      }
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

export function pointAt(coords: LngLat[], cum: number[], d: number): LngLat {
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
  const total = cumulative(centre).at(-1)!;
  return (['left', 'right'] as Side[]).map((side) => {
    const attach: EdgeAttach = { from: 0, to: total, side, gap: EDGE_GAP.wall };
    return { id: newId(), type: 'wall' as const, attach, coords: edgeLine(attach, centre, closed, trackWidth) };
  });
}

/** Default distance from the track edge to a barrier that follows it (metres). */
export const EDGE_GAP: Record<'wall' | 'fence' | 'tyres', number> = { wall: 2, fence: 2.5, tyres: 3 };
/** A stroke drawn within this distance of the edge snaps onto it. */
const EDGE_SNAP = 10;
/** A stroke further out than the snap, but within this, runs parallel at its distance. */
const EDGE_FOLLOW = 40;

/**
 * Turn a barrier stroke drawn near the track into one that follows the edge:
 * it spans the same stretch of track, on the side it was drawn, right beside
 * the edge (or parallel at the drawn distance if it was drawn further out).
 * Returns null for strokes far from the track, which stay as drawn.
 */
export function attachToEdge(
  type: 'wall' | 'fence' | 'tyres',
  coords: LngLat[],
  centre: LngLat[],
  closed: boolean,
  trackWidth: number,
): EdgeAttach | null {
  if (centre.length < 2 || coords.length < 2) return null;
  const total = cumulative(centre).at(-1)!;
  const hits = coords.map((p) => locateOnTrack(centre, p));
  const offsets = hits.map((h) => h.offset - trackWidth / 2).sort((a, b) => a - b);
  const median = offsets[Math.floor(offsets.length / 2)];
  if (median > EDGE_FOLLOW) return null;
  // Side most of the stroke is on.
  const left = hits.filter((h) => h.side === 'left').length;
  const side: Side = left * 2 >= hits.length ? 'left' : 'right';
  let from = hits[0].dist;
  let to = hits[hits.length - 1].dist;
  if (closed) {
    if ((((to - from) % total) + total) % total > total / 2) [from, to] = [to, from];
  } else if (from > to) [from, to] = [to, from];
  const span = closed ? (((to - from) % total) + total) % total : to - from;
  if (span < 2) return null;
  const gap = median <= EDGE_SNAP ? EDGE_GAP[type] : Math.round(median);
  return { from, to, side, gap };
}

/** Coordinates of a barrier that follows the track edge. */
export function edgeLine(a: EdgeAttach, centre: LngLat[], closed: boolean, trackWidth: number): LngLat[] {
  const total = centre.length > 1 ? cumulative(centre).at(-1)! : 0;
  const whole = closed && a.to - a.from >= total - 0.5;
  const path = whole ? centre : sliceLine(centre, a.from, a.to, closed, 2);
  if (path.length < 2) return [];
  const line = removeLoops(offsetLine(path, trackWidth / 2 + a.gap, a.side));
  if (whole) line[line.length - 1] = line[0];
  return line;
}

/**
 * Cut out the small loops an offset line makes on the inside of a bend that
 * is tighter than the offset, so a barrier there runs straight across.
 */
export function removeLoops(coords: LngLat[], window = 80): LngLat[] {
  if (coords.length < 4) return coords;
  const proj = new LocalProjection(coords[0]);
  const xy = coords.map((c) => proj.toXY(c));
  const out: [number, number][] = [xy[0]];
  let i = 0;
  while (i < xy.length - 1) {
    const a = out[out.length - 1];
    const b = xy[i + 1];
    let cut = -1;
    let hit: [number, number] | null = null;
    // Find the furthest later segment (within the window) that crosses a→b.
    for (let j = Math.min(xy.length - 2, i + window); j >= i + 2; j--) {
      const p = segmentHit(a, b, xy[j], xy[j + 1]);
      if (p) {
        cut = j;
        hit = p;
        break;
      }
    }
    if (hit) {
      // Skip the loop: continue from the crossing along segment cut → cut+1.
      out.push(hit);
      out.push(xy[cut + 1]);
      i = cut + 1;
    } else {
      out.push(b);
      i++;
    }
  }
  return out.map((p) => proj.toLngLat(p));
}

function segmentHit(
  a: [number, number],
  b: [number, number],
  c: [number, number],
  d: [number, number],
): [number, number] | null {
  const rx = b[0] - a[0];
  const ry = b[1] - a[1];
  const sx = d[0] - c[0];
  const sy = d[1] - c[1];
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((c[0] - a[0]) * sy - (c[1] - a[1]) * sx) / den;
  const u = ((c[0] - a[0]) * ry - (c[1] - a[1]) * rx) / den;
  if (t <= 1e-9 || t >= 1 || u < 0 || u > 1) return null;
  return [a[0] + rx * t, a[1] + ry * t];
}

/** Distances along the lap where sectors 2 and 3 start (sector 1 starts at the line). */
export function sectorBounds(elements: TrackElement[]): number[] {
  return elements
    .filter((e): e is MarkerElement => e.type === 'sector')
    .map((e) => e.at)
    .sort((a, b) => a - b)
    .slice(0, 2);
}

/** Split the centreline into the three sector polylines. */
export function sectorLines(centre: LngLat[], bounds: number[]): LngLat[][] {
  if (bounds.length < 2 || centre.length < 2) return [];
  const total = cumulative(centre).at(-1)!;
  const cuts = [0, bounds[0], bounds[1], total];
  const out: LngLat[][] = [];
  for (let i = 0; i < 3; i++) out.push(sliceLine(centre, cuts[i], cuts[i + 1], false, 3));
  return out;
}

/** Short line across the track at a distance, a bit wider than the track. */
export function crossLine(centre: LngLat[], at: number, closed: boolean, trackWidth: number, extra = 3): LngLat[] {
  const seg = sliceLine(centre, at - 1, at + 1, closed, 1);
  if (seg.length < 2) return [];
  const half = trackWidth / 2 + extra;
  return [offsetLine(seg, half, 'left')[1], offsetLine(seg, half, 'right')[1]];
}

/**
 * F1-style race layout from the corners: three equal sectors, Straight Mode
 * zones on every straight of 200 m or more (from 30 m after the corner exit
 * to 80 m before the next braking point), the speed trap near the end of the
 * longest straight and the Overtake Mode detection point before the corner
 * that leads onto it.
 */
export function autoRaceLayout(corners: Corner[], lap: number, closed: boolean): TrackElement[] {
  const out: TrackElement[] = [
    { id: newId(), type: 'sector', at: lap / 3 },
    { id: newId(), type: 'sector', at: (2 * lap) / 3 },
  ];
  const wrap = (d: number) => (closed ? ((d % lap) + lap) % lap : Math.max(0, Math.min(lap, d)));
  // Straights between consecutive corners (in driving order).
  const cs = [...corners].sort((a, b) => a.apexDist - b.apexDist);
  const straights: { from: number; to: number; len: number }[] = [];
  for (let k = 0; k < cs.length; k++) {
    const next = cs[k + 1] ?? (closed ? cs[0] : null);
    const from = cs[k].to;
    let to = next ? next.from : lap;
    if (to < from) to += lap;
    straights.push({ from, to, len: to - from });
  }
  if (!closed && cs.length) straights.push({ from: 0, to: cs[0].from, len: cs[0].from });
  if (cs.length === 0) straights.push({ from: 0, to: lap, len: lap });
  for (const s of straights) {
    if (s.len < 200) continue;
    out.push({ id: newId(), type: 'straightmode', from: wrap(s.from + 30), to: wrap(s.to - 80) });
  }
  const longest = straights.reduce((a, b) => (b.len > a.len ? b : a), straights[0]);
  if (longest) {
    out.push({ id: newId(), type: 'speedtrap', at: wrap(longest.to - Math.min(120, longest.len * 0.2)) });
    out.push({ id: newId(), type: 'overtake', at: wrap(longest.from - 60) });
  }
  return out;
}

/** Position of a post beside the track, as a block so it can be drawn and extruded. */
export function postBlock(p: PostElement, centre: LngLat[], closed: boolean, trackWidth: number): BlockElement | null {
  const size = POST_SIZES[p.type];
  const seg = sliceLine(centre, p.at - 2, p.at + 2, closed, 2);
  if (seg.length < 2) return null;
  const offset = trackWidth / 2 + size.gap + size.depth / 2;
  const side = offsetLine(seg, offset, p.side);
  const proj = new LocalProjection(seg[0]);
  const [x1, y1] = proj.toXY(seg[0]);
  const [x2, y2] = proj.toXY(seg[seg.length - 1]);
  const bearing = ((Math.atan2(x2 - x1, y2 - y1) * 180) / Math.PI + 360) % 360;
  return { id: p.id, type: 'pits', center: side[1], bearing, length: size.length, depth: size.depth };
}

/**
 * Marshal posts in driving order: one on the outside of every corner and
 * more along the straights so none is more than ~250 m from the next; a
 * recovery crane on the outside of every corner, a little further back.
 */
export function autoMarshals(corners: Corner[], lap: number, closed: boolean): PostElement[] {
  const wrap = (d: number) => (closed ? ((d % lap) + lap) % lap : Math.max(0, Math.min(lap, d)));
  const posts: PostElement[] = [];
  const cranes: PostElement[] = [];
  for (const c of corners) {
    const outside: Side = c.angle > 0 ? 'right' : 'left';
    posts.push({ id: newId(), type: 'marshal', at: wrap(c.apexDist), side: outside });
    cranes.push({ id: newId(), type: 'crane', at: wrap(c.apexDist + 25), side: outside });
  }
  // Fill long gaps (also covers a track without corners).
  const sorted = [...posts].sort((a, b) => a.at - b.at);
  const anchors = sorted.length ? sorted.map((p) => p.at) : [0];
  const extra: PostElement[] = [];
  for (let i = 0; i < anchors.length; i++) {
    const a = anchors[i];
    let b = anchors[i + 1] ?? (closed ? anchors[0] + lap : lap);
    if (b <= a) b += lap;
    const gap = b - a;
    const n = Math.floor(gap / 250);
    for (let k = 1; k <= n; k++) {
      extra.push({ id: newId(), type: 'marshal', at: wrap(a + (gap * k) / (n + 1)), side: 'right' });
    }
  }
  return [...posts, ...extra, ...cranes];
}

/** Marshal post numbers (1, 2, …) in driving order. */
export function marshalNumbers(elements: TrackElement[]): Map<string, number> {
  const posts = elements.filter((e): e is PostElement => e.type === 'marshal').sort((a, b) => a.at - b.at);
  return new Map(posts.map((p, i) => [p.id, i + 1]));
}
