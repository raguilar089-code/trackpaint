import { describe, expect, it } from 'vitest';
import type { LngLat } from '../src/geometry';
import { carAt, formatLapTime, lapProfile, telemetry, timeAtDist } from '../src/lap';
import { buildCentreline, newCircuit } from '../src/circuit';

describe('lapProfile', () => {
  it('is fast on a straight and slow in a hairpin', () => {
    const pts: LngLat[] = [
      [-3.7, 40.4],
      [-3.68, 40.4],
      [-3.68, 40.4006],
      [-3.7, 40.4006],
    ];
    const c = { ...newCircuit(), points: pts, closed: true };
    const centre = buildCentreline(c, new Map()).map((s) => s.coord);
    const p = lapProfile(centre, true)!;
    expect(p.length).toBeGreaterThan(3000);
    const top = Math.max(...p.speed);
    const low = Math.min(...p.speed);
    expect(top).toBeGreaterThan(70);
    expect(low).toBeLessThan(45);
    // ~3.5 km with two hairpins: somewhere around a minute.
    expect(p.lapTime).toBeGreaterThan(40);
    expect(p.lapTime).toBeLessThan(120);
    const half = carAt(p, p.lapTime / 2);
    expect(half.dist).toBeGreaterThan(0);
    expect(half.dist).toBeLessThan(p.length);
    expect(carAt(p, p.lapTime + 5).dist).toBeCloseTo(p.length, 3);
  });

  it('formats lap times', () => {
    expect(formatLapTime(83.456)).toBe('1:23.5');
    expect(formatLapTime(9.04)).toBe('0:09.0');
  });
});

describe('telemetry', () => {
  it('brakes before a hairpin and is in top gear on the straight', () => {
    const pts: LngLat[] = [
      [-3.7, 40.4],
      [-3.68, 40.4],
      [-3.68, 40.4006],
      [-3.7, 40.4006],
    ];
    const c = { ...newCircuit(), points: pts, closed: true };
    const p = lapProfile(buildCentreline(c, new Map()).map((s) => s.coord), true)!;
    const tel = p.speed.map((v, i) => telemetry(p, i, v));
    expect(Math.max(...tel.map((t) => t.gear))).toBe(8);
    expect(tel.some((t) => t.brake > 0.5)).toBe(true);
    expect(tel.some((t) => t.throttle === 1)).toBe(true);
    expect(timeAtDist(p, p.length / 2)).toBeGreaterThan(0);
    expect(timeAtDist(p, p.length)).toBeCloseTo(p.lapTime, 6);
    expect(formatLapTime(83.4567, 3)).toBe('1:23.457');
  });
});
