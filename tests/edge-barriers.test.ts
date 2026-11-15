import { describe, expect, it } from 'vitest';
import { attachToEdge, edgeLine, locateOnTrack, parseElements, removeLoops } from '../src/elements';
import { LocalProjection, type LngLat } from '../src/geometry';

const proj = new LocalProjection([-3.7, 40.4]);
const xy = (pts: [number, number][]): LngLat[] => pts.map((p) => proj.toLngLat(p));
// Straight 200 m east, then a 90° bend of radius 15 m, then 200 m north.
function lShape(): LngLat[] {
  const pts: [number, number][] = [];
  for (let x = 0; x <= 200; x += 2) pts.push([x, 0]);
  for (let a = 1; a <= 45; a++) {
    const t = (a / 45) * (Math.PI / 2);
    pts.push([200 + 15 * Math.sin(t), 15 - 15 * Math.cos(t)]);
  }
  for (let y = 17; y <= 215; y += 2) pts.push([215, y]);
  return xy(pts);
}

describe('barriers that follow the track edge', () => {
  const centre = lShape();
  const width = 12;

  it('snaps a wobbly stroke drawn beside the edge onto it', () => {
    const stroke = xy([[20, -10], [80, -7], [150, -11], [190, -9]]);
    const a = attachToEdge('wall', stroke, centre, false, width)!;
    expect(a.side).toBe('right');
    expect(a.gap).toBe(2);
    const line = edgeLine(a, centre, false, width);
    for (const p of line) expect(locateOnTrack(centre, p).offset).toBeCloseTo(width / 2 + 2, 0);
  });

  it('keeps a stroke drawn further out parallel at its distance', () => {
    const stroke = xy([[20, 26], [100, 24], [180, 25]]);
    const a = attachToEdge('fence', stroke, centre, false, width)!;
    expect(a.side).toBe('left');
    expect(a.gap).toBeGreaterThan(15);
  });

  it('leaves strokes far from the track as drawn', () => {
    expect(attachToEdge('wall', xy([[0, 300], [100, 300]]), centre, false, width)).toBeNull();
  });

  it('runs straight across the inside of a bend tighter than the offset', () => {
    const a = { from: 150, to: 300, side: 'left' as const, gap: 20 };
    const line = edgeLine(a, centre, false, width);
    // No point of the wall comes closer to the track than the asphalt edge.
    for (const p of line) expect(locateOnTrack(centre, p).offset).toBeGreaterThan(width / 2 + 1);
    expect(removeLoops(line).length).toBe(line.length);
  });

  it('survives save and load', () => {
    const [el] = parseElements([{ id: 'w', type: 'wall', coords: centre.slice(0, 2), attach: { from: 1, to: 50, side: 'left', gap: 2 } }]);
    expect(el).toMatchObject({ attach: { from: 1, to: 50, side: 'left', gap: 2 } });
  });
});
