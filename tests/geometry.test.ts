import { describe, expect, it } from 'vitest';
import { type LngLat, distance, lineLength, ribbonEdges, simplify, smoothTrack } from '../src/geometry';
import { History, buildCentreline, newCircuit, parseCircuit, segmentKey } from '../src/circuit';

// Roughly a 200 m square near Madrid.
const square: LngLat[] = [
  [-3.7, 40.4],
  [-3.69765, 40.4],
  [-3.69765, 40.4018],
  [-3.7, 40.4018],
];

describe('distance', () => {
  it('measures one degree of latitude as ~111 km', () => {
    expect(distance([0, 0], [0, 1])).toBeGreaterThan(111_000);
    expect(distance([0, 0], [0, 1])).toBeLessThan(111_400);
  });
});

describe('smoothTrack', () => {
  it('passes through every control point', () => {
    const s = smoothTrack(square, false);
    for (const p of square) {
      const nearest = Math.min(...s.map((x) => distance(x.coord, p)));
      expect(nearest).toBeLessThan(0.5);
    }
  });

  it('closes the loop back to the first point', () => {
    const s = smoothTrack(square, true);
    expect(s[0].coord).toEqual(square[0]);
    expect(s[s.length - 1].coord).toEqual(square[0]);
    expect(new Set(s.map((x) => x.seg)).size).toBe(4);
  });

  it('gives a closed loop a length close to the square perimeter', () => {
    const len = lineLength(smoothTrack(square, true).map((x) => x.coord));
    // Perimeter ~800 m; a smooth curve through the corners is a bit longer.
    expect(len).toBeGreaterThan(750);
    expect(len).toBeLessThan(950);
  });

  it('handles 0 and 1 points', () => {
    expect(smoothTrack([], false)).toEqual([]);
    expect(smoothTrack([square[0]], false)).toHaveLength(1);
  });
});

describe('ribbonEdges', () => {
  it('keeps both edges half the width away from a straight line', () => {
    const line: LngLat[] = [
      [-3.7, 40.4],
      [-3.699, 40.4],
      [-3.698, 40.4],
    ];
    const { left, right } = ribbonEdges(line, 12);
    for (let i = 0; i < line.length; i++) {
      expect(distance(left[i], line[i])).toBeCloseTo(6, 1);
      expect(distance(right[i], line[i])).toBeCloseTo(6, 1);
    }
    // Driving east, left is north.
    expect(left[1][1]).toBeGreaterThan(line[1][1]);
  });
});

describe('circuit', () => {
  it('uses routed geometry when snapping to roads', () => {
    const c = { ...newCircuit(), points: square.slice(0, 2), snapToRoads: true };
    const mid: LngLat = [-3.6988, 40.4005];
    const routes = new Map([[segmentKey(square[0], square[1]), [square[0], mid, square[1]]]]);
    expect(buildCentreline(c, routes).map((s) => s.coord)).toEqual([square[0], mid, square[1]]);
  });

  it('rejects invalid files and clamps width', () => {
    expect(() => parseCircuit({})).toThrow();
    expect(() => parseCircuit({ points: [[0, 100]] })).toThrow();
    expect(parseCircuit({ points: [], width: 999 }).width).toBe(30);
  });

  it('undoes and redoes', () => {
    const h = new History();
    const a = newCircuit('A');
    h.push(a);
    const b = { ...a, name: 'B' };
    const undone = h.undo(b)!;
    expect(undone.name).toBe('A');
    expect(h.redo(undone)!.name).toBe('B');
  });
});

describe('simplify', () => {
  it('reduces a wobbly straight stroke to its ends', () => {
    const stroke: LngLat[] = Array.from({ length: 50 }, (_, i) => [-3.7 + i * 0.0001, 40.4 + (i % 2) * 0.000005]);
    const out = simplify(stroke, 2);
    expect(out).toEqual([stroke[0], stroke[49]]);
  });

  it('keeps the corner of an L-shaped stroke', () => {
    const stroke: LngLat[] = [
      ...Array.from({ length: 20 }, (_, i): LngLat => [-3.7 + i * 0.0001, 40.4]),
      ...Array.from({ length: 20 }, (_, i): LngLat => [-3.698, 40.4 + i * 0.0001]),
    ];
    const out = simplify(stroke, 2);
    expect(out.length).toBe(3);
    expect(out[1]).toEqual([-3.698, 40.4]);
  });
});
