// 3D furniture on the map: the Unity models drawn with three.js in a MapLibre
// custom layer. Repeated pieces (walls, barriers, tyres) use instancing.
import * as maplibregl from 'maplibre-gl';
import * as THREE from 'three';
import { type LngLat, LocalProjection } from './geometry';
import type { BlockElement, LineElement, TrackElement } from './elements';
import { loadModel } from './models3d';

/** How each kind of element is built from the models. */
interface Piece {
  model: string;
  /** Length of one module along its line, metres. */
  module: number;
}
const LINE_PIECES: Partial<Record<LineElement['type'], Piece>> = {
  wall: { model: 'wall_a', module: 4 },
  fence: { model: 'prop_barrier_1M', module: 1 },
  tyres: { model: 'prop_tyre_block_A', module: 3.5 },
};
/** Footprint of the block models at natural size (metres) and which local side faces the track. */
const BLOCK_PIECES: Record<BlockElement['type'], { model: string; length: number; depth: number; tile: boolean }> = {
  pits: { model: 'portimao_garages', length: 135, depth: 13.8, tile: false },
  grandstand: { model: 'seats_hillslope_A', length: 31.8, depth: 16.7, tile: true },
};
export const MODEL_TYPES = new Set(['pits', 'grandstand']);

interface Placement {
  /** Position in local metres (east, north). */
  x: number;
  y: number;
  /** Direction of the model's +X axis, radians from east, counter-clockwise. */
  angle: number;
  sx: number;
  sy: number;
  sz: number;
}

type XY = [number, number];

/** Nearest point of a polyline to p (planar). */
function nearest(line: XY[], p: XY): XY {
  let best = line[0];
  let bestD = Infinity;
  for (let i = 1; i < line.length; i++) {
    const [ax, ay] = line[i - 1];
    const [bx, by] = line[i];
    const dx = bx - ax;
    const dy = by - ay;
    const l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / l2)) : 0;
    const q: XY = [ax + dx * t, ay + dy * t];
    const d = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2;
    if (d < bestD) {
      bestD = d;
      best = q;
    }
  }
  return best;
}

/**
 * Model angle so its +X runs along `dir` and its +Z side (the right of +X)
 * faces `towards` — the track.
 */
function facing(at: XY, dir: XY, towards: XY | null): number {
  let [dx, dy] = dir;
  if (towards) {
    // Right-hand normal of dir is (dy, -dx).
    const side = (towards[0] - at[0]) * dy - (towards[1] - at[1]) * dx;
    if (side < 0) {
      dx = -dx;
      dy = -dy;
    }
  }
  return Math.atan2(dy, dx);
}

/** Modules evenly along a polyline. */
function alongLine(xy: XY[], module: number, track: XY[]): Placement[] {
  const cum = [0];
  for (let i = 1; i < xy.length; i++) cum.push(cum[i - 1] + Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]));
  const total = cum[cum.length - 1];
  if (total < module * 0.5) return [];
  const n = Math.max(1, Math.round(total / module));
  const step = total / n;
  const at = (d: number): XY => {
    let i = 1;
    while (i < cum.length - 1 && cum[i] < d) i++;
    const t = (d - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
    return [xy[i - 1][0] + (xy[i][0] - xy[i - 1][0]) * t, xy[i - 1][1] + (xy[i][1] - xy[i - 1][1]) * t];
  };
  const out: Placement[] = [];
  for (let k = 0; k < n; k++) {
    const a = at(k * step);
    const b = at((k + 1) * step);
    const mid: XY = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const angle = facing(mid, [b[0] - a[0], b[1] - a[1]], track.length > 1 ? nearest(track, mid) : null);
    out.push({ x: mid[0], y: mid[1], angle, sx: step / module, sy: 1, sz: 1 });
  }
  return out;
}

function blockPlacements(b: BlockElement, proj: LocalProjection, track: XY[]): Placement[] {
  const piece = BLOCK_PIECES[b.type];
  const c = proj.toXY(b.center);
  const a = (b.bearing * Math.PI) / 180;
  const dir: XY = [Math.sin(a), Math.cos(a)];
  const angle = facing(c, dir, track.length > 1 ? nearest(track, c) : null);
  const n = piece.tile ? Math.max(1, Math.round(b.length / piece.length)) : 1;
  const sx = b.length / (n * piece.length);
  const sz = b.depth / piece.depth;
  const sy = Math.min(1.3, Math.max(0.5, piece.tile ? sz : Math.min(sx, sz) ** 0.5));
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  const out: Placement[] = [];
  for (let k = 0; k < n; k++) {
    const off = (k - (n - 1) / 2) * piece.length * sx;
    out.push({ x: c[0] + ux * off, y: c[1] + uy * off, angle, sx, sy, sz });
  }
  return out;
}

/**
 * The hillside seating has no back: close it with a back wall and two side
 * wedges so a stand placed on flat ground looks solid from behind.
 */
let standShell: THREE.Object3D | null = null;
function grandstandShell(): THREE.Object3D {
  if (standShell) return standShell;
  const hx = 15.9;
  const hz = 8.34;
  const h = 8.2;
  // Low front at +z, high back at -z.
  const v = [
    // back wall
    -hx, 0, -hz, hx, 0, -hz, hx, h, -hz, -hx, 0, -hz, hx, h, -hz, -hx, h, -hz,
    // side wedges
    -hx, 0, hz, -hx, 0, -hz, -hx, h, -hz,
    hx, 0, hz, hx, h, -hz, hx, 0, -hz,
  ];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: '#b9bcc2', side: THREE.DoubleSide }));
  standShell = new THREE.Group().add(mesh);
  standShell.updateMatrixWorld(true);
  return standShell;
}

export class ModelLayer implements maplibregl.CustomLayerInterface {
  readonly id = 'tp-models';
  readonly type = 'custom' as const;
  readonly renderingMode = '3d' as const;
  private map?: maplibregl.Map;
  private renderer?: THREE.WebGLRenderer;
  private camera = new THREE.Camera();
  private scene = new THREE.Scene();
  private group = new THREE.Group();
  private origin: LngLat = [0, 0];
  private version = 0;
  private key = '';
  /** Whether any model is on the map, so the flat stand-ins can be hidden. */
  onModels?: (shown: boolean) => void;

  constructor() {
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f80, 2.1));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(-0.5, 1, 0.8);
    this.scene.add(sun);
    this.scene.add(this.group);
  }

  onAdd(map: maplibregl.Map, gl: WebGLRenderingContext | WebGL2RenderingContext) {
    this.map = map;
    this.renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl, antialias: true });
    this.renderer.autoClear = false;
  }

  onRemove() {
    this.renderer?.dispose();
    this.renderer = undefined;
  }

  /** Rebuild the models for the current elements. */
  async update(elements: TrackElement[], centre: LngLat[]) {
    const relevant = elements.filter((e) => e.type in LINE_PIECES || MODEL_TYPES.has(e.type));
    const key = JSON.stringify([relevant, centre.length, centre[0], centre[centre.length - 1]]);
    if (key === this.key) return;
    this.key = key;
    const version = ++this.version;
    const origin = centre[0] ?? (elements.find((e) => 'center' in e) as BlockElement | undefined)?.center;
    if (!origin) return this.replace(new THREE.Group(), version, false);
    const proj = new LocalProjection(origin);
    // Coarse copy of the centreline for the "which side is the track" checks.
    const track: XY[] = centre.filter((_, i) => i % 3 === 0 || i === centre.length - 1).map((p) => proj.toXY(p));

    const byModel = new Map<string, Placement[]>();
    const add = (model: string, ps: Placement[]) => byModel.set(model, [...(byModel.get(model) ?? []), ...ps]);
    for (const e of relevant) {
      if (e.type === 'wall' || e.type === 'fence' || e.type === 'tyres') {
        const piece = LINE_PIECES[e.type]!;
        add(piece.model, alongLine(e.coords.map((p) => proj.toXY(p)), piece.module, track));
      } else if (e.type === 'pits' || e.type === 'grandstand') {
        const ps = blockPlacements(e, proj, track);
        add(BLOCK_PIECES[e.type].model, ps);
        if (e.type === 'grandstand') add('stand-shell', ps);
      }
    }
    const group = new THREE.Group();
    try {
      const models = await Promise.all(
        [...byModel.keys()].map((m) => (m === 'stand-shell' ? grandstandShell() : loadModel(m))),
      );
      [...byModel.values()].forEach((ps, i) => group.add(instanced(models[i], ps)));
    } catch (err) {
      console.warn('No se pudieron cargar los modelos 3D', err);
    }
    this.origin = origin;
    this.replace(group, version, byModel.size > 0);
  }

  private replace(group: THREE.Group, version: number, shown: boolean) {
    if (version !== this.version) return; // a newer update is on its way
    this.scene.remove(this.group);
    this.group.traverse((o) => {
      if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose();
    });
    this.group = group;
    this.scene.add(group);
    this.onModels?.(shown);
    this.map?.triggerRepaint();
  }

  render(_gl: WebGLRenderingContext | WebGL2RenderingContext, args: maplibregl.CustomRenderMethodInput) {
    if (!this.renderer || !this.group.children.length) return;
    const merc = maplibregl.MercatorCoordinate.fromLngLat(this.origin, 0);
    const s = merc.meterInMercatorCoordinateUnits();
    // Local frame: x east, y up, z south, in metres around the origin.
    const local = new THREE.Matrix4()
      .makeTranslation(merc.x, merc.y, merc.z)
      .scale(new THREE.Vector3(s, -s, s))
      .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2));
    this.camera.projectionMatrix = new THREE.Matrix4().fromArray(args.defaultProjectionData.mainMatrix).multiply(local);
    this.renderer.resetState();
    this.renderer.render(this.scene, this.camera);
  }
}

/** One instanced mesh per part of the model, with a copy at every placement. */
function instanced(model: THREE.Object3D, ps: Placement[]): THREE.Group {
  const g = new THREE.Group();
  const base = new THREE.Box3().setFromObject(model).min.y; // stand the model on the ground
  const place = new THREE.Matrix4();
  const tmp = new THREE.Matrix4();
  model.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const im = new THREE.InstancedMesh(mesh.geometry, mesh.material, ps.length);
    ps.forEach((p, i) => {
      // Local three.js frame has z pointing south: north is -z.
      place
        .makeTranslation(p.x, -base * p.sy, -p.y)
        .multiply(tmp.makeRotationY(p.angle))
        .multiply(tmp.makeScale(p.sx, p.sy, p.sz))
        .multiply(mesh.matrixWorld);
      im.setMatrixAt(i, place);
    });
    im.instanceMatrix.needsUpdate = true;
    im.frustumCulled = false;
    g.add(im);
  });
  return g;
}
