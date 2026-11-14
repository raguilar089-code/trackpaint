import { describe, expect, it } from 'vitest';
import { analyzeTrack } from '../src/analysis';
import { type LngLat, LocalProjection, smoothTrack } from '../src/geometry';

const proj = new LocalProjection([-3.7, 40.4]);
const ll = (x: number, y: number): LngLat => proj.toLngLat([x, y]);

/** Rectangle with sharp corners, densified so smoothing has real corners to find. */
function rectangle(w: number, h: number, ccw = true): LngLat[] {
  const corners: [number, number][] = [
    [0, 0],
    [w, 0],
    [w, h],
    [0, h],
  ];
  if (!ccw) corners.reverse();
  const out: LngLat[] = [];
  for (let k = 0; k < 4; k++) {
    const [ax, ay] = corners[k];
    const [bx, by] = corners[(k + 1) % 4];
    for (let t = 0; t < 1; t += 0.02) out.push(ll(ax + (bx - ax) * t, ay + (by - ay) * t));
  }
  out.push(out[0]);
  return out;
}

describe('analyzeTrack', () => {
  it('finds the four corners of a rectangle and its length', () => {
    const a = analyzeTrack(rectangle(400, 200), true);
    expect(a.length).toBeGreaterThan(1180);
    expect(a.length).toBeLessThan(1210);
    expect(a.corners).toHaveLength(4);
    for (const c of a.corners) expect(Math.abs(c.angle)).toBeGreaterThan(70);
    expect(a.corners.map((c) => c.number)).toEqual([1, 2, 3, 4]);
    expect(a.longestStraight).toBeGreaterThan(350);
    expect(a.longestStraight).toBeLessThanOrEqual(400);
  });

  it('tells clockwise from anticlockwise', () => {
    expect(analyzeTrack(rectangle(300, 200, true), true).direction).toBe('antihorario');
    expect(analyzeTrack(rectangle(300, 200, false), true).direction).toBe('horario');
  });

  it('counts no corners on a straight line or gentle wobble', () => {
    const line: LngLat[] = Array.from({ length: 100 }, (_, i) => ll(i * 10, Math.sin(i / 3) * 1.5));
    const a = analyzeTrack(line, false);
    expect(a.corners).toHaveLength(0);
    expect(a.direction).toBeNull();
    expect(a.longestStraight).toBeCloseTo(a.length, 0);
  });

  it('handles a smoothed hand-drawn style loop', () => {
    const pts = [ll(0, 0), ll(500, 0), ll(520, 200), ll(250, 120), ll(0, 220)];
    const centre = smoothTrack(pts, true).map((s) => s.coord);
    const a = analyzeTrack(centre, true);
    expect(a.corners.length).toBeGreaterThanOrEqual(4);
    expect(a.corners.length).toBeLessThanOrEqual(6);
  });

  it('copes with tiny inputs', () => {
    expect(analyzeTrack([], false).corners).toEqual([]);
    expect(analyzeTrack([ll(0, 0), ll(10, 0)], false).length).toBeCloseTo(10, 1);
  });
});
