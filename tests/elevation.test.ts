import { describe, expect, it } from 'vitest';
import { decodeTerrarium, elevationProfile } from '../src/elevation';
import { LocalProjection, type LngLat } from '../src/geometry';

const proj = new LocalProjection([-3.7, 40.4]);

describe('elevation', () => {
  it('decodes Terrarium pixels', () => {
    expect(decodeTerrarium(128, 0, 0)).toBe(0);
    expect(decodeTerrarium(130, 76, 128)).toBeCloseTo(588.5);
  });

  it('finds the highest and lowest points and the climb of a lap', () => {
    // 1 km square lap on a slope rising 5 m every 100 m to the north.
    const ring: LngLat[] = [
      [0, 0],
      [250, 0],
      [250, 250],
      [0, 250],
      [0, 0],
    ].map((p) => proj.toLngLat(p as [number, number]));
    const height = (p: LngLat) => 400 + proj.toXY(p)[1] * 0.05;
    const e = elevationProfile(ring, true, height, 10, 0)!;
    expect(e.highest.elev).toBeCloseTo(412.5, 1);
    expect(e.lowest.elev).toBeCloseTo(400, 1);
    expect(e.climb).toBeCloseTo(12.5, 1);
    expect(e.maxUphill).toBeCloseTo(0.05, 3);
    expect(e.maxDownhill).toBeCloseTo(0.05, 3);
    expect(e.points.at(-1)!.dist).toBeCloseTo(1000, 0);
  });

  it('gives up where there is no data', () => {
    const line: LngLat[] = [proj.toLngLat([0, 0]), proj.toLngLat([100, 0])];
    expect(elevationProfile(line, false, () => NaN)).toBeNull();
  });
});
