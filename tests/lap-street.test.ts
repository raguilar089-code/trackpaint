import { describe, expect, it } from 'vitest';
import type { LngLat } from '../src/geometry';
import { cornerSpeed, lapProfile, lapStats } from '../src/lap';
import { buildCentreline, newCircuit } from '../src/circuit';

describe('F1 2026 model', () => {
  it('takes corners at plausible speeds', () => {
    expect(cornerSpeed(15) * 3.6).toBeGreaterThan(55); // hairpin
    expect(cornerSpeed(15) * 3.6).toBeLessThan(80);
    expect(cornerSpeed(100) * 3.6).toBeGreaterThan(190); // medium-speed bend
    expect(cornerSpeed(100) * 3.6).toBeLessThan(240);
    expect(cornerSpeed(400) * 3.6).toBeGreaterThan(330); // flat out
  });

  it('gives a street-circuit lap a street-circuit average speed', () => {
    // 1.2 km × 0.6 km block with right-angle corners, following streets.
    const pts: LngLat[] = [
      [-3.7, 40.4],
      [-3.6859, 40.4],
      [-3.6859, 40.4054],
      [-3.7, 40.4054],
    ];
    const c = { ...newCircuit(), points: pts, closed: true, snapToRoads: true };
    const routes = new Map(); // straight lines between corners, then rounded
    const p = lapProfile(buildCentreline(c, routes).map((s) => s.coord), true)!;
    const s = lapStats(p);
    expect(p.length).toBeGreaterThan(3400);
    expect(s.topSpeed).toBeGreaterThan(300);
    expect(s.avgSpeed).toBeGreaterThan(140);
    expect(s.avgSpeed).toBeLessThan(250); // few corners and long straights, like Las Vegas (~240)
    expect(s.fullThrottle).toBeGreaterThan(0.3);
    expect(s.fullThrottle).toBeLessThan(0.9);
  });
});
