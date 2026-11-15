import { type LngLat, LocalProjection, distance } from './geometry';

/**
 * Point-mass model of a current (2026-rules) Formula 1 car, used for the lap
 * animation, the estimated lap time and the top speed on the poster.
 * Downforce grows with the square of speed, so grip, braking and the speed a
 * corner can be taken at all rise with speed; acceleration fades towards the
 * top speed as drag catches up with the power.
 */
const V_MAX = 95; // m/s, ~340 km/h with Straight Mode open
const V_MIN = 14; // m/s
const LAT_BASE = 20; // m/s² of mechanical grip (~2 g)
const LAT_AERO = 0.0045; // extra lateral grip per (m/s)², from downforce
const ACC_BASE = 14; // m/s², traction-limited launch (~1.4 g)
const BRK_BASE = 25; // m/s² at low speed
const BRK_AERO = 0.004; // extra braking per (m/s)², ~5.5 g from top speed
const STEP = 5; // metres between profile points

/** Fastest speed through a bend of radius r (m). */
export function cornerSpeed(r: number): number {
  if (!Number.isFinite(r) || LAT_AERO * r >= 1) return V_MAX;
  return Math.max(V_MIN, Math.min(V_MAX, Math.sqrt((LAT_BASE * r) / (1 - LAT_AERO * r))));
}
const accelAt = (v: number) => Math.max(0.6, ACC_BASE * (1 - (v / (V_MAX + 2)) ** 2));
const brakeAt = (v: number) => BRK_BASE + BRK_AERO * v * v;

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
  for (let i = 0; i < n; i++) vmax.push(cornerSpeed(radius(at(i - k), at(i), at(i + k))));
  const v = vmax.slice();
  if (!loop) v[0] = 0; // standing start on an open track
  // Two rounds so the limits carry across the start line on a loop.
  for (let round = 0; round < (loop ? 2 : 1); round++) {
    for (let i = 1; i < n; i++) v[i] = Math.min(v[i], Math.sqrt(v[i - 1] ** 2 + 2 * accelAt(v[i - 1]) * STEP));
    if (loop) v[0] = v[n - 1] = Math.min(v[0], v[n - 1]);
    for (let i = n - 2; i >= 0; i--) v[i] = Math.min(v[i], Math.sqrt(v[i + 1] ** 2 + 2 * brakeAt(v[i + 1]) * STEP));
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
export function formatLapTime(s: number, decimals = 1): string {
  const min = Math.floor(s / 60);
  const sec = s - min * 60;
  return `${min}:${sec.toFixed(decimals).padStart(decimals + 3, '0')}`;
}

/** Time (s) at which the car passes a distance along the lap. */
export function timeAtDist(p: LapProfile, d: number): number {
  const { dist, time } = p;
  if (d <= 0) return 0;
  const last = dist.length - 1;
  if (d >= dist[last]) return time[last];
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (dist[mid] <= d) lo = mid;
    else hi = mid;
  }
  const f = (d - dist[lo]) / (dist[hi] - dist[lo] || 1);
  return time[lo] + (time[hi] - time[lo]) * f;
}

/** Upper speed of each gear, km/h (8-speed gearbox). */
const GEAR_TOP = [100, 140, 175, 210, 245, 280, 310, 345];

export interface Telemetry {
  gear: number;
  /** 0..1 within the rev range of the current gear. */
  rpm: number;
  throttle: number;
  brake: number;
}

/** Driver inputs and gearbox state derived from the speed profile. */
export function telemetry(p: LapProfile, index: number, speed: number): Telemetry {
  const kmh = speed * 3.6;
  let gear = GEAR_TOP.findIndex((top) => kmh <= top);
  if (gear < 0) gear = GEAR_TOP.length - 1;
  const low = gear === 0 ? 0 : GEAR_TOP[gear - 1] * 0.82;
  const rpm = Math.max(0, Math.min(1, (kmh - low) / (GEAR_TOP[gear] - low)));
  const i = Math.min(index, p.speed.length - 2);
  const ds = p.dist[i + 1] - p.dist[i] || 1;
  const accel = (p.speed[i + 1] ** 2 - p.speed[i] ** 2) / (2 * ds);
  let throttle = 0;
  let brake = 0;
  if (accel < -2) brake = Math.min(1, -accel / brakeAt(speed) + 0.25);
  else if (accel > 1 || speed >= V_MAX - 0.5) throttle = 1;
  else throttle = 0.55 + 0.45 * Math.max(0, accel); // holding speed through a corner
  return { gear: gear + 1, rpm, throttle, brake };
}

export interface LapStats {
  /** km/h */
  topSpeed: number;
  /** km/h */
  avgSpeed: number;
  lapTime: number;
  /** Share of the lap time spent at full throttle, 0..1. */
  fullThrottle: number;
}

/** Headline numbers of the simulated lap. */
export function lapStats(p: LapProfile): LapStats {
  let flat = 0;
  for (let i = 1; i < p.speed.length; i++) {
    const t = telemetry(p, i - 1, p.speed[i - 1]);
    if (t.throttle >= 1) flat += p.time[i] - p.time[i - 1];
  }
  return {
    topSpeed: Math.max(...p.speed) * 3.6,
    avgSpeed: (p.length / p.lapTime) * 3.6,
    lapTime: p.lapTime,
    fullThrottle: p.lapTime > 0 ? flat / p.lapTime : 0,
  };
}
