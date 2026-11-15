import { type LngLat, type Sample, limitCurvature, roundCorners, smoothTrack, lineLength } from './geometry';

/** Kerb width plus a little room: the inside edge of a bend keeps at least this clear of its centre. */
const EDGE_ROOM = 3;
import { type TrackElement, parseElements } from './elements';

export interface Circuit {
  version: 1;
  id: string;
  name: string;
  /** Control points the user placed, in driving order. */
  points: LngLat[];
  closed: boolean;
  /** Asphalt width in metres. */
  width: number;
  /** Follow real streets between control points instead of a smooth curve. */
  snapToRoads: boolean;
  /** Kerbs, walls, run-off, pits, grandstands… */
  elements: TrackElement[];
  updatedAt: string;
}

export function newCircuit(name = 'Nuevo circuito'): Circuit {
  return {
    version: 1,
    id: crypto.randomUUID(),
    name,
    points: [],
    closed: false,
    width: 12,
    snapToRoads: false,
    elements: [],
    updatedAt: new Date().toISOString(),
  };
}

/** Validate and normalise data loaded from storage or a file. */
export function parseCircuit(data: unknown): Circuit {
  if (!data || typeof data !== 'object') throw new Error('El archivo no contiene un circuito.');
  const d = data as Record<string, unknown>;
  if (!Array.isArray(d.points)) throw new Error('El circuito no tiene puntos.');
  const points = d.points.map((p) => {
    if (!Array.isArray(p) || p.length < 2) throw new Error('Punto no válido.');
    const lng = Number(p[0]);
    const lat = Number(p[1]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      throw new Error('Coordenadas no válidas.');
    }
    return [lng, lat] as LngLat;
  });
  const width = Number(d.width);
  return {
    version: 1,
    id: typeof d.id === 'string' && d.id ? d.id : crypto.randomUUID(),
    name: typeof d.name === 'string' && d.name.trim() ? d.name.trim().slice(0, 80) : 'Circuito',
    points,
    closed: Boolean(d.closed),
    width: Number.isFinite(width) ? Math.min(30, Math.max(3, width)) : 12,
    snapToRoads: Boolean(d.snapToRoads),
    elements: parseElements(d.elements),
    updatedAt: typeof d.updatedAt === 'string' ? d.updatedAt : new Date().toISOString(),
  };
}

/** Key for a routed segment between two control points. */
export function segmentKey(a: LngLat, b: LngLat): string {
  return `${a[0].toFixed(6)},${a[1].toFixed(6)};${b[0].toFixed(6)},${b[1].toFixed(6)}`;
}

/** Pairs of control points that make up the track, in order. */
export function segments(c: Circuit): [LngLat, LngLat][] {
  const n = c.points.length;
  const out: [LngLat, LngLat][] = [];
  for (let i = 0; i < n - 1; i++) out.push([c.points[i], c.points[i + 1]]);
  if (c.closed && n > 2) out.push([c.points[n - 1], c.points[0]]);
  return out;
}

/**
 * Centreline samples. With snapToRoads, uses routed geometry from `routes`
 * where available and a straight line where it isn't (yet).
 */
export function buildCentreline(c: Circuit, routes: Map<string, LngLat[]>): Sample[] {
  // Corners are rounded to a radius that depends on the track width, so the
  // asphalt never folds over itself on the inside of a bend.
  // Bends are then widened where needed so neither the asphalt edge nor the
  // kerbs on the inside fold over themselves.
  const minRadius = c.width / 2 + EDGE_ROOM;
  if (!c.snapToRoads) {
    const smooth = roundCorners(smoothTrack(c.points, c.closed), c.closed, c.width * 0.6);
    return limitCurvature(smooth, c.closed && c.points.length > 2, minRadius);
  }
  const segs = segments(c);
  if (segs.length === 0) return c.points.map((coord) => ({ coord, seg: 0 }));
  const out: Sample[] = [];
  segs.forEach(([a, b], s) => {
    const path = routes.get(segmentKey(a, b)) ?? [a, b];
    const start = s === 0 ? 0 : 1; // skip the shared junction point
    for (let i = start; i < path.length; i++) out.push({ coord: path[i], seg: s });
  });
  // Street routes turn at sharp intersection corners: round them off.
  const loop = c.closed && c.points.length > 2;
  return limitCurvature(roundCorners(out, loop, Math.max(12, c.width * 1.5)), loop, minRadius);
}

export function circuitLength(samples: Sample[]): number {
  return lineLength(samples.map((s) => s.coord));
}

/** Undo/redo history of circuit snapshots. */
export class History {
  private past: string[] = [];
  private future: string[] = [];
  constructor(private limit = 100) {}

  push(c: Circuit) {
    const snap = JSON.stringify(c);
    if (this.past[this.past.length - 1] === snap) return;
    this.past.push(snap);
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
  }
  undo(current: Circuit): Circuit | null {
    const prev = this.past.pop();
    if (!prev) return null;
    this.future.push(JSON.stringify(current));
    return JSON.parse(prev);
  }
  redo(current: Circuit): Circuit | null {
    const next = this.future.pop();
    if (!next) return null;
    this.past.push(JSON.stringify(current));
    return JSON.parse(next);
  }
  clear() {
    this.past = [];
    this.future = [];
  }
  get canUndo() {
    return this.past.length > 0;
  }
  get canRedo() {
    return this.future.length > 0;
  }
}
