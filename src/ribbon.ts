// The track in relief: a ribbon seen in perspective, with walls down to a
// common base whose height follows the terrain, so you can see where the lap
// climbs and drops (like the elevation graphics in TV broadcasts).

import type { TrackAnalysis } from './analysis';
import type { ElevationPoint, ElevationProfile } from './elevation';

type XY = [number, number];

export interface RibbonStyle {
  fg: string;
  bg: string;
  panel: string;
  muted: string;
  accent: string;
  font: string;
  dark: boolean;
}

export interface RibbonLayout {
  /** Screen position of the top of the ribbon at each profile point. */
  top: XY[];
  /** Screen position of the base under each profile point. */
  base: XY[];
  /** Depth of each point (larger = further from the viewer). */
  depth: number[];
}

/**
 * Lay the ribbon out in a box: the track keeps the orientation of the map
 * (north up), tilted away from the viewer, and heights are exaggerated so
 * the climb fills up to ~30 % of the drawing (much less for flat tracks).
 */
export function ribbonLayout(
  plan: XY[],
  elev: number[],
  box: { x: number; y: number; w: number; h: number },
): RibbonLayout {
  // Same orientation as the flat map (north up), seen from the south, so
  // the shape is the one you drew.
  const rot = plan;
  const lo = Math.min(...elev);
  const hi = Math.max(...elev);
  const xs = rot.map((p) => p[0]);
  const ys = rot.map((p) => p[1]);
  const spanX = Math.max(1, Math.max(...xs) - Math.min(...xs));
  const spanY = Math.max(1, Math.max(...ys) - Math.min(...ys));
  // Fit the plan, leaving room above for the walls. A long, thin track is
  // seen from higher up so it doesn't turn into a flat line.
  const wallMin = box.h * 0.05; // even the lowest point has a short wall
  const fit = (reliefPx: number) => {
    const plainH = box.h - reliefPx - box.h * 0.06;
    let sc = box.w / spanX;
    const tl = Math.min(0.75, Math.max(0.42, (plainH * 0.8) / (spanY * sc)));
    sc = Math.min(sc, plainH / (spanY * tl));
    // Exaggerate heights, but not so much that a flat city's few metres of
    // terrain noise turn into spikes: at most 6× the real scale of the map.
    const z = hi - lo > 0.5 ? Math.min((reliefPx - wallMin) / (hi - lo), sc * 6) : 0;
    return { scale: sc, tilt: tl, zScale: z };
  };
  let { scale, tilt, zScale } = fit(box.h * 0.3);
  const used = wallMin + (hi - lo) * zScale;
  if (used < box.h * 0.3 - 1) ({ scale, tilt, zScale } = fit(used)); // flat: give the room to the plan
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const ox = box.x + (box.w - spanX * scale) / 2;
  const usedH = spanY * tilt * scale + wallMin + (hi - lo) * zScale;
  const oy = box.y + (box.h + usedH) / 2; // screen y of the nearest base point
  const top: XY[] = [];
  const base: XY[] = [];
  const depth: number[] = [];
  rot.forEach(([x, y], i) => {
    const bx = ox + (x - minX) * scale;
    const by = oy - (y - minY) * tilt * scale;
    base.push([bx, by]);
    top.push([bx, by - wallMin - (elev[i] - lo) * zScale]);
    depth.push(y);
  });
  return { top, base, depth };
}

const mix = (a: number, b: number, t: number) => Math.round(a + (b - a) * t);

/** Draw the ribbon, corner numbers and highest/lowest callouts. */
export function drawRibbon(
  ctx: CanvasRenderingContext2D,
  a: TrackAnalysis,
  e: ElevationProfile,
  box: { x: number; y: number; w: number; h: number },
  st: RibbonStyle,
) {
  const pts = e.points;
  if (pts.length < 3) return;
  const plan = pts.map((p) => a.projection.toXY(p.coord) as XY);
  const L = ribbonLayout(plan, pts.map((p) => p.elev), { x: box.x + 60, y: box.y + 110, w: box.w - 120, h: box.h - 170 });
  const n = pts.length;
  const closed = a.closed;
  const segs: number[] = [];
  for (let i = 0; i < n - 1; i++) segs.push(i);
  if (closed) segs.push(n - 1);
  const next = (i: number) => (i + 1) % n;
  // Far segments first, so nearer walls cover them.
  segs.sort((i, j) => L.depth[j] + L.depth[next(j)] - (L.depth[i] + L.depth[next(i)]));

  // Shadow of the lap on the ground, so the depth reads.
  if (closed) {
    ctx.fillStyle = st.dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)';
    ctx.beginPath();
    L.base.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.fill();
  }

  // Brushed-metal look: brightness from how the wall faces a light on the left.
  const light = -0.9;
  const road = st.dark ? '#d5d8dd' : '#9ca3af';
  const edge = st.dark ? '#7b818c' : '#4b5563';
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const i of segs) {
    const j = next(i);
    const [t1, t2, b1, b2] = [L.top[i], L.top[j], L.base[i], L.base[j]];
    if (Math.hypot(t2[0] - t1[0], t2[1] - t1[1]) < 0.01) continue;
    const dir = Math.atan2(L.depth[j] - L.depth[i], b2[0] - b1[0]);
    const lit = 0.5 + 0.5 * Math.cos(dir - light);
    const v1 = st.dark ? mix(70, 205, lit) : mix(95, 225, lit);
    const v2 = st.dark ? mix(25, 90, lit) : mix(55, 150, lit);
    const g = ctx.createLinearGradient(0, Math.min(t1[1], t2[1]), 0, Math.max(b1[1], b2[1]));
    g.addColorStop(0, `rgb(${v1},${v1},${v1 + 4})`);
    g.addColorStop(1, `rgb(${v2},${v2},${v2 + 4})`);
    ctx.fillStyle = g;
    ctx.strokeStyle = g; // a hairline of the same colour hides the seams between quads
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(t1[0], t1[1]);
    ctx.lineTo(t2[0], t2[1]);
    ctx.lineTo(b2[0], b2[1]);
    ctx.lineTo(b1[0], b1[1]);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Road surface along the top: a band seen from above, its width
    // following the perspective (wide when it runs across, thin when it runs away).
    const along = Math.hypot(t2[0] - t1[0], t2[1] - t1[1]) || 1;
    const across = 6 + 4 * Math.abs((t2[0] - t1[0]) / along);
    const nx = (-(t2[1] - t1[1]) / along) * across;
    const ny = ((t2[0] - t1[0]) / along) * across;
    const ext = 0.6 / along; // overlap neighbours slightly
    const ax = t1[0] - (t2[0] - t1[0]) * ext;
    const ay = t1[1] - (t2[1] - t1[1]) * ext;
    const bx2 = t2[0] + (t2[0] - t1[0]) * ext;
    const by2 = t2[1] + (t2[1] - t1[1]) * ext;
    ctx.fillStyle = road;
    ctx.beginPath();
    ctx.moveTo(ax + nx, ay + ny);
    ctx.lineTo(bx2 + nx, by2 + ny);
    ctx.lineTo(bx2 - nx, by2 - ny);
    ctx.lineTo(ax - nx, ay - ny);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = edge;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(ax + nx, ay + ny);
    ctx.lineTo(bx2 + nx, by2 + ny);
    ctx.moveTo(ax - nx, ay - ny);
    ctx.lineTo(bx2 - nx, by2 - ny);
    ctx.stroke();
  }

  // Start line: chequered flag on a pole.
  {
    const [sx, sy] = L.top[0];
    ctx.strokeStyle = st.fg;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx, sy - 70);
    ctx.stroke();
    const cell = 10;
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 4; c++) {
        ctx.fillStyle = (r + c) % 2 ? '#111111' : '#ffffff';
        ctx.fillRect(sx + 2 + c * cell, sy - 70 + r * cell, cell, cell);
      }
    }
  }

  // Corner numbers above the ribbon, like the reference graphics.
  const placed: XY[] = [];
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const c of a.corners) {
    let k = 0;
    let best = Infinity;
    pts.forEach((p, i) => {
      const d = Math.abs(p.dist - c.apexDist);
      if (d < best) {
        best = d;
        k = i;
      }
    });
    let [x, y] = L.top[k];
    y -= 46;
    while (placed.some(([px, py]) => Math.hypot(px - x, py - y) < 56)) y -= 30;
    placed.push([x, y]);
    ctx.strokeStyle = st.muted;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(L.top[k][0], L.top[k][1] - 10);
    ctx.lineTo(x, y + 24);
    ctx.stroke();
    ctx.fillStyle = st.accent;
    ctx.beginPath();
    ctx.arc(x, y, 24, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = `800 ${c.number > 9 ? 22 : 26}px ${st.font}`;
    ctx.fillText(String(c.number), x, y + 1);
  }

  // Highest and lowest points.
  const indexOf = (p: ElevationPoint) => pts.indexOf(p);
  const boxes: { x: number; y: number; w: number; h: number }[] = [];
  const callout = (p: ElevationPoint, high: boolean) => {
    const k = indexOf(p);
    if (k < 0) return;
    const color = high ? '#f59e0b' : '#0ea5e9';
    const [x, y] = L.top[k];
    const text = `${Math.round(p.elev)} m`;
    ctx.font = `800 40px ${st.font}`;
    const bw = ctx.measureText(text).width + 90;
    const bh = 64;
    // Above the point, to the side with more room; clear of the other callout.
    const toRight = x < box.x + box.w / 2;
    const bx = Math.min(box.x + box.w - bw, Math.max(box.x, toRight ? x + 50 : x - 50 - bw));
    let by = Math.max(box.y, y - 150);
    const hits = (yy: number) =>
      boxes.some((o) => bx < o.x + o.w + 10 && bx + bw + 10 > o.x && yy < o.y + o.h + 10 && yy + bh + 10 > o.y);
    while (hits(by) && by > box.y) by -= 40;
    boxes.push({ x: bx, y: by, w: bw, h: bh });
    ctx.strokeStyle = st.fg;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, by + bh / 2);
    ctx.lineTo(toRight ? bx : bx + bw, by + bh / 2);
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = st.panel;
    ctx.beginPath();
    ctx.roundRect(bx, by, bw, bh, 12);
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = color;
    ctx.stroke();
    const tx = bx + 34;
    const ty = by + bh / 2;
    ctx.fillStyle = color;
    ctx.beginPath();
    if (high) {
      ctx.moveTo(tx - 14, ty + 10);
      ctx.lineTo(tx + 14, ty + 10);
      ctx.lineTo(tx, ty - 14);
    } else {
      ctx.moveTo(tx - 14, ty - 10);
      ctx.lineTo(tx + 14, ty - 10);
      ctx.lineTo(tx, ty + 14);
    }
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = st.fg;
    ctx.textAlign = 'left';
    ctx.fillText(text, bx + 62, ty + 2);
  };
  if (e.highest.elev - e.lowest.elev >= 1) {
    callout(e.highest, true);
    callout(e.lowest, false);
  }

  // Note on the vertical scale.
  ctx.fillStyle = st.muted;
  ctx.font = `600 24px ${st.font}`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('Altura exagerada para ver el relieve', box.x + box.w - 10, box.y + box.h - 10);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
}
