import type { TrackAnalysis } from './analysis';

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
  const area = { x: M, y: y + 30, w: W - 2 * M, h: 1700 };
  if (a.xy.length >= 2) drawTrack(ctx, a, area, info.theme);
  else {
    ctx.fillStyle = t.muted;
    ctx.font = `600 48px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText('Dibuja un trazado para ver el póster', W / 2, area.y + area.h / 2);
    ctx.textAlign = 'left';
  }

  // ---- Stats ----
  const statsY = area.y + area.h + 60;
  const stats: [string, string, string][] = [
    ['LONGITUD', formatKm(a.length), 'km'],
    ['CURVAS', String(a.corners.length), a.corners.length === 1 ? 'curva' : 'curvas'],
    ['RECTA MÁS LARGA', Math.round(a.longestStraight).toLocaleString('es-ES'), 'm'],
    a.direction
      ? ['SENTIDO', a.direction === 'horario' ? 'Horario' : 'Antihorario', '']
      : ['ANCHO DE PISTA', info.width.toLocaleString('es-ES'), 'm'],
  ];
  const gap = 28;
  const boxW = (W - 2 * M - gap * 3) / 4;
  const boxH = 230;
  stats.forEach(([label, value, unit], i) => {
    const x = M + i * (boxW + gap);
    ctx.fillStyle = t.panel;
    roundRect(ctx, x, statsY, boxW, boxH, 22);
    ctx.fill();
    ctx.fillStyle = ACCENT;
    ctx.fillRect(x, statsY + 36, 8, 46);
    ctx.fillStyle = t.muted;
    ctx.font = `700 30px ${FONT}`;
    ctx.fillText(label, x + 36, statsY + 44, boxW - 60);
    ctx.fillStyle = t.fg;
    const vs = fitText(ctx, value, boxW - 72, 84);
    ctx.fillText(value, x + 36, statsY + 104 + (84 - vs));
    if (unit) {
      ctx.fillStyle = t.muted;
      ctx.font = `600 32px ${FONT}`;
      ctx.fillText(unit, x + 36, statsY + 186);
    }
  });

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
  ctx.fillText(`Ancho de pista ${info.width.toLocaleString('es-ES')} m  ·  ${date}  ·  Datos © OpenStreetMap`, W - M, fy);
  ctx.textAlign = 'left';
}

function drawTrack(
  ctx: CanvasRenderingContext2D,
  a: TrackAnalysis,
  area: { x: number; y: number; w: number; h: number },
  theme: PosterTheme,
) {
  const t = THEMES[theme];
  const pad = 130; // room for corner labels
  const xs = a.xy.map((p) => p[0]);
  const ys = a.xy.map((p) => p[1]);
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

  ctx.save();
  ctx.shadowColor = t.shadow;
  ctx.shadowBlur = 40;
  ctx.shadowOffsetY = 12;
  ctx.strokeStyle = t.trackEdge;
  ctx.lineWidth = 44;
  path();
  ctx.stroke();
  ctx.restore();
  ctx.strokeStyle = t.track;
  ctx.lineWidth = 28;
  path();
  ctx.stroke();

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
