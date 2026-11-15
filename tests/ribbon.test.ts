import { describe, expect, it } from 'vitest';
import { ribbonLayout } from '../src/ribbon';

describe('ribbon layout', () => {
  const plan: [number, number][] = [
    [0, 0],
    [400, 0],
    [400, 150],
    [0, 150],
  ];
  const box = { x: 100, y: 200, w: 1600, h: 1000 };

  it('fits the box and raises higher points more', () => {
    const L = ribbonLayout(plan, [100, 100, 140, 120], box);
    for (const [x, y] of [...L.top, ...L.base]) {
      expect(x).toBeGreaterThanOrEqual(box.x - 0.5);
      expect(x).toBeLessThanOrEqual(box.x + box.w + 0.5);
      expect(y).toBeGreaterThanOrEqual(box.y - 0.5);
      expect(y).toBeLessThanOrEqual(box.y + box.h + 0.5);
    }
    const wall = L.top.map((t, i) => L.base[i][1] - t[1]);
    expect(wall[2]).toBeGreaterThan(wall[3]);
    expect(wall[3]).toBeGreaterThan(wall[0]);
    expect(Math.min(...wall)).toBeGreaterThan(0);
  });

  it('puts the highest point at the back', () => {
    const L = ribbonLayout(plan, [100, 100, 100, 140], box);
    expect(L.depth[3]).toBeGreaterThan(0);
  });
});
