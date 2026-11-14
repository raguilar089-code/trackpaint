// Pure geometry helpers. Coordinates are [lng, lat] in degrees.

export type LngLat = [number, number];

/** A sampled point of the track centreline, tagged with the control segment it belongs to. */
export interface Sample {
  coord: LngLat;
  /** Index of the control point where this segment starts. */
  seg: number;
}

const EARTH_RADIUS = 6371008.8;
const toRad = (d: number) => (d * Math.PI) / 180;

/** Great-circle distance in metres. */
export function distance(a: LngLat, b: LngLat): number {
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Total length in metres of a polyline. */
export function lineLength(coords: LngLat[]): number {
  let total = 0;
  for (let i = 1; i < coords.length; i++) total += distance(coords[i - 1], coords[i]);
  return total;
}

/**
 * Local planar projection (metres) around a reference latitude. Accurate enough
 * for circuits, which span a few kilometres at most.
 */
export class LocalProjection {
  private readonly kx: number;
  private readonly ky: number;
  constructor(private readonly origin: LngLat) {
    this.ky = (Math.PI * EARTH_RADIUS) / 180;
    this.kx = this.ky * Math.cos(toRad(origin[1]));
  }
  toXY(p: LngLat): [number, number] {
    return [(p[0] - this.origin[0]) * this.kx, (p[1] - this.origin[1]) * this.ky];
  }
  toLngLat(p: [number, number]): LngLat {
    return [p[0] / this.kx + this.origin[0], p[1] / this.ky + this.origin[1]];
  }
}

type XY = [number, number];

function lerp(a: XY, b: XY, ta: number, tb: number, t: number): XY {
  const span = tb - ta;
  if (span < 1e-9) return [a[0], a[1]];
  const wa = (tb - t) / span;
  const wb = (t - ta) / span;
  return [a[0] * wa + b[0] * wb, a[1] * wa + b[1] * wb];
}

function knot(t: number, a: XY, b: XY): number {
  const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
  return t + Math.max(Math.sqrt(d), 1e-4); // centripetal (alpha = 0.5)
}

/** Points of one centripetal Catmull-Rom segment from p1 to p2 (p2 excluded). */
function catmullSegment(p0: XY, p1: XY, p2: XY, p3: XY, steps: number): XY[] {
  const t0 = 0;
  const t1 = knot(t0, p0, p1);
  const t2 = knot(t1, p1, p2);
  const t3 = knot(t2, p2, p3);
  const out: XY[] = [];
  for (let i = 0; i < steps; i++) {
    const t = t1 + ((t2 - t1) * i) / steps;
    const a1 = lerp(p0, p1, t0, t1, t);
    const a2 = lerp(p1, p2, t1, t2, t);
    const a3 = lerp(p2, p3, t2, t3, t);
    const b1 = lerp(a1, a2, t0, t2, t);
    const b2 = lerp(a2, a3, t1, t3, t);
    out.push(lerp(b1, b2, t1, t2, t));
  }
  return out;
}

/**
 * Smooth curve through the control points. Returns samples roughly every
 * `spacing` metres. A closed curve ends where it started.
 */
export function smoothTrack(points: LngLat[], closed: boolean, spacing = 3): Sample[] {
  const n = points.length;
  if (n === 0) return [];
  if (n === 1) return [{ coord: points[0], seg: 0 }];
  const proj = new LocalProjection(points[0]);
  const xy = points.map((p) => proj.toXY(p));
  const at = (i: number): XY => {
    if (closed) return xy[((i % n) + n) % n];
    if (i < 0) return [2 * xy[0][0] - xy[1][0], 2 * xy[0][1] - xy[1][1]];
    if (i >= n) return [2 * xy[n - 1][0] - xy[n - 2][0], 2 * xy[n - 1][1] - xy[n - 2][1]];
    return xy[i];
  };
  const segCount = closed && n > 2 ? n : n - 1;
  const out: Sample[] = [];
  for (let s = 0; s < segCount; s++) {
    const p1 = at(s);
    const p2 = at(s + 1);
    const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const steps = Math.min(200, Math.max(2, Math.ceil(len / spacing)));
    for (const p of catmullSegment(at(s - 1), p1, p2, at(s + 2), steps)) {
      out.push({ coord: proj.toLngLat(p), seg: s });
    }
  }
  const last = closed && n > 2 ? points[0] : points[n - 1];
  out.push({ coord: last, seg: segCount - 1 });
  return out;
}

/**
 * Left and right edges of a ribbon of the given width (metres) along a line.
 * Joins are mitred, with the mitre capped so sharp corners don't spike.
 */
export function ribbonEdges(coords: LngLat[], width: number): { left: LngLat[]; right: LngLat[] } {
  const n = coords.length;
  if (n < 2) return { left: [], right: [] };
  const proj = new LocalProjection(coords[0]);
  const xy = coords.map((c) => proj.toXY(c));
  const closed = n > 2 && distance(coords[0], coords[n - 1]) < 0.01;
  const half = width / 2;
  const dir = (a: XY, b: XY): XY => {
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
  };
  const left: LngLat[] = [];
  const right: LngLat[] = [];
  for (let i = 0; i < n; i++) {
    let prev: XY | null = null;
    let next: XY | null = null;
    if (i > 0) prev = dir(xy[i - 1], xy[i]);
    else if (closed) prev = dir(xy[n - 2], xy[0]);
    if (i < n - 1) next = dir(xy[i], xy[i + 1]);
    else if (closed) next = dir(xy[n - 1], xy[1]);
    const d0 = prev ?? next!;
    const d1 = next ?? prev!;
    let tx = d0[0] + d1[0];
    let ty = d0[1] + d1[1];
    const tl = Math.hypot(tx, ty);
    if (tl < 1e-9) {
      tx = d1[0];
      ty = d1[1];
    } else {
      tx /= tl;
      ty /= tl;
    }
    // Normal to the averaged tangent, scaled so the edge stays `half` from both segments.
    const cos = Math.max(0.35, tx * d1[0] + ty * d1[1]);
    const nx = -ty * (half / cos);
    const ny = tx * (half / cos);
    left.push(proj.toLngLat([xy[i][0] + nx, xy[i][1] + ny]));
    right.push(proj.toLngLat([xy[i][0] - nx, xy[i][1] - ny]));
  }
  return { left, right };
}

/** One quad polygon per sample step; together they form the asphalt surface. */
export function ribbonQuads(coords: LngLat[], width: number): LngLat[][] {
  const { left, right } = ribbonEdges(coords, width);
  const quads: LngLat[][] = [];
  for (let i = 0; i < left.length - 1; i++) {
    quads.push([left[i], left[i + 1], right[i + 1], right[i], left[i]]);
  }
  return quads;
}

/** Index of the sample nearest to a point (planar approximation). */
export function nearestSample(samples: Sample[], p: LngLat): number {
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < samples.length; i++) {
    const d = distance(samples[i].coord, p);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** Bearing in degrees (0 = north, clockwise) from a to b. */
export function bearing(a: LngLat, b: LngLat): number {
  const y = Math.sin(toRad(b[0] - a[0])) * Math.cos(toRad(b[1]));
  const x =
    Math.cos(toRad(a[1])) * Math.sin(toRad(b[1])) -
    Math.sin(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.cos(toRad(b[0] - a[0]));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/**
 * Douglas-Peucker simplification of a hand-drawn stroke. `tolerance` is in
 * metres: points closer than that to the simplified line are dropped.
 */
export function simplify(coords: LngLat[], tolerance: number): LngLat[] {
  if (coords.length < 3) return coords.slice();
  const proj = new LocalProjection(coords[0]);
  const xy = coords.map((c) => proj.toXY(c));
  const keep = new Uint8Array(coords.length);
  keep[0] = keep[coords.length - 1] = 1;
  const stack: [number, number][] = [[0, coords.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = xy[a];
    const [bx, by] = xy[b];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let maxD = 0;
    let idx = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = xy[i];
      let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (idx >= 0 && maxD > tolerance) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return coords.filter((_, i) => keep[i]);
}
