import { type LngLat, LocalProjection } from './geometry';

export interface Corner {
  /** 1-based corner number in driving order from the start line. */
  number: number;
  /** Apex position. */
  apex: LngLat;
  /** Index of the apex in the resampled line. */
  index: number;
  /** Total heading change in degrees; positive turns left. */
  angle: number;
  /** Where the bend starts and ends, in metres along the line (start may exceed end on a loop). */
  from: number;
  to: number;
  apexDist: number;
}

export interface TrackAnalysis {
  /** Centreline resampled every `step` metres, in metres around the first point. */
  xy: [number, number][];
  step: number;
  closed: boolean;
  length: number;
  corners: Corner[];
  /** Longest stretch without a corner, in metres. */
  longestStraight: number;
  /** For closed circuits: 'horario' (clockwise) or 'antihorario'. */
  direction: 'horario' | 'antihorario' | null;
  projection: LocalProjection;
}

/**
 * The analysis scales with the circuit: points are resampled every
 * length/300 metres (at least 5 m), so a 15 km track with wide bends finds
 * its corners just like a 1 km kart track.
 */
const MIN_STEP = 5;
const STEPS_PER_LAP = 300;
/** Heading change per step (degrees) above which a point is part of a bend. */
const TURN_PER_STEP = 2.5;
/** Minimum total heading change for a bend to count as a corner. */
const MIN_ANGLE = 20;
/** Bends in the same direction this many steps apart or closer are one corner. */
const MERGE_STEPS = 3;

function resample(xy: [number, number][], step: number): [number, number][] {
  if (xy.length < 2) return xy.slice();
  const out: [number, number][] = [xy[0]];
  let carry = 0;
  for (let i = 1; i < xy.length; i++) {
    const [ax, ay] = xy[i - 1];
    const [bx, by] = xy[i];
    const seg = Math.hypot(bx - ax, by - ay);
    let d = step - carry;
    while (d <= seg) {
      const t = d / seg;
      out.push([ax + (bx - ax) * t, ay + (by - ay) * t]);
      d += step;
    }
    carry = seg - (d - step);
  }
  const last = xy[xy.length - 1];
  const tail = out[out.length - 1];
  if (Math.hypot(last[0] - tail[0], last[1] - tail[1]) > step / 4) out.push(last);
  return out;
}

const wrap = (a: number) => {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
};

export function analyzeTrack(centreline: LngLat[], closed: boolean): TrackAnalysis {
  const projection = new LocalProjection(centreline[0] ?? [0, 0]);
  const raw = centreline.map((c) => projection.toXY(c));
  let rawLength = 0;
  for (let i = 1; i < raw.length; i++) rawLength += Math.hypot(raw[i][0] - raw[i - 1][0], raw[i][1] - raw[i - 1][1]);
  const STEP = Math.max(MIN_STEP, rawLength / STEPS_PER_LAP);
  const xy = resample(raw, STEP);
  const n = xy.length;
  const empty: TrackAnalysis = {
    xy,
    step: STEP,
    closed,
    length: 0,
    corners: [],
    longestStraight: 0,
    direction: null,
    projection,
  };
  if (n < 3) return { ...empty, length: n === 2 ? Math.hypot(xy[1][0] - xy[0][0], xy[1][1] - xy[0][1]) : 0 };

  let length = 0;
  for (let i = 1; i < n; i++) length += Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]);

  // Heading of each step and turn at each point (radians, + = left).
  const heading = (i: number) => {
    const a = xy[i];
    const b = xy[i + 1];
    return Math.atan2(b[1] - a[1], b[0] - a[0]);
  };
  const turn = new Float64Array(n);
  for (let i = 1; i < n - 1; i++) turn[i] = wrap(heading(i) - heading(i - 1));
  if (closed && n > 3) turn[0] = wrap(heading(0) - heading(n - 2)); // last point repeats the first

  // Smooth over ~25 m so hand-drawn wobble doesn't count as corners.
  const W = 2;
  const smooth = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    let c = 0;
    for (let k = -W; k <= W; k++) {
      let j = i + k;
      if (closed) j = ((j % (n - 1)) + (n - 1)) % (n - 1);
      if (j < 0 || j >= n) continue;
      s += turn[j];
      c++;
    }
    smooth[i] = s / c;
  }
  const threshold = (TURN_PER_STEP * Math.PI) / 180;
  const sign = (i: number) => (Math.abs(smooth[i]) > threshold ? Math.sign(smooth[i]) : 0);

  // Runs of bending in one direction. For a loop, start scanning at a straight point.
  const count = closed ? n - 1 : n;
  let start = 0;
  if (closed) {
    for (let i = 0; i < count; i++) {
      if (sign(i) === 0) {
        start = i;
        break;
      }
    }
  }
  type Run = { from: number; to: number; dir: number }; // positions along the scan
  const runs: Run[] = [];
  for (let p = 0; p < count; p++) {
    const i = (start + p) % count;
    const s = sign(i);
    if (s === 0) continue;
    const last = runs[runs.length - 1];
    if (last && last.dir === s && p - last.to <= MERGE_STEPS) last.to = p;
    else runs.push({ from: p, to: p, dir: s });
  }

  const corners: Corner[] = [];
  const kept: Run[] = [];
  for (const r of runs) {
    let total = 0;
    let apex = r.from;
    let peak = 0;
    for (let p = r.from; p <= r.to; p++) {
      const i = (start + p) % count;
      total += turn[i];
      if (Math.abs(smooth[i]) > peak) {
        peak = Math.abs(smooth[i]);
        apex = i;
      }
    }
    // Include the turn just outside the run, which smoothing spreads there.
    for (let k = 1; k <= W; k++) {
      total += turn[(start + r.from - k + count) % count] + turn[(start + r.to + k) % count];
    }
    const angle = (total * 180) / Math.PI;
    if (Math.abs(angle) < MIN_ANGLE) continue;
    kept.push(r);
    const at = (p: number) => (((start + p) % count) + count) % count;
    corners.push({
      number: 0,
      index: apex,
      apex: projection.toLngLat(xy[apex]),
      angle,
      from: at(r.from - W) * STEP,
      to: at(r.to + W) * STEP,
      apexDist: apex * STEP,
    });
  }
  corners.sort((a, b) => a.index - b.index);
  corners.forEach((c, k) => (c.number = k + 1));

  // Longest straight: gaps between corners (wrapping round for a loop).
  let longestStraight = 0;
  if (kept.length === 0) longestStraight = length;
  else {
    for (let k = 0; k < kept.length; k++) {
      const next = kept[k + 1];
      let gap: number;
      if (next) gap = next.from - kept[k].to;
      else if (closed) gap = count - kept[k].to + kept[0].from;
      else gap = count - 1 - kept[k].to;
      longestStraight = Math.max(longestStraight, gap * STEP);
    }
    if (!closed) longestStraight = Math.max(longestStraight, kept[0].from * STEP);
  }

  let direction: TrackAnalysis['direction'] = null;
  if (closed) {
    let area = 0;
    for (let i = 0; i < n - 1; i++) area += xy[i][0] * xy[i + 1][1] - xy[i + 1][0] * xy[i][1];
    direction = area > 0 ? 'antihorario' : 'horario';
  }

  return { ...empty, length, corners, longestStraight: Math.min(longestStraight, length), direction };
}
