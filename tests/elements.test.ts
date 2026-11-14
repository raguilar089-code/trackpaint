import { describe, expect, it } from 'vitest';
import { type LngLat, LocalProjection, distance, lineLength } from '../src/geometry';
import { autoKerbs, blockRing, kerbStripes, locateOnTrack, parseElements, placeBlock, sliceLine } from '../src/elements';
import { analyzeTrack } from '../src/analysis';
import { parseCircuit } from '../src/circuit';

const proj = new LocalProjection([-3.7, 40.4]);
const ll = (x: number, y: number): LngLat => proj.toLngLat([x, y]);
// 400 m straight heading east.
const straight: LngLat[] = Array.from({ length: 41 }, (_, i) => ll(i * 10, 0));

describe('sliceLine', () => {
  it('cuts a part of the line', () => {
    const s = sliceLine(straight, 100, 160, false, 2);
    expect(lineLength(s)).toBeCloseTo(60, 0);
    expect(distance(s[0], ll(100, 0))).toBeLessThan(0.1);
  });
  it('wraps through the start of a loop', () => {
    const loop = [...straight, ...straight.slice(0, -1).reverse().map(([x, y]) => [x, y + 0.001] as LngLat), straight[0]];
    const total = lineLength(loop);
    const s = sliceLine(loop, total - 20, 30, true, 2);
    expect(lineLength(s)).toBeGreaterThan(45);
    expect(lineLength(s)).toBeLessThan(55);
  });
});

describe('locateOnTrack', () => {
  it('finds distance and side', () => {
    const left = locateOnTrack(straight, ll(120, 15));
    expect(left.dist).toBeCloseTo(120, 0);
    expect(left.side).toBe('left');
    expect(left.offset).toBeCloseTo(15, 0);
    expect(locateOnTrack(straight, ll(50, -8)).side).toBe('right');
  });
});

describe('kerbs', () => {
  it('lays stripes just outside the track edge', () => {
    const stripes = kerbStripes({ id: 'k', type: 'kerb', from: 100, to: 120, side: 'left', color: 'red' }, straight, false, 12);
    expect(stripes).toHaveLength(10);
    const inner = stripes[0].ring[0];
    expect(inner[1]).toBeGreaterThan(ll(0, 5.9)[1]);
    expect(stripes[0].color).not.toBe(stripes[1].color);
  });

  it('puts kerbs inside and outside each detected corner', () => {
    const square = [ll(0, 0), ll(300, 0), ll(300, 300), ll(0, 300), ll(0, 0)];
    const dense: LngLat[] = [];
    for (let k = 0; k < 4; k++) for (let t = 0; t < 1; t += 0.02) {
      const a = proj.toXY(square[k]);
      const b = proj.toXY(square[k + 1]);
      dense.push(proj.toLngLat([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]));
    }
    dense.push(dense[0]);
    const a = analyzeTrack(dense, true);
    const kerbs = autoKerbs(a.corners, lineLength(dense), true);
    expect(kerbs).toHaveLength(8);
    // Anticlockwise loop: corners turn left, so the inside kerb is on the left.
    expect(kerbs[0].side).toBe('left');
    expect(kerbs[1].side).toBe('right');
  });
});

describe('placeBlock', () => {
  it('sits parallel to the track, beside it on the clicked side', () => {
    const g = placeBlock('grandstand', straight, 12, ll(200, -30));
    expect(Math.round(g.bearing)).toBe(90);
    const [x, y] = proj.toXY(g.center);
    expect(x).toBeCloseTo(200, 0);
    expect(y).toBeCloseTo(-(6 + 6 + 7), 0);
    const ring = blockRing(g);
    expect(ring).toHaveLength(5);
    expect(distance(ring[0], ring[1])).toBeCloseTo(60, 0);
  });
});

describe('parseElements', () => {
  it('keeps valid elements and drops broken ones', () => {
    const els = parseElements([
      { type: 'kerb', from: 1, to: 20, side: 'left', color: 'blue' },
      { type: 'wall', coords: [[0, 0], [0, 0.001]] },
      { type: 'wall', coords: [[0, 0]] },
      { type: 'grandstand', center: [0, 0], length: 60, depth: 14, bearing: 30 },
      { type: 'spaceship' },
    ]);
    expect(els.map((e) => e.type)).toEqual(['kerb', 'wall', 'grandstand']);
  });
  it('loads old circuits without elements', () => {
    expect(parseCircuit({ points: [] }).elements).toEqual([]);
  });
});
