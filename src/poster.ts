import type { TrackAnalysis } from './analysis';
import type { LngLat } from './geometry';
import {
  KERB_COLORS,
  OVERTAKE_COLOR,
  SECTOR_COLORS,
  SPEEDTRAP_COLOR,
  STRAIGHT_MODE_COLOR,
  type TrackElement,
  CRANE_COLOR,
  MARSHAL_COLOR,
  blockRing,
  crossLine,
  marshalNumbers,
  postBlock,
  offsetLine,
  sectorBounds,
  sectorLines,
  sliceLine,
} from './elements';

import type { CityLayer } from './city';
import type { ElevationPoint, ElevationProfile } from './elevation';
import { type LapStats, formatLapTime, lapProfile, lapStats } from './lap';

export type PosterTheme = 'oscuro' | 'claro';

export interface PosterInfo {
  name: string;
  city: string;
  country: string;
  /** Loaded flag image, if the country is known. */
  flag: HTMLImageElement | null;
  /** Track width in metres. */
  width: number;
  theme: PosterTheme;
  /** Track furniture to draw (kerbs, walls, pits, grandstands…). */
  elements: TrackElement[];
  /** Track centreline, needed to place kerbs. */
  centre: LngLat[];
  /** Streets and buildings around the track, drawn faintly behind it. */
  streets?: CityLayer | null;
  /** Terrain height along the track: highest/lowest points and profile. */
  elevation?: ElevationProfile | null;
}

export const POSTER_W = 2000;
export const POSTER_H = 2828; // A-series proportions (1 : √2)

const THEMES = {
  oscuro: {
    bg: '#0e1014',
    panel: '#181b21',
    fg: '#f4f5f7',
    muted: '#9aa1ad',
    track: '#f4f5f7',
    trackEdge: '#e11d2e',
    shadow: 'rgba(0,0,0,0.6)',
    grid: 'rgba(255,255,255,0.04)',
  },
  claro: {
    bg: '#f5f2ec',
    panel: '#ffffff',
    fg: '#15171c',
    muted: '#646b78',
    track: '#15171c',
    trackEdge: '#e11d2e',
    shadow: 'rgba(0,0,0,0.18)',
    grid: 'rgba(0,0,0,0.045)',
  },
} as const;

const ACCENT = '#e11d2e';
const FONT = `system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif`;

export function formatKm(m: number) {
  return (m / 1000).toLocaleString('es-ES', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/** Shrink the font until the text fits the width. */
function fitText(ctx: CanvasRenderingContext2D, text: string, maxW: number, size: number, weight = 800) {
  let s = size;
  do {
    ctx.font = `${weight} ${s}px ${FONT}`;
    if (ctx.measureText(text).width <= maxW) break;
    s -= 4;
  } while (s > 24);
  return s;
}

/** The lap simulation only changes with the track: keep the last result. */
let lastSim: { key: string; stats: LapStats | null } | null = null;
function simulate(centre: LngLat[], closed: boolean): LapStats | null {
  const mid = centre[centre.length >> 1];
  const key = `${closed}|${centre.length}|${centre[0]}|${mid}|${centre[centre.length - 1]}`;
  if (lastSim?.key !== key) {
    const profile = lapProfile(centre, closed);
    lastSim = { key, stats: profile ? lapStats(profile) : null };
  }
  return lastSim.stats;
}

type Stat = [label: string, value: string, unit: string];
const BOX_H = 200;

/** One row of four stat boxes. */
function drawStats(ctx: CanvasRenderingContext2D, stats: Stat[], y: number, t: (typeof THEMES)[PosterTheme], bar: string) {
  const M = 120;
  const gap = 28;
  const boxW = (POSTER_W - 2 * M - gap * 3) / 4;
  ctx.textBaseline = 'top';
  stats.forEach(([label, value, unit], i) => {
    const x = M + i * (boxW + gap);
    ctx.fillStyle = t.panel;
    roundRect(ctx, x, y, boxW, BOX_H, 22);
    ctx.fill();
    ctx.fillStyle = bar;
    ctx.fillRect(x, y + 30, 8, 40);
    ctx.fillStyle = t.muted;
    ctx.font = `700 28px ${FONT}`;
    ctx.fillText(label, x + 36, y + 36, boxW - 60);
    ctx.fillStyle = t.fg;
    const vs = fitText(ctx, value, boxW - 72, 76);
    ctx.fillText(value, x + 36, y + 84 + (76 - vs));
    if (unit) {
      ctx.fillStyle = t.muted;
      ctx.font = `600 26px ${FONT}`;
      ctx.fillText(unit, x + 36, y + 160, boxW - 60);
    }
  });
}

export function drawPoster(canvas: HTMLCanvasElement, a: TrackAnalysis, info: PosterInfo) {
  const t = THEMES[info.theme];
  canvas.width = POSTER_W;
  canvas.height = POSTER_H;
  const ctx = canvas.getContext('2d')!;
  const W = POSTER_W;
  const M = 120; // outer margin

  // Background with a faint grid, like a technical drawing.
  ctx.fillStyle = t.bg;
  ctx.fillRect(0, 0, W, POSTER_H);
  ctx.strokeStyle = t.grid;
  ctx.lineWidth = 2;
  for (let x = 0; x <= W; x += 80) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, POSTER_H);
    ctx.stroke();
  }
  for (let y = 0; y <= POSTER_H; y += 80) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }
  ctx.fillStyle = ACCENT;
  ctx.fillRect(0, 0, W, 18);

  // ---- Header: flag, country, name, city ----
  let y = M + 10;
  let textX = M;
  if (info.flag) {
    const fh = 150;
    const fw = fh * (4 / 3);
    ctx.save();
    ctx.shadowColor = t.shadow;
    ctx.shadowBlur = 24;
    roundRect(ctx, M, y, fw, fh, 14);
    ctx.clip();
    ctx.drawImage(info.flag, M, y, fw, fh);
    ctx.restore();
    textX = M + fw + 50;
  }
  ctx.fillStyle = ACCENT;
  ctx.font = `800 40px ${FONT}`;
  ctx.textBaseline = 'top';
  const kicker = [info.country, info.city].filter(Boolean).join(' · ').toUpperCase() || 'CIRCUITO';
  ctx.fillText(kicker, textX, y + 4, W - textX - M);
  ctx.fillStyle = t.fg;
  const nameSize = fitText(ctx, info.name, W - textX - M, 112);
  ctx.fillText(info.name, textX, y + 60 + (112 - nameSize) / 2);
  y += 240;

  // ---- Track drawing area ----
  const elev = a.xy.length >= 2 ? (info.elevation ?? null) : null;
  const area = { x: M, y: y + 30, w: W - 2 * M, h: elev ? 1380 : 1600 };
  if (a.xy.length >= 2) drawTrack(ctx, a, area, info);
  else {
    ctx.fillStyle = t.muted;
    ctx.font = `600 48px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText('Dibuja un trazado para ver el póster', W / 2, area.y + area.h / 2);
    ctx.textAlign = 'left';
  }

  // ---- Stats ----
  const left = a.corners.filter((c) => c.angle > 0).length;
  const right = a.corners.length - left;
  const sim = a.xy.length >= 2 ? simulate(info.centre, a.closed) : null;
  const track: Stat[] = [
    ['LONGITUD', formatKm(a.length), 'km'],
    ['CURVAS', String(a.corners.length), `${right} a derecha · ${left} a izquierda`],
    a.longestStraight >= 1000
      ? ['RECTA MÁS LARGA', formatKm(a.longestStraight), 'km']
      : ['RECTA MÁS LARGA', String(Math.round(a.longestStraight)), 'm'],
    a.direction
      ? ['SENTIDO', a.direction === 'horario' ? 'Horario' : 'Antihorario', '']
      : ['ANCHO DE PISTA', info.width.toLocaleString('es-ES'), 'm'],
  ];
  const car: Stat[] = sim
    ? [
        ['VUELTA', formatLapTime(sim.lapTime, 3), a.closed ? 'vuelta lanzada' : 'desde parado'],
        ['VELOCIDAD PUNTA', String(Math.round(sim.topSpeed)), 'km/h'],
        ['VELOCIDAD MEDIA', String(Math.round(sim.avgSpeed)), 'km/h'],
        ['A FONDO', String(Math.round(sim.fullThrottle * 100)), '% de la vuelta'],
      ]
    : [];
  let rowY = area.y + area.h + 50;
  drawStats(ctx, track, rowY, t, ACCENT);
  if (car.length) {
    rowY += BOX_H + 84;
    ctx.fillStyle = t.muted;
    ctx.font = `800 26px ${FONT}`;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('SIMULACIÓN CON UN FÓRMULA 1 DE 2026 · ESTIMACIÓN', M, rowY - 22);
    ctx.textBaseline = 'top';
    drawStats(ctx, car, rowY, t, '#a855f7');
  }
  if (elev) {
    rowY += BOX_H + 84;
    ctx.fillStyle = t.muted;
    ctx.font = `800 26px ${FONT}`;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('PERFIL DE ELEVACIÓN', M, rowY - 22);
    drawElevation(ctx, elev, a, { x: M, y: rowY, w: W - 2 * M, h: 240 }, t);
  }

  // ---- Footer ----
  const fy = POSTER_H - M + 20;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = t.fg;
  ctx.font = `800 40px ${FONT}`;
  ctx.fillText('Track', M, fy);
  const tw = ctx.measureText('Track').width;
  ctx.fillStyle = ACCENT;
  ctx.fillText('Paint', M + tw, fy);
  ctx.fillStyle = t.muted;
  ctx.font = `500 28px ${FONT}`;
  ctx.textAlign = 'right';
  const date = new Date().toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
  const credits = elev ? 'Datos © OpenStreetMap, elevación Mapzen/AWS' : 'Datos © OpenStreetMap';
  ctx.fillText(`Ancho de pista ${info.width.toLocaleString('es-ES')} m  ·  ${date}  ·  ${credits}`, W - M, fy);
  ctx.textAlign = 'left';
}

function elementPoints(e: TrackElement): LngLat[] {
  switch (e.type) {
    case 'kerb':
      return [];
    case 'gravel':
    case 'runoff':
    case 'grass':
      return e.ring;
    case 'pits':
    case 'grandstand':
      return blockRing(e);
    case 'sector':
    case 'speedtrap':
    case 'overtake':
    case 'straightmode':
    case 'marshal':
    case 'crane':
      return [];
    default:
      return e.coords;
  }
}

const CITY = {
  oscuro: {
    water: '#16304a',
    park: '#16291d',
    building: 'rgba(255,255,255,0.11)',
    road: 'rgba(255,255,255,0.30)',
    major: 'rgba(255,255,255,0.48)',
  },
  claro: {
    water: '#c4dbeb',
    park: '#d9e6cf',
    building: 'rgba(20,23,28,0.12)',
    road: 'rgba(20,23,28,0.24)',
    major: 'rgba(20,23,28,0.40)',
  },
} as const;

/** The city map behind the track: water, parks, buildings and streets, fading out at the edges. */
function drawCity(
  ctx: CanvasRenderingContext2D,
  city: CityLayer,
  area: { x: number; y: number; w: number; h: number },
  theme: PosterTheme,
  P: (c: LngLat) => [number, number],
  scale: number,
) {
  // The city is the slow part (thousands of shapes): draw it once into its own
  // canvas and reuse it while only the texts or the theme-independent bits change.
  const key = `${theme}|${area.x},${area.y},${area.w},${area.h}|${P([0, 0]).join(',')}|${scale}`;
  let layer = cityCache.get(city);
  if (!layer || layer.key !== key) {
    layer = { key, canvas: renderCity(city, area, theme, P, scale) };
    cityCache.set(city, layer);
  }
  ctx.drawImage(layer.canvas, area.x, area.y);
}

const cityCache = new WeakMap<CityLayer, { key: string; canvas: HTMLCanvasElement }>();

function renderCity(
  city: CityLayer,
  area: { x: number; y: number; w: number; h: number },
  theme: PosterTheme,
  toCanvas: (c: LngLat) => [number, number],
  scale: number,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(area.w);
  canvas.height = Math.ceil(area.h);
  const ctx = canvas.getContext('2d')!;
  ctx.translate(-area.x, -area.y);
  // Shapes entirely outside the drawing area, or smaller than a pixel, are skipped.
  const P = toCanvas;
  const visible = (ring: LngLat[], minSize: number) => {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const q of ring) {
      const [x, y] = P(q);
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    if (x1 < area.x || x0 > area.x + area.w || y1 < area.y || y0 > area.y + area.h) return false;
    return x1 - x0 >= minSize || y1 - y0 >= minSize;
  };
  const c = CITY[theme];
  ctx.save();
  roundRect(ctx, area.x, area.y, area.w, area.h, 28);
  ctx.clip();
  const rings = (polys: LngLat[][][], minSize = 0) => {
    ctx.beginPath();
    for (const poly of polys) {
      if (!poly.length || !visible(poly[0], minSize)) continue;
      for (const ring of poly) {
        ring.forEach((q, i) => {
          const [x, y] = P(q);
          if (i) ctx.lineTo(x, y);
          else ctx.moveTo(x, y);
        });
        ctx.closePath();
      }
    }
  };
  ctx.fillStyle = c.park;
  rings(city.parks);
  ctx.fill('evenodd');
  ctx.fillStyle = c.water;
  rings(city.water);
  ctx.fill('evenodd');
  ctx.fillStyle = c.building;
  rings(city.buildings, 1.2);
  ctx.fill('evenodd');
  // Street widths in metres, drawn to scale but never thinner than a hairline.
  const widths = { service: 4, minor: 7, medium: 11, major: 16 } as const;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const kind of ['service', 'minor', 'medium', 'major'] as const) {
    ctx.strokeStyle = kind === 'major' || kind === 'medium' ? c.major : c.road;
    ctx.lineWidth = Math.max(kind === 'service' ? 1 : 1.6, widths[kind] * scale);
    ctx.beginPath();
    for (const r of city.roads) {
      if (r.kind !== kind || !visible(r.coords, 0)) continue;
      r.coords.forEach((q, i) => {
        const [x, y] = P(q);
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      });
    }
    ctx.stroke();
  }
  // Fade into the poster background towards the edges.
  const bg = THEMES[theme].bg;
  const fade = 110;
  const edge = (x0: number, y0: number, x1: number, y1: number, x: number, y: number, w: number, h: number) => {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, bg);
    g.addColorStop(1, bg + '00');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
  };
  const { x, y, w, h } = area;
  edge(x, y, x + fade, y, x, y, fade, h);
  edge(x + w, y, x + w - fade, y, x + w - fade, y, fade, h);
  edge(x, y, x, y + fade, x, y, w, fade);
  edge(x, y + h, x, y + h - fade, x, y + h - fade, w, fade);
  ctx.restore();
  return canvas;
}

function drawTrack(
  ctx: CanvasRenderingContext2D,
  a: TrackAnalysis,
  area: { x: number; y: number; w: number; h: number },
  info: PosterInfo,
) {
  const theme = info.theme;
  const t = THEMES[theme];
  const pad = 130; // room for corner labels
  const extra = info.elements.flatMap(elementPoints).map((p) => a.projection.toXY(p));
  const xs = [...a.xy, ...extra].map((p) => p[0]);
  const ys = [...a.xy, ...extra].map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = Math.max(maxX - minX, 1);
  const spanY = Math.max(maxY - minY, 1);
  const scale = Math.min((area.w - 2 * pad) / spanX, (area.h - 2 * pad) / spanY);
  const ox = area.x + (area.w - spanX * scale) / 2;
  const oy = area.y + (area.h - spanY * scale) / 2;
  // Map metres to canvas pixels (north up).
  const P = (p: [number, number]): [number, number] => [ox + (p[0] - minX) * scale, oy + (maxY - p[1]) * scale];
  const pts = a.xy.map(P);

  const path = () => {
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    if (a.closed) ctx.closePath();
  };
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  const L = (coords: LngLat[]) => coords.map((c) => P(a.projection.toXY(c)));
  const trace = (pts2: [number, number][], close = false) => {
    ctx.beginPath();
    pts2.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    if (close) ctx.closePath();
  };
  const AREA_COLORS = {
    gravel: theme === 'oscuro' ? '#6b5f48' : '#e3d3ae',
    runoff: theme === 'oscuro' ? '#2b2f36' : '#c9ccd1',
    grass: theme === 'oscuro' ? '#1f3d26' : '#b9d7b4',
  };
  const ONTOP = theme === 'oscuro' ? '#c7cbd1' : '#6b7280';

  if (info.streets) drawCity(ctx, info.streets, area, theme, (c) => P(a.projection.toXY(c)), scale);

  // Areas and pit lane go under the track.
  for (const e of info.elements) {
    if (e.type === 'gravel' || e.type === 'runoff' || e.type === 'grass') {
      ctx.fillStyle = AREA_COLORS[e.type];
      trace(L(e.ring), true);
      ctx.fill();
    } else if (e.type === 'pitlane') {
      ctx.strokeStyle = theme === 'oscuro' ? '#5b6170' : '#9aa1ad';
      ctx.lineWidth = 14;
      trace(L(e.coords));
      ctx.stroke();
    }
  }

  // Straight Mode zones: a green glow under the track.
  const zones = info.elements
    .filter((e) => e.type === 'straightmode')
    .sort((x, y) => (x as { from: number }).from - (y as { from: number }).from);
  for (const z of zones) {
    if (z.type !== 'straightmode') continue;
    ctx.strokeStyle = STRAIGHT_MODE_COLOR;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 70;
    trace(L(sliceLine(info.centre, z.from, z.to, a.closed, 4)));
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  const bounds = sectorBounds(info.elements);
  const sectors = bounds.length === 2 ? sectorLines(info.centre, bounds) : [];

  ctx.save();
  ctx.shadowColor = t.shadow;
  ctx.shadowBlur = 40;
  ctx.shadowOffsetY = 12;
  ctx.strokeStyle = sectors.length ? t.track : t.trackEdge;
  ctx.lineWidth = 44;
  path();
  ctx.stroke();
  ctx.restore();
  ctx.strokeStyle = t.track;
  ctx.lineWidth = 28;
  path();
  ctx.stroke();
  // Track coloured by sector, like a timing screen.
  sectors.forEach((line, i) => {
    if (line.length < 2) return;
    ctx.strokeStyle = SECTOR_COLORS[i];
    ctx.lineWidth = 20;
    ctx.lineCap = 'butt';
    trace(L(line));
    ctx.stroke();
    ctx.lineCap = 'round';
  });

  // Kerbs: red/white (or blue, yellow) dashes just outside the track edge.
  const edgeOffset = (22 + 4) / scale; // metres that land just outside the drawn track
  for (const e of info.elements) {
    if (e.type !== 'kerb') continue;
    const path2 = sliceLine(info.centre, e.from, e.to, a.closed, 2);
    if (path2.length < 2) continue;
    const kp = L(offsetLine(path2, edgeOffset, e.side));
    const [c1, c2] = KERB_COLORS[e.color];
    ctx.lineCap = 'butt';
    ctx.lineWidth = 9;
    ctx.strokeStyle = c2;
    trace(kp);
    ctx.stroke();
    ctx.setLineDash([12, 12]);
    ctx.strokeStyle = c1;
    trace(kp);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineCap = 'round';
  }

  // Walls, fences and tyre barriers.
  for (const e of info.elements) {
    if (e.type !== 'wall' && e.type !== 'fence' && e.type !== 'tyres') continue;
    ctx.strokeStyle = e.type === 'tyres' ? (theme === 'oscuro' ? '#9aa1ad' : '#111111') : ONTOP;
    ctx.lineWidth = e.type === 'wall' ? 6 : 5;
    ctx.setLineDash(e.type === 'fence' ? [10, 8] : e.type === 'tyres' ? [0.1, 10] : []);
    trace(L(e.coords));
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Pits and grandstands, labelled.
  for (const e of info.elements) {
    if (e.type !== 'pits' && e.type !== 'grandstand') continue;
    const ring = L(blockRing(e));
    ctx.fillStyle = e.type === 'grandstand' ? '#2f6fd6' : theme === 'oscuro' ? '#e9eaec' : '#4b5563';
    trace(ring, true);
    ctx.fill();
    const [cx, cy] = P(a.projection.toXY(e.center));
    const lenPx = Math.hypot(ring[1][0] - ring[0][0], ring[1][1] - ring[0][1]);
    let ang = Math.atan2(ring[1][1] - ring[0][1], ring[1][0] - ring[0][0]);
    if (ang > Math.PI / 2) ang -= Math.PI;
    if (ang < -Math.PI / 2) ang += Math.PI;
    const label = e.type === 'grandstand' ? 'GRADA' : 'BOXES';
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(ang);
    ctx.fillStyle = e.type === 'grandstand' ? '#ffffff' : theme === 'oscuro' ? '#15171c' : '#ffffff';
    ctx.font = `800 ${Math.max(14, Math.min(30, lenPx / 7))}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (lenPx > 50) ctx.fillText(label, 0, 1);
    ctx.restore();
  }

  // Tangent/normal at a point index, in canvas space.
  const dirAt = (i: number) => {
    const j = Math.min(i + 1, pts.length - 1);
    const k = Math.max(j - 2, 0);
    const dx = pts[j][0] - pts[k][0];
    const dy = pts[j][1] - pts[k][1];
    const l = Math.hypot(dx, dy) || 1;
    return { tx: dx / l, ty: dy / l, nx: -dy / l, ny: dx / l };
  };

  // Start/finish: chequered bar across the track.
  const drawChequer = (i: number) => {
    const { tx, ty, nx, ny } = dirAt(i);
    const [cx, cy] = pts[i];
    const cells = 6;
    const cell = 11;
    const across = cells * cell;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.transform(nx, ny, tx, ty, 0, 0);
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < cells; c++) {
        ctx.fillStyle = (r + c) % 2 ? '#111111' : '#ffffff';
        ctx.fillRect(-across / 2 + c * cell, -cell + r * cell, cell, cell);
      }
    }
    ctx.strokeStyle = '#111111';
    ctx.lineWidth = 2;
    ctx.strokeRect(-across / 2, -cell, across, 2 * cell);
    ctx.restore();
  };
  drawChequer(0);
  if (!a.closed) drawChequer(pts.length - 1);

  // Direction arrow a little after the start line, beside the track.
  {
    const i = Math.min(Math.round(pts.length * 0.04) + 6, pts.length - 1);
    const { tx, ty, nx, ny } = dirAt(i);
    const off = 58;
    const [cx, cy] = [pts[i][0] + nx * off, pts[i][1] + ny * off];
    ctx.save();
    ctx.translate(cx, cy);
    ctx.transform(tx, ty, -ty, tx, 0, 0);
    ctx.fillStyle = ACCENT;
    ctx.beginPath();
    ctx.moveTo(-34, -6);
    ctx.lineTo(10, -6);
    ctx.lineTo(10, -20);
    ctx.lineTo(38, 0);
    ctx.lineTo(10, 20);
    ctx.lineTo(10, 6);
    ctx.lineTo(-34, 6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // Corner numbers, placed on the outside of each bend.
  const badges: [number, number][] = [];
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const c of a.corners) {
    const { nx, ny } = dirAt(c.index);
    const side = c.angle > 0 ? -1 : 1; // left turn: outside is to the right
    // Canvas y points down, so the canvas normal's handedness is flipped.
    const off = 78;
    const [px, py] = pts[c.index];
    const lx = px - nx * off * side;
    const ly = py - ny * off * side;
    badges.push([lx, ly]);
    ctx.fillStyle = ACCENT;
    ctx.beginPath();
    ctx.arc(lx, ly, 34, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.strokeStyle = t.bg;
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = `800 ${c.number > 9 ? 30 : 36}px ${FONT}`;
    ctx.fillText(String(c.number), lx, ly + 2);
  }
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';

  // Marshal posts (numbered orange dots) and recovery cranes (yellow squares).
  const postNo = marshalNumbers(info.elements);
  const postGap = (22 + 26) / scale; // metres, so posts sit clear of the drawn track
  for (const e of info.elements) {
    if (e.type !== 'marshal' && e.type !== 'crane') continue;
    const b = postBlock(e, info.centre, a.closed, 0);
    if (!b) continue;
    const seg = sliceLine(info.centre, e.at - 1, e.at + 1, a.closed, 1);
    if (seg.length < 2) continue;
    const pos = offsetLine(seg, postGap + (e.type === 'crane' ? 26 / scale : 0), e.side)[1];
    const [x, y] = P(a.projection.toXY(pos));
    ctx.lineWidth = 3;
    ctx.strokeStyle = t.bg;
    if (e.type === 'marshal') {
      ctx.fillStyle = MARSHAL_COLOR;
      ctx.beginPath();
      ctx.arc(x, y, 15, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.font = `800 15px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(postNo.get(e.id) ?? ''), x, y + 1);
    } else {
      ctx.fillStyle = CRANE_COLOR;
      roundRect(ctx, x - 12, y - 12, 24, 24, 4);
      ctx.fill();
      ctx.stroke();
    }
  }
  ctx.textAlign = 'left';

  // Sector boundaries, speed trap and Overtake Mode detection: bars across the track.
  const markerLen = 62 / scale; // metres either side of the centre line
  const tag = (text: string, color: string, x: number, y: number) => {
    ctx.font = `800 24px ${FONT}`;
    const w = ctx.measureText(text).width + 20;
    ctx.fillStyle = color;
    roundRect(ctx, x, y - 18, w, 36, 8);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + 10, y + 1);
  };
  const bar = (at: number, color: string, text: string) => {
    const l = crossLine(info.centre, at, a.closed, 0, markerLen);
    if (l.length < 2) return;
    const [p1, p2] = L(l);
    ctx.strokeStyle = color;
    ctx.lineWidth = 8;
    ctx.lineCap = 'round';
    trace([p1, p2]);
    ctx.stroke();
    // Label beyond the end of the bar that is further from the circuit's middle.
    const mid = [area.x + area.w / 2, area.y + area.h / 2];
    const far = Math.hypot(p1[0] - mid[0], p1[1] - mid[1]) > Math.hypot(p2[0] - mid[0], p2[1] - mid[1]) ? p1 : p2;
    const right = far[0] >= mid[0];
    ctx.font = `800 24px ${FONT}`;
    const w = ctx.measureText(text).width + 20;
    tag(text, color, right ? far[0] + 10 : far[0] - 10 - w, far[1]);
  };
  bounds.forEach((at, i) => bar(at, SECTOR_COLORS[i + 1], `S${i + 2}`));
  for (const e of info.elements) {
    if (e.type === 'speedtrap') bar(e.at, SPEEDTRAP_COLOR, 'SPEED TRAP');
    if (e.type === 'overtake') bar(e.at, OVERTAKE_COLOR, 'DETECCIÓN');
  }
  zones.forEach((z, i) => {
    if (z.type !== 'straightmode') return;
    const l = crossLine(info.centre, z.from, a.closed, 0, markerLen);
    if (l.length < 2) return;
    const [p1, p2] = L(l);
    const mid = [area.x + area.w / 2, area.y + area.h / 2];
    const far = Math.hypot(p1[0] - mid[0], p1[1] - mid[1]) > Math.hypot(p2[0] - mid[0], p2[1] - mid[1]) ? p1 : p2;
    tag(`SM${i + 1}`, '#15803d', far[0] + (far[0] >= mid[0] ? 6 : -70), far[1]);
  });

  // Highest and lowest points of the lap, with a callout like a TV graphic.
  if (info.elevation && info.elevation.highest.elev - info.elevation.lowest.elev >= 1) {
    const mid: [number, number] = [area.x + area.w / 2, area.y + area.h / 2];
    const callout = (p: ElevationPoint, high: boolean) => {
      const [px, py] = P(a.projection.toXY(p.coord));
      // Push the box away from the middle of the circuit, staying inside the area.
      let dx = px - mid[0];
      let dy = py - mid[1];
      const l = Math.hypot(dx, dy) || 1;
      dx /= l;
      dy /= l;
      const text = `${Math.round(p.elev)} m`;
      ctx.font = `800 40px ${FONT}`;
      const bw = ctx.measureText(text).width + 90;
      const bh = 64;
      // Away from the middle first; turn the direction if a corner number is in the way.
      const place = (ang: number, dist: number) => {
        const c = Math.cos(ang);
        const sn = Math.sin(ang);
        const ux = dx * c - dy * sn;
        const uy = dx * sn + dy * c;
        const x = Math.min(area.x + area.w - bw - 4, Math.max(area.x + 4, px + ux * dist - bw / 2));
        const y = Math.min(area.y + area.h - bh - 4, Math.max(area.y + 4, py + uy * dist - bh / 2));
        const clash = badges.some(([cx, cy]) => {
          const nx = Math.max(x, Math.min(x + bw, cx));
          const ny = Math.max(y, Math.min(y + bh, cy));
          return Math.hypot(cx - nx, cy - ny) < 46;
        }) || pts.some(([qx, qy]) => qx > x - 26 && qx < x + bw + 26 && qy > y - 26 && qy < y + bh + 26);
        return { x, y, clash };
      };
      const tries: [number, number][] = [[0, 130], [0.6, 150], [-0.6, 150], [0, 200], [1.2, 160], [-1.2, 160], [0, 280]];
      let spot = place(...tries[0]);
      for (const [ang, dist] of tries) {
        spot = place(ang, dist);
        if (!spot.clash) break;
      }
      if (spot.clash) spot = place(0, 130);
      const bx = spot.x;
      const by = spot.y;
      const color = high ? '#f59e0b' : '#0ea5e9';
      ctx.strokeStyle = t.fg;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(Math.min(bx + bw, Math.max(bx, px)), Math.min(by + bh, Math.max(by, py)));
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(px, py, 13, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = t.panel;
      roundRect(ctx, bx, by, bw, bh, 12);
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = color;
      ctx.stroke();
      // ▲ / ▼ then the height.
      ctx.fillStyle = color;
      ctx.beginPath();
      const tx = bx + 34;
      const ty = by + bh / 2;
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
      ctx.fillStyle = t.fg;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, bx + 62, ty + 2);
    };
    callout(info.elevation.highest, true);
    callout(info.elevation.lowest, false);
  }

  // Legend for whatever race markings are present.
  const legend: [string, string][] = [];
  if (sectors.length) SECTOR_COLORS.forEach((c, i) => legend.push([c, `Sector ${i + 1}`]));
  if (zones.length) legend.push([STRAIGHT_MODE_COLOR, 'Zona Straight Mode']);
  if (info.elements.some((e) => e.type === 'speedtrap')) legend.push([SPEEDTRAP_COLOR, 'Speed trap']);
  if (info.elements.some((e) => e.type === 'overtake')) legend.push([OVERTAKE_COLOR, 'Detección Overtake Mode']);
  if (info.elements.some((e) => e.type === 'marshal')) legend.push([MARSHAL_COLOR, 'Puesto de comisarios']);
  if (info.elements.some((e) => e.type === 'crane')) legend.push([CRANE_COLOR, 'Grúa']);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  legend.forEach(([color, text], i) => {
    const ly = area.y + area.h - 40 - (legend.length - 1 - i) * 44;
    ctx.fillStyle = color;
    roundRect(ctx, area.x + 10, ly - 7, 46, 14, 7);
    ctx.fill();
    ctx.fillStyle = t.muted;
    ctx.font = `600 28px ${FONT}`;
    ctx.fillText(text, area.x + 72, ly + 1);
  });

  // North arrow and scale bar, bottom-right of the area.
  const bx = area.x + area.w - 40;
  const by = area.y + area.h - 40;
  ctx.fillStyle = t.muted;
  ctx.strokeStyle = t.muted;
  ctx.beginPath();
  ctx.moveTo(bx, by - 120);
  ctx.lineTo(bx - 18, by - 74);
  ctx.lineTo(bx, by - 84);
  ctx.lineTo(bx + 18, by - 74);
  ctx.closePath();
  ctx.fill();
  ctx.font = `800 30px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.fillText('N', bx, by - 66);

  const nice = [10, 20, 50, 100, 200, 250, 500, 1000, 2000, 5000];
  const target = 260 / scale; // metres in ~260 px
  const metres = nice.reduce((best, v) => (Math.abs(v - target) < Math.abs(best - target) ? v : best), nice[0]);
  const len = metres * scale;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(bx - 60 - len, by);
  ctx.lineTo(bx - 60, by);
  ctx.moveTo(bx - 60 - len, by - 12);
  ctx.lineTo(bx - 60 - len, by + 12);
  ctx.moveTo(bx - 60, by - 12);
  ctx.lineTo(bx - 60, by + 12);
  ctx.stroke();
  ctx.font = `600 28px ${FONT}`;
  ctx.fillText(metres >= 1000 ? `${metres / 1000} km` : `${metres} m`, bx - 60 - len / 2, by - 48);
  ctx.textAlign = 'left';
}

/** Height along the lap as a filled profile, with the corner numbers and the key figures. */
function drawElevation(
  ctx: CanvasRenderingContext2D,
  e: ElevationProfile,
  a: TrackAnalysis,
  box: { x: number; y: number; w: number; h: number },
  t: (typeof THEMES)[PosterTheme],
) {
  ctx.fillStyle = t.panel;
  roundRect(ctx, box.x, box.y, box.w, box.h, 22);
  ctx.fill();
  const statsW = 520;
  const chart = { x: box.x + 36, y: box.y + 34, w: box.w - statsW - 72, h: box.h - 80 };
  const pts = e.points;
  const total = pts[pts.length - 1].dist || 1;
  const lo = e.lowest.elev;
  const hi = e.highest.elev;
  // At least 20 m of vertical range, so flat tracks look flat.
  const range = Math.max(20, hi - lo);
  const base = lo - (range - (hi - lo)) / 2 - range * 0.08;
  const top = base + range * 1.16;
  const X = (d: number) => chart.x + (d / total) * chart.w;
  const Y = (h: number) => chart.y + chart.h - ((h - base) / (top - base)) * chart.h;

  const grad = ctx.createLinearGradient(0, chart.y, 0, chart.y + chart.h);
  grad.addColorStop(0, 'rgba(225,29,46,0.55)');
  grad.addColorStop(1, 'rgba(225,29,46,0.04)');
  ctx.beginPath();
  ctx.moveTo(X(0), chart.y + chart.h);
  for (const p of pts) ctx.lineTo(X(p.dist), Y(p.elev));
  ctx.lineTo(X(total), chart.y + chart.h);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(X(p.dist), Y(p.elev)) : ctx.moveTo(X(p.dist), Y(p.elev))));
  ctx.strokeStyle = ACCENT;
  ctx.lineWidth = 5;
  ctx.lineJoin = 'round';
  ctx.stroke();

  // Corner numbers under the curve.
  ctx.fillStyle = t.muted;
  ctx.font = `700 20px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  let lastX = -Infinity;
  for (const c of a.corners) {
    const x = X(c.apexDist);
    if (x - lastX < 26) continue;
    ctx.fillText(String(c.number), x, chart.y + chart.h + 12);
    lastX = x;
  }
  // High and low markers.
  for (const [p, color] of [
    [e.highest, '#f59e0b'],
    [e.lowest, '#0ea5e9'],
  ] as const) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(X(p.dist), Y(p.elev), 10, 0, Math.PI * 2);
    ctx.fill();
  }

  // Figures on the right.
  const figs: [string, string, string][] = [
    ['MÁS ALTO', `${Math.round(hi)} m`, '#f59e0b'],
    ['MÁS BAJO', `${Math.round(lo)} m`, '#0ea5e9'],
    ['DESNIVEL', `${Math.round(hi - lo)} m`, ACCENT],
    ['PENDIENTE MÁX.', `${(Math.max(e.maxUphill, e.maxDownhill) * 100).toLocaleString('es-ES', { maximumFractionDigits: 1 })} %`, t.muted],
  ];
  const fx = box.x + box.w - statsW;
  ctx.textAlign = 'left';
  figs.forEach(([label, value, color], i) => {
    const cx = fx + (i % 2) * 250;
    const cy = box.y + 30 + Math.floor(i / 2) * 104;
    ctx.fillStyle = color;
    ctx.fillRect(cx, cy + 4, 6, 26);
    ctx.fillStyle = t.muted;
    ctx.font = `700 22px ${FONT}`;
    ctx.textBaseline = 'top';
    ctx.fillText(label, cx + 18, cy + 6, 220);
    ctx.fillStyle = t.fg;
    ctx.font = `800 46px ${FONT}`;
    ctx.fillText(value, cx + 18, cy + 40, 220);
  });
}
