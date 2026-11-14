import { type LngLat, LocalProjection, distance } from './geometry';

/** Simple vehicle model for the lap animation and the estimated lap time. */
const V_MAX = 86; // m/s, about 310 km/h
const V_MIN = 14; // m/s
const A_LAT = 35; // lateral grip, m/s² (~3.5 g)
const A_ACC = 11; // traction-limited acceleration, m/s²
const A_BRK = 40; // braking, m/s²
const STEP = 5; // metres between profile points

export interface LapProfile {
  coords: LngLat[];
  /** Distance along the lap at each point. */
  dist: number[];
  /** Speed at each point, m/s. */
  speed: number[];
  /** Time at which the car reaches each point, s. */
  time: number[];
  length: number;
  lapTime: number;
}

function resample(line: LngLat[], step: number): LngLat[] {
  const out: LngLat[] = [line[0]];
  let carry = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1];
    const b = line[i];
    const len = distance(a, b);
    let d = step - carry;
    while (d <= len) {
      const t = d / len;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      d += step;
    }
    carry = len - (d - step);
  }
  const last = line[line.length - 1];
  if (distance(out[out.length - 1], last) > 0.5) out.push(last);
  return out;
}

/** Radius (m) of the circle through three points; Infinity when they are aligned. */
function radius(a: [number, number], b: [number, number], c: [number, number]): number {
  const ab = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const bc = Math.hypot(c[0] - b[0], c[1] - b[1]);
  const ca = Math.hypot(a[0] - c[0], a[1] - c[1]);
  const cross = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
  if (cross < 1e-6) return Infinity;
  return (ab * bc * ca) / (2 * cross);
}

/**
 * Speed along the lap: limited by grip in corners, by acceleration out of
 * them and by braking into them. Gives a plausible lap time for the track.
 */
export function lapProfile(centre: LngLat[], closed: boolean): LapProfile | null {
  if (centre.length < 2) return null;
  const coords = resample(centre, STEP);
  const n = coords.length;
  if (n < 3) return null;
  const proj = new LocalProjection(coords[0]);
  const xy = coords.map((c) => proj.toXY(c));
  const loop = closed && distance(coords[0], coords[n - 1]) < STEP;
  const m = loop ? n - 1 : n; // unique points on a loop
  const k = 3; // look ±15 m either side for curvature
  const at = (i: number) => (loop ? xy[((i % m) + m) % m] : xy[Math.max(0, Math.min(n - 1, i))]);

  const vmax: number[] = [];
  for (let i = 0; i < n; i++) {
    const r = radius(at(i - k), at(i), at(i + k));
    vmax.push(Math.max(V_MIN, Math.min(V_MAX, Math.sqrt(A_LAT * r))));
  }
  const v = vmax.slice();
  if (!loop) v[0] = 0; // standing start on an open track
  // Two rounds so the limits carry across the start line on a loop.
  for (let round = 0; round < (loop ? 2 : 1); round++) {
    for (let i = 1; i < n; i++) v[i] = Math.min(v[i], Math.sqrt(v[i - 1] ** 2 + 2 * A_ACC * STEP));
    if (loop) v[0] = v[n - 1] = Math.min(v[0], v[n - 1]);
    for (let i = n - 2; i >= 0; i--) v[i] = Math.min(v[i], Math.sqrt(v[i + 1] ** 2 + 2 * A_BRK * STEP));
    if (loop) v[0] = v[n - 1] = Math.min(v[0], v[n - 1]);
  }
  if (!loop) v[0] = Math.max(v[0], 1);

  const dist = [0];
  const time = [0];
  for (let i = 1; i < n; i++) {
    const ds = distance(coords[i - 1], coords[i]);
    dist.push(dist[i - 1] + ds);
    time.push(time[i - 1] + ds / Math.max(1, (v[i - 1] + v[i]) / 2));
  }
  return { coords, dist, speed: v, time, length: dist[n - 1], lapTime: time[n - 1] };
}

/** Position, speed and distance of the car `t` seconds into the lap. */
export function carAt(p: LapProfile, t: number): { coord: LngLat; speed: number; dist: number; index: number } {
  const { time, coords, speed, dist } = p;
  const last = time.length - 1;
  if (t >= time[last]) return { coord: coords[last], speed: speed[last], dist: dist[last], index: last };
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (time[mid] <= t) lo = mid;
    else hi = mid;
  }
  const f = (t - time[lo]) / (time[hi] - time[lo] || 1);
  const a = coords[lo];
  const b = coords[hi];
  return {
    coord: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f],
    speed: speed[lo] + (speed[hi] - speed[lo]) * f,
    dist: dist[lo] + (dist[hi] - dist[lo]) * f,
    index: lo,
  };
}

/** Lap time as m:ss.s */
export function formatLapTime(s: number): string {
  const min = Math.floor(s / 60);
  const sec = s - min * 60;
  return `${min}:${sec.toFixed(1).padStart(4, '0')}`;
}
