import * as maplibregl from 'maplibre-gl';
import type { MapMouseEvent, MapTouchEvent } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import './style.css';

import {
  type Circuit,
  History,
  buildCentreline,
  circuitLength,
  newCircuit,
  segmentKey,
  segments,
} from './circuit';
import { type LngLat, type Sample, bearing, simplify } from './geometry';
import { STYLES, addTrackLayers, renderElements, renderStroke, renderTrack, usePattern } from './render';
import {
  ELEMENT_LABELS,
  type BlockElement,
  type ElementType,
  type KerbColor,
  type MarkerElement,
  type ZoneElement,
  type TrackElement,
  autoKerbs,
  autoRaceLayout,
  autoMarshals,
  autoWalls,
  cumulative,
  locateOnTrack,
  newId,
  placeBlock,
  sectorBounds,
} from './elements';
import { type Locality, flagUrl, reverseGeocode, routeSegment, searchPlaces } from './services';
import { analyzeTrack } from './analysis';
import { type LapProfile, carAt, formatLapTime, lapProfile } from './lap';
import { LapHud } from './hud';
import { type PosterTheme, drawPoster } from './poster';
import * as storage from './storage';

type Tool = 'paint' | 'draw' | 'edit' | 'pan' | 'element';
type StyleName = keyof typeof STYLES;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// ---------- State ----------

let circuit: Circuit = storage.loadDraft() ?? newCircuit();
let samples: Sample[] = [];
let tool: Tool = circuit.points.length ? 'edit' : 'paint';
let dragIndex: number | null = null;
/** Element placed by the 'element' tool. */
let elementType: ElementType = 'kerb';
let kerbColor: KerbColor = 'red';
let selectedId: string | null = null;
/** Block (pits/grandstand) being dragged, with the offset from its centre to the pointer. */
let blockDrag: { id: string; dx: number; dy: number } | null = null;
const history = new History();
const routes = new Map<string, LngLat[]>();
const pendingRoutes = new Set<string>();

// ---------- Map ----------

// MapLibre finds its worker relative to its own file, which bundling breaks.
maplibregl.setWorkerUrl(workerUrl);

const map = new maplibregl.Map({
  container: 'map',
  style: STYLES.mapa,
  center: circuit.points[0] ?? [-3.7038, 40.4168],
  zoom: circuit.points.length ? 15 : 12,
  maxPitch: 75,
  attributionControl: { compact: true },
  canvasContextAttributes: { preserveDrawingBuffer: true },
});
map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-right');

map.on('style.load', () => {
  addTrackLayers(map);
  // Textures from Circuit Tycoon, downscaled to small repeating tiles.
  const base = import.meta.env.BASE_URL;
  void usePattern(map, 'tp-gravel', 'tp-gravel', `${base}assets/patterns/gravel.png`);
  void usePattern(map, 'tp-runoff', 'tp-runoff', `${base}assets/patterns/runoff.png`);
  void usePattern(map, 'tp-grass', 'tp-grass', `${base}assets/patterns/grass.png`);
  redraw();
});

// ---------- Rendering ----------

function redraw() {
  samples = buildCentreline(circuit, routes);
  if (map.getSource('tp-points')) {
    renderTrack(map, circuit, samples, tool !== 'pan' && tool !== 'element');
    renderElements(map, circuit.elements, centre(), circuit.closed, circuit.width, selectedId);
  }
  updateStats();
}

const centre = () => samples.map((s) => s.coord);

/** Record an undo step, apply a change, then refresh everything. */
function commit(change: (c: Circuit) => void) {
  history.push(circuit);
  change(circuit);
  changed();
}

function changed() {
  circuit.updatedAt = new Date().toISOString();
  redraw();
  updateUi();
  storage.saveDraft(circuit);
  if (circuit.snapToRoads && dragIndex === null) void fetchMissingRoutes();
}

/** Route segments one at a time, so the free routing service isn't flooded. */
async function fetchMissingRoutes() {
  for (const [a, b] of segments(circuit)) {
    const key = segmentKey(a, b);
    if (routes.has(key) || pendingRoutes.has(key)) continue;
    pendingRoutes.add(key);
    setStatus('Buscando calles…');
    try {
      routes.set(key, (await routeSegment(a, b)) ?? [a, b]);
      setStatus('');
    } catch {
      routes.set(key, [a, b]); // don't retry in a loop; a straight line stands in
      setStatus('No se pudo seguir las calles en algún tramo; se usa una recta.');
    } finally {
      pendingRoutes.delete(key);
    }
    if (!circuit.snapToRoads) return;
    redraw();
  }
  if (pendingRoutes.size === 0 && $('status').textContent === 'Buscando calles…') setStatus('');
}

// ---------- Editing on the map ----------

function pointAt(e: MapMouseEvent | MapTouchEvent): number | null {
  const f = map.queryRenderedFeatures(e.point, { layers: ['tp-points'] })[0];
  return f ? Number(f.properties?.index) : null;
}

const ELEMENT_LAYERS = [
  'tp-blocks',
  'tp-kerbs',
  'tp-walls',
  'tp-fences',
  'tp-tyres',
  'tp-pitlane-surface',
  'tp-gravel',
  'tp-runoff',
  'tp-grass',
  'tp-markers',
  'tp-zones',
];
function elementAt(e: MapMouseEvent | MapTouchEvent): string | null {
  const layers = ELEMENT_LAYERS.filter((l) => map.getLayer(l));
  const box: [maplibregl.PointLike, maplibregl.PointLike] = [
    [e.point.x - 4, e.point.y - 4],
    [e.point.x + 4, e.point.y + 4],
  ];
  const f = map.queryRenderedFeatures(box, { layers })[0];
  return (f?.properties?.id as string | undefined) ?? null;
}

function select(id: string | null) {
  selectedId = id;
  redraw();
  updateSelectionUi();
}

map.on('click', (e) => {
  if (tool === 'pan' || tool === 'paint') return;
  if (tool === 'element') {
    if (elementType === 'sector' || elementType === 'speedtrap' || elementType === 'overtake') {
      placeMarker(elementType, [e.lngLat.lng, e.lngLat.lat]);
      return;
    }
    if (elementType === 'marshal' || elementType === 'crane') {
      const line = centre();
      if (line.length < 2) return setStatus('Dibuja primero la pista.');
      const loc = locateOnTrack(line, [e.lngLat.lng, e.lngLat.lat]);
      const post = { id: newId(), type: elementType, at: loc.dist, side: loc.side };
      commit((c) => c.elements.push(post));
      select(post.id);
      setStatus(`${ELEMENT_LABELS[post.type]} colocado.`);
      return;
    }
    if (elementType === 'pits' || elementType === 'grandstand') {
      const type = elementType;
      const block = placeBlock(type, centre(), circuit.width, [e.lngLat.lng, e.lngLat.lat]);
      commit((c) => c.elements.push(block));
      select(block.id);
      setStatus(`${ELEMENT_LABELS[type]} colocada. Arrástrala con Editar para moverla.`);
    }
    return;
  }
  const hit = pointAt(e);
  if (hit !== null) {
    if (tool === 'draw' && hit === 0 && circuit.points.length >= 3 && !circuit.closed) {
      commit((c) => (c.closed = true));
      setTool('edit');
      setStatus('Circuito cerrado.');
    }
    return;
  }
  const p: LngLat = [e.lngLat.lng, e.lngLat.lat];
  if (tool === 'draw') {
    commit((c) => c.points.push(p));
    return;
  }
  const el = elementAt(e);
  if (el) {
    select(el);
    return;
  }
  if (selectedId) {
    select(null);
    return;
  }
  const onTrack = map.queryRenderedFeatures(e.point, { layers: ['tp-hit'] }).length > 0;
  if (onTrack && samples.length > 1) {
    const seg = nearestSegment(p);
    commit((c) => c.points.splice(seg + 1, 0, p));
  }
});

/** Put a sector boundary, the speed trap or the Overtake Mode detection point on the track. */
function placeMarker(type: 'sector' | 'speedtrap' | 'overtake', p: LngLat) {
  const line = centre();
  if (line.length < 2) return setStatus('Dibuja primero la pista.');
  const at = locateOnTrack(line, p).dist;
  const id = newId();
  commit((c) => {
    if (type === 'sector') {
      const sectors = c.elements.filter((e) => e.type === 'sector') as { id: string; at: number }[];
      if (sectors.length >= 2) {
        // Move the nearer of the two existing boundaries.
        const nearer = sectors.reduce((a, b) => (Math.abs(b.at - at) < Math.abs(a.at - at) ? b : a));
        c.elements = c.elements.filter((e) => e.id !== nearer.id);
      }
    } else {
      c.elements = c.elements.filter((e) => e.type !== type); // only one of each
    }
    c.elements.push({ id, type, at });
  });
  select(id);
  const n = circuit.elements.filter((e) => e.type === 'sector').length;
  setStatus(
    type === 'sector'
      ? n < 2
        ? 'Límite de sector puesto. Pon otro para tener los 3 sectores.'
        : 'Sectores listos.'
      : `${ELEMENT_LABELS[type]} colocado.`,
  );
}

// Drag pits and grandstands in Edit mode.
function startBlockDrag(e: MapMouseEvent | MapTouchEvent) {
  if (tool !== 'edit' || dragIndex !== null) return;
  if ('points' in e && e.points.length > 1) return;
  const f = map.queryRenderedFeatures(e.point, { layers: ['tp-blocks'] })[0];
  const block = circuit.elements.find((x) => x.id === f?.properties?.id) as BlockElement | undefined;
  if (!block) return;
  e.preventDefault();
  history.push(circuit);
  blockDrag = { id: block.id, dx: block.center[0] - e.lngLat.lng, dy: block.center[1] - e.lngLat.lat };
  selectedId = block.id;
  updateSelectionUi();
}
function moveBlockDrag(e: MapMouseEvent | MapTouchEvent) {
  if (!blockDrag) return;
  const b = circuit.elements.find((x) => x.id === blockDrag!.id) as BlockElement | undefined;
  if (!b) return;
  b.center = [e.lngLat.lng + blockDrag.dx, e.lngLat.lat + blockDrag.dy];
  redraw();
}
function endBlockDrag() {
  if (!blockDrag) return;
  blockDrag = null;
  changed();
}
map.on('mousedown', 'tp-blocks', startBlockDrag);
map.on('touchstart', 'tp-blocks', startBlockDrag);
map.on('mousemove', moveBlockDrag);
map.on('touchmove', moveBlockDrag);
map.on('mouseup', endBlockDrag);
map.on('touchend', endBlockDrag);

function nearestSegment(p: LngLat): number {
  let best = 0;
  let bestD = Infinity;
  for (const s of samples) {
    const dx = s.coord[0] - p[0];
    const dy = s.coord[1] - p[1];
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = s.seg;
    }
  }
  return best;
}

function removePoint(i: number) {
  commit((c) => {
    c.points.splice(i, 1);
    if (c.points.length < 3) c.closed = false;
  });
}

map.on('contextmenu', 'tp-points', (e) => {
  e.preventDefault();
  if (tool === 'pan') return;
  const i = pointAt(e);
  if (i !== null) removePoint(i);
});
map.on('dblclick', 'tp-points', (e) => {
  if (tool === 'pan') return;
  e.preventDefault();
  const i = pointAt(e);
  if (i !== null) removePoint(i);
});

function startDrag(e: MapMouseEvent | MapTouchEvent) {
  if (tool === 'pan') return;
  if ('points' in e && e.points.length > 1) return;
  const i = pointAt(e);
  if (i === null) return;
  e.preventDefault();
  dragIndex = i;
  history.push(circuit);
  map.getCanvas().style.cursor = 'grabbing';
}
function moveDrag(e: MapMouseEvent | MapTouchEvent) {
  if (dragIndex === null) return;
  circuit.points[dragIndex] = [e.lngLat.lng, e.lngLat.lat];
  redraw();
}
function endDrag() {
  if (dragIndex === null) return;
  dragIndex = null;
  map.getCanvas().style.cursor = '';
  changed();
}
map.on('mousedown', 'tp-points', startDrag);
map.on('touchstart', 'tp-points', startDrag);
map.on('mousemove', moveDrag);
map.on('touchmove', moveDrag);
map.on('mouseup', endDrag);
map.on('touchend', endDrag);
map.on('mouseenter', 'tp-points', () => {
  if (tool !== 'pan' && dragIndex === null) map.getCanvas().style.cursor = 'grab';
});
map.on('mouseleave', 'tp-points', () => {
  if (dragIndex === null) map.getCanvas().style.cursor = '';
});
map.on('mouseenter', 'tp-hit', () => {
  if (tool === 'edit' && dragIndex === null) map.getCanvas().style.cursor = 'copy';
});
map.on('mouseleave', 'tp-hit', () => {
  if (dragIndex === null) map.getCanvas().style.cursor = '';
});

// ---------- Painting ----------

/** Screen-space points of the stroke being painted, or null when not painting. */
let stroke: { x: number; y: number }[] | null = null;
const SNAP_PX = 30;

function eventXY(e: MapMouseEvent | MapTouchEvent) {
  return { x: e.point.x, y: e.point.y };
}

function startPaint(e: MapMouseEvent | MapTouchEvent) {
  const strokeElement =
    tool === 'element' &&
    !['pits', 'grandstand', 'sector', 'speedtrap', 'overtake', 'marshal', 'crane'].includes(elementType);
  if ((tool !== 'paint' && !strokeElement) || dragIndex !== null) return;
  if ('points' in e && e.points.length > 1) return; // let two-finger gestures zoom/rotate
  if ('originalEvent' in e && e.originalEvent instanceof MouseEvent && e.originalEvent.button !== 0) return;
  e.preventDefault(); // stops the map from panning while the brush is down
  stroke = [eventXY(e)];
}
function movePaint(e: MapMouseEvent | MapTouchEvent) {
  if (!stroke) return;
  const p = eventXY(e);
  const last = stroke[stroke.length - 1];
  if (Math.hypot(p.x - last.x, p.y - last.y) < 3) return;
  stroke.push(p);
  renderStroke(map, stroke.map((q) => toLngLat(q)));
}
function endPaint() {
  if (!stroke) return;
  const pts = stroke;
  stroke = null;
  renderStroke(map, []);
  if (pts.length < 4) return;
  if (tool === 'element') applyElementStroke(pts);
  else applyStroke(pts);
}

/** Turn a stroke into the selected kind of element. */
function applyElementStroke(pts: { x: number; y: number }[]) {
  const a = map.unproject([pts[0].x, pts[0].y]);
  const b = map.unproject([pts[0].x + 4, pts[0].y]);
  const coords = simplify(pts.map(toLngLat), Math.max(0.3, a.distanceTo(b)));
  const type = elementType;
  let el: TrackElement | null = null;
  if (type === 'kerb' || type === 'straightmode') {
    const line = centre();
    if (line.length < 2) {
      setStatus('Dibuja primero la pista.');
      return;
    }
    const total = cumulative(line).at(-1)!;
    const start = locateOnTrack(line, coords[0]);
    const end = locateOnTrack(line, coords[coords.length - 1]);
    let from = start.dist;
    let to = end.dist;
    if (circuit.closed) {
      // Take the shorter way round between the two ends of the stroke.
      if ((((to - from) % total) + total) % total > total / 2) [from, to] = [to, from];
    } else if (from > to) [from, to] = [to, from];
    el =
      type === 'kerb'
        ? { id: newId(), type: 'kerb', from, to, side: start.side, color: kerbColor }
        : { id: newId(), type: 'straightmode', from, to };
  } else if (type === 'gravel' || type === 'runoff' || type === 'grass') {
    if (coords.length < 3) return;
    el = { id: newId(), type, ring: coords };
  } else if (type === 'wall' || type === 'fence' || type === 'tyres' || type === 'pitlane') {
    el = { id: newId(), type, coords };
  }
  if (!el) return;
  const added = el;
  commit((c) => c.elements.push(added));
  select(added.id);
  setStatus(`${ELEMENT_LABELS[type]} añadido.`);
}

function toLngLat(p: { x: number; y: number }): LngLat {
  const ll = map.unproject([p.x, p.y]);
  return [ll.lng, ll.lat];
}

/**
 * Turn a painted stroke into control points. A stroke that starts at the end
 * of an open track continues it; one that ends back at its start closes the
 * loop. Anything else replaces the track (undo brings it back).
 */
function applyStroke(pts: { x: number; y: number }[]) {
  const first = pts[0];
  const last = pts[pts.length - 1];
  const near = (a: { x: number; y: number }, b: LngLat) => {
    const q = map.project(b);
    return Math.hypot(a.x - q.x, a.y - q.y) < SNAP_PX;
  };
  const n = circuit.points.length;
  const extend = n > 0 && !circuit.closed && near(first, circuit.points[n - 1]);

  // Tolerance of ~6 screen pixels, in metres at the current zoom.
  const a = map.unproject([first.x, first.y]);
  const b = map.unproject([first.x + 6, first.y]);
  const tolerance = Math.max(0.5, a.distanceTo(b));
  let coords = simplify(pts.map(toLngLat), tolerance);

  const loopStart = extend ? circuit.points[0] : coords[0];
  const closes = near(last, loopStart) && (extend ? n + coords.length : coords.length) >= 4;
  if (closes) coords = coords.slice(0, -1); // the loop joins back to the start point

  commit((c) => {
    if (extend) c.points.push(...coords.slice(1));
    else c.points = coords;
    c.closed = closes && c.points.length >= 3;
  });
  setStatus(
    closes ? 'Circuito cerrado. Usa Editar para afinar los puntos.' : extend ? 'Trazado ampliado.' : 'Trazado pintado.',
  );
}

map.on('mousedown', startPaint);
map.on('touchstart', startPaint);
map.on('mousemove', movePaint);
map.on('touchmove', movePaint);
map.on('mouseup', endPaint);
map.on('touchend', endPaint);
map.on('touchcancel', endPaint);

// ---------- Panel ----------

const HINTS: Record<Tool, string> = {
  paint:
    'Mantén pulsado y arrastra para pintar la pista. Termina en el inicio para cerrarla, o empieza en el final para continuarla. Usa dos dedos o la rueda para moverte.',
  draw: 'Haz clic en el mapa para añadir puntos. Clic en el punto verde para cerrar el circuito.',
  edit: 'Arrastra los puntos para moverlos. Clic sobre la pista para añadir uno. Doble clic o clic derecho en un punto para borrarlo.',
  pan: 'Mueve, gira e inclina el mapa sin tocar el trazado. También puedes moverte con W A S D (Mayús para ir más rápido).',
  element: '',
};

const ELEMENT_HINTS: Record<ElementType, string> = {
  kerb: 'Arrastra a lo largo del borde de la pista. El piano va en el lado donde empiezas.',
  wall: 'Arrastra para dibujar el muro.',
  fence: 'Arrastra para dibujar la valla.',
  tyres: 'Arrastra para dibujar la barrera de neumáticos.',
  pitlane: 'Arrastra para dibujar el carril de boxes.',
  gravel: 'Rodea la zona arrastrando; se cierra sola al soltar.',
  runoff: 'Rodea la zona de escapatoria de asfalto; se cierra sola al soltar.',
  grass: 'Rodea la zona de césped; se cierra sola al soltar.',
  pits: 'Haz clic junto a la pista: los boxes se colocan en paralelo, en ese lado.',
  grandstand: 'Haz clic junto a la pista: la grada se coloca en paralelo, mirando a la pista.',
  sector: 'Haz clic en la pista donde termina un sector. Con dos límites tienes los 3 sectores.',
  speedtrap: 'Haz clic en la pista donde quieres medir la velocidad punta.',
  overtake: 'Haz clic en la pista en el punto de detección del Overtake Mode (a menos de 1 s del rival se activa la energía extra).',
  marshal: 'Haz clic junto a la pista, en el lado donde va el puesto de comisarios. Se numeran solos en el sentido de la carrera.',
  crane: 'Haz clic junto a la pista, en el lado donde va la grúa de recuperación.',
  straightmode: 'Arrastra a lo largo de la recta donde los coches pueden abrir los alerones (Straight Mode).',
};

function setTool(t: Tool) {
  tool = t;
  document.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((b) => {
    b.setAttribute('aria-checked', String(b.dataset.tool === t));
  });
  document.querySelectorAll<HTMLButtonElement>('[data-el]').forEach((b) => {
    b.setAttribute('aria-checked', String(t === 'element' && b.dataset.el === elementType));
  });
  $('kerb-colors').hidden = !(t === 'element' && elementType === 'kerb');
  $('hint').textContent = t === 'element' ? ELEMENT_HINTS[elementType] : HINTS[t];
  $('map').classList.toggle('drawing', t === 'draw' || t === 'paint' || t === 'element');
  if (t === 'pan') map.doubleClickZoom.enable();
  else map.doubleClickZoom.disable();
  redraw();
}

function formatLength(m: number) {
  if (m < 1000) return `${Math.round(m).toLocaleString('es-ES')} m`;
  return `${(m / 1000).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} km`;
}

function updateStats() {
  $('stat-length').textContent = formatLength(circuitLength(samples));
  $('stat-points').textContent = String(circuit.points.length);
}

function updateUi() {
  $<HTMLInputElement>('name').value = circuit.name;
  $<HTMLInputElement>('closed').checked = circuit.closed;
  $<HTMLInputElement>('closed').disabled = circuit.points.length < 3;
  $<HTMLInputElement>('snap').checked = circuit.snapToRoads;
  $<HTMLInputElement>('width').value = String(circuit.width);
  $('width-out').textContent = `${circuit.width.toLocaleString('es-ES')} m`;
  $<HTMLButtonElement>('undo').disabled = !history.canUndo;
  $<HTMLButtonElement>('redo').disabled = !history.canRedo;
  $<HTMLButtonElement>('fit').disabled = circuit.points.length === 0;
  $<HTMLButtonElement>('clear').disabled = circuit.points.length === 0;
  renderSavedList();
  updateSelectionUi();
}

function selectedElement(): TrackElement | undefined {
  return selectedId ? circuit.elements.find((e) => e.id === selectedId) : undefined;
}

function updateSelectionUi() {
  const el = selectedElement();
  if (selectedId && !el) selectedId = null;
  $('selection').hidden = !el;
  if (!el) return;
  $('sel-name').textContent = ELEMENT_LABELS[el.type];
  const isBlock = el.type === 'pits' || el.type === 'grandstand';
  $('sel-rotate-left').hidden = $('sel-rotate-right').hidden = !isBlock;
  $('sel-length-wrap').hidden = !isBlock;
  if (isBlock) $<HTMLInputElement>('sel-length').value = String(Math.round(el.length));
  $('sel-flip').hidden = !['kerb', 'marshal', 'crane'].includes(el.type);
}

function updateSelected(change: (e: TrackElement) => void) {
  const id = selectedId;
  if (!id) return;
  commit((c) => {
    const e = c.elements.find((x) => x.id === id);
    if (e) change(e);
  });
}

function deleteSelected() {
  const id = selectedId;
  if (!id) return;
  selectedId = null;
  commit((c) => (c.elements = c.elements.filter((x) => x.id !== id)));
}

let statusTimer: number | undefined;
function setStatus(msg: string) {
  $('status').textContent = msg;
  clearTimeout(statusTimer);
  if (msg) statusTimer = window.setTimeout(() => ($('status').textContent = ''), 5000);
}

function hasUnsavedChanges(): boolean {
  if (circuit.points.length === 0) return false;
  const saved = storage.listSaved().find((s) => s.id === circuit.id);
  if (!saved) return true;
  const key = (c: Circuit) => JSON.stringify([c.name, c.points, c.closed, c.width, c.snapToRoads, c.elements]);
  return key(saved) !== key(circuit);
}

function loadCircuit(c: Circuit) {
  circuit = c;
  history.clear();
  changed();
  setTool(c.points.length ? 'edit' : 'paint');
  fitToCircuit();
}

function fitToCircuit() {
  if (circuit.points.length === 0) return;
  const b = new maplibregl.LngLatBounds();
  circuit.points.forEach((p) => b.extend(p));
  map.fitBounds(b, { padding: { top: 60, bottom: 60, left: innerWidth > 640 ? 360 : 40, right: 60 }, maxZoom: 17 });
}

function renderSavedList() {
  const list = $('saved-list');
  list.replaceChildren();
  const saved = storage.listSaved();
  if (saved.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'Aún no has guardado ninguno.';
    list.append(li);
    return;
  }
  for (const s of saved) {
    const li = document.createElement('li');
    if (s.id === circuit.id) li.classList.add('current');
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = s.name;
    name.title = s.name;
    const open = document.createElement('button');
    open.textContent = 'Abrir';
    open.onclick = () => {
      if (s.id !== circuit.id && hasUnsavedChanges() && !confirm('Hay cambios sin guardar. ¿Abrir otro circuito igualmente?')) return;
      loadCircuit(structuredClone(s));
    };
    const del = document.createElement('button');
    del.textContent = '✕';
    del.title = 'Eliminar';
    del.onclick = () => {
      if (!confirm(`¿Eliminar "${s.name}"?`)) return;
      storage.deleteCircuit(s.id);
      renderSavedList();
    };
    li.append(name, open, del);
    list.append(li);
  }
}

document.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((b) => {
  b.onclick = () => setTool(b.dataset.tool as Tool);
});
document.querySelectorAll<HTMLButtonElement>('[data-el]').forEach((b) => {
  b.onclick = () => {
    elementType = b.dataset.el as ElementType;
    setTool('element');
  };
});
document.querySelectorAll<HTMLButtonElement>('[data-kerb]').forEach((b) => {
  b.onclick = () => {
    kerbColor = b.dataset.kerb as KerbColor;
    document.querySelectorAll('[data-kerb]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    const el = selectedElement();
    if (el?.type === 'kerb') updateSelected((e) => e.type === 'kerb' && (e.color = kerbColor));
  };
});
$('auto-kerbs').onclick = () => {
  const line = centre();
  if (line.length < 2) return setStatus('Dibuja primero la pista.');
  const analysis = analyzeTrack(line, circuit.closed);
  const lap = cumulative(line).at(-1)!;
  const kerbs = autoKerbs(analysis.corners, lap, circuit.closed).map((k) => ({ ...k, color: kerbColor }));
  commit((c) => (c.elements = [...c.elements.filter((e) => e.type !== 'kerb'), ...kerbs]));
  setStatus(`${analysis.corners.length} curvas con pianos. Puedes borrar o añadir los que quieras.`);
};
$('auto-race').onclick = () => {
  const line = centre();
  if (line.length < 2) return setStatus('Dibuja primero la pista.');
  const analysis = analyzeTrack(line, circuit.closed);
  const lap = cumulative(line).at(-1)!;
  const race = autoRaceLayout(analysis.corners, lap, circuit.closed);
  const RACE = ['sector', 'speedtrap', 'overtake', 'straightmode'];
  commit((c) => (c.elements = [...c.elements.filter((e) => !RACE.includes(e.type)), ...race]));
  const zones = race.filter((e) => e.type === 'straightmode').length;
  setStatus(`3 sectores, speed trap y ${zones} ${zones === 1 ? 'zona' : 'zonas'} de Straight Mode.`);
};
$('auto-marshals').onclick = () => {
  const line = centre();
  if (line.length < 2) return setStatus('Dibuja primero la pista.');
  const analysis = analyzeTrack(line, circuit.closed);
  const lap = cumulative(line).at(-1)!;
  const posts = autoMarshals(analysis.corners, lap, circuit.closed);
  commit((c) => (c.elements = [...c.elements.filter((e) => e.type !== 'marshal' && e.type !== 'crane'), ...posts]));
  const m = posts.filter((p) => p.type === 'marshal').length;
  setStatus(`${m} puestos de comisarios y ${posts.length - m} grúas.`);
};
$('auto-walls').onclick = () => {
  const walls = autoWalls(centre(), circuit.width, circuit.closed);
  if (!walls.length) return setStatus('Dibuja primero la pista.');
  commit((c) => c.elements.push(...walls));
  setStatus('Muros añadidos a ambos lados. Selecciónalos para borrarlos si no los quieres.');
};
$('sel-delete').onclick = deleteSelected;
$('sel-flip').onclick = () =>
  updateSelected(
    (e) =>
      (e.type === 'kerb' || e.type === 'marshal' || e.type === 'crane') &&
      (e.side = e.side === 'left' ? 'right' : 'left'),
  );
$('sel-rotate-left').onclick = () =>
  updateSelected((e) => (e.type === 'pits' || e.type === 'grandstand') && (e.bearing = (e.bearing + 345) % 360));
$('sel-rotate-right').onclick = () =>
  updateSelected((e) => (e.type === 'pits' || e.type === 'grandstand') && (e.bearing = (e.bearing + 15) % 360));
$<HTMLInputElement>('sel-length').onchange = (ev) => {
  const v = Math.min(500, Math.max(5, Number((ev.target as HTMLInputElement).value) || 0));
  updateSelected((e) => (e.type === 'pits' || e.type === 'grandstand') && (e.length = v));
};
$('sel-close').onclick = () => select(null);

$<HTMLInputElement>('name').addEventListener('change', (e) => {
  const v = (e.target as HTMLInputElement).value.trim() || 'Circuito';
  commit((c) => (c.name = v));
});
$<HTMLInputElement>('closed').onchange = (e) => {
  const v = (e.target as HTMLInputElement).checked;
  commit((c) => (c.closed = v));
};
$<HTMLInputElement>('snap').onchange = (e) => {
  const v = (e.target as HTMLInputElement).checked;
  commit((c) => (c.snapToRoads = v));
};
const width = $<HTMLInputElement>('width');
width.addEventListener('pointerdown', () => history.push(circuit));
width.addEventListener('keydown', () => history.push(circuit));
width.oninput = () => {
  circuit.width = Number(width.value);
  $('width-out').textContent = `${circuit.width.toLocaleString('es-ES')} m`;
  redraw();
};
width.onchange = () => changed();

function undo() {
  const prev = history.undo(circuit);
  if (prev) {
    circuit = prev;
    changed();
  }
}
function redo() {
  const next = history.redo(circuit);
  if (next) {
    circuit = next;
    changed();
  }
}
$('undo').onclick = undo;
$('redo').onclick = redo;
$('fit').onclick = fitToCircuit;
$('clear').onclick = () => {
  commit((c) => {
    c.points = [];
    c.closed = false;
  });
  setTool('paint');
  setStatus('Trazado borrado. Puedes deshacerlo.');
};
$('save').onclick = () => {
  storage.saveCircuit(circuit);
  renderSavedList();
  setStatus(`"${circuit.name}" guardado en este navegador.`);
};
$('new').onclick = () => {
  if (hasUnsavedChanges() && !confirm('Hay cambios sin guardar. ¿Empezar un circuito nuevo?')) return;
  loadCircuit(newCircuit());
};
$('export-json').onclick = () => storage.downloadJson(circuit);
$<HTMLInputElement>('import-json').onchange = async (e) => {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  try {
    const c = await storage.readJsonFile(file);
    loadCircuit(c);
    setStatus(`"${c.name}" importado.`);
  } catch (err) {
    setStatus((err as Error).message);
  }
};
$('panel-toggle').onclick = () => $('panel').classList.toggle('collapsed');

window.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).closest('input')) return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) {
    e.preventDefault();
    undo();
  } else if (mod && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) {
    e.preventDefault();
    redo();
  } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
    e.preventDefault();
    deleteSelected();
  } else if (e.key === 'Escape' && lap) {
    stopLap();
  } else if (e.key === 'Escape' && selectedId) {
    select(null);
  } else if (e.key === 'Escape') {
    setTool('edit');
  }
});

// ---------- Poster ----------

const posterDialog = $<HTMLDialogElement>('poster-dialog');
const posterCanvas = $<HTMLCanvasElement>('poster-canvas');
let posterTheme: PosterTheme = 'oscuro';
let posterFlag: HTMLImageElement | null = null;
let posterFlagCode = '';
/** Last reverse-geocoded place, keyed by the rounded start point. */
let locality: { key: string; value: Locality | null } | null = null;

function drawCurrentPoster() {
  const analysis = analyzeTrack(
    samples.map((s) => s.coord),
    circuit.closed,
  );
  drawPoster(posterCanvas, analysis, {
    name: $<HTMLInputElement>('poster-name').value.trim() || circuit.name,
    city: $<HTMLInputElement>('poster-city').value.trim(),
    country: $<HTMLInputElement>('poster-country').value.trim(),
    flag: posterFlag,
    width: circuit.width,
    theme: posterTheme,
    elements: circuit.elements,
    centre: centre(),
  });
}

async function loadFlag(code: string) {
  if (code === posterFlagCode) return;
  posterFlagCode = code;
  posterFlag = null;
  const url = code ? await flagUrl(code) : null;
  if (!url) return;
  const img = new Image();
  img.src = url;
  try {
    await img.decode();
    if (posterFlagCode === code) posterFlag = img;
  } catch {
    /* draw without a flag */
  }
}

async function openPoster() {
  if (samples.length < 2) {
    setStatus('Dibuja primero un trazado.');
    return;
  }
  $<HTMLInputElement>('poster-name').value = circuit.name;
  setPosterTheme(posterTheme);
  posterDialog.showModal();
  drawCurrentPoster();

  const start = circuit.points[0];
  const key = `${start[0].toFixed(3)},${start[1].toFixed(3)}`;
  if (locality?.key !== key) {
    $('poster-status').textContent = 'Buscando ciudad y país…';
    let value: Locality | null = null;
    try {
      value = await reverseGeocode(start);
    } catch {
      value = null;
    }
    locality = { key, value };
    $<HTMLInputElement>('poster-city').value = value?.city ?? '';
    $<HTMLInputElement>('poster-country').value = value?.country ?? '';
    $('poster-status').textContent = value ? '' : 'No se pudo detectar el lugar. Puedes escribirlo a mano.';
  }
  await loadFlag(locality.value?.countryCode ?? '');
  drawCurrentPoster();
}

function setPosterTheme(theme: PosterTheme) {
  posterTheme = theme;
  document.querySelectorAll<HTMLButtonElement>('[data-theme]').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.theme === theme));
  });
}

$('poster').onclick = () => void openPoster();
$('poster-close').onclick = () => posterDialog.close();
posterDialog.addEventListener('click', (e) => {
  if (e.target === posterDialog) posterDialog.close(); // click on the backdrop
});
document.querySelectorAll<HTMLButtonElement>('[data-theme]').forEach((b) => {
  b.onclick = () => {
    setPosterTheme(b.dataset.theme as PosterTheme);
    drawCurrentPoster();
  };
});
for (const id of ['poster-name', 'poster-city', 'poster-country']) {
  $<HTMLInputElement>(id).addEventListener('input', drawCurrentPoster);
}
$('poster-download').onclick = () => {
  posterCanvas.toBlob((blob) => {
    if (!blob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const name = $<HTMLInputElement>('poster-name').value.trim() || circuit.name;
    a.download = `${storage.slug(name) || 'circuito'}-poster.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }, 'image/png');
};

// ---------- Search ----------

const results = $<HTMLUListElement>('search-results');
$<HTMLFormElement>('search').onsubmit = async (e) => {
  e.preventDefault();
  const q = $<HTMLInputElement>('search-input').value.trim();
  if (!q) return;
  results.hidden = false;
  results.innerHTML = '<li>Buscando…</li>';
  try {
    const places = await searchPlaces(q);
    results.replaceChildren();
    if (places.length === 0) results.innerHTML = '<li>Sin resultados.</li>';
    for (const p of places) {
      const li = document.createElement('li');
      li.tabIndex = 0;
      li.textContent = p.name;
      const go = () => {
        results.hidden = true;
        if (p.bbox) map.fitBounds(p.bbox, { maxZoom: 17, padding: 40 });
        else map.flyTo({ center: p.center, zoom: 16 });
      };
      li.onclick = go;
      li.onkeydown = (ev) => ev.key === 'Enter' && go();
      results.append(li);
    }
  } catch {
    results.innerHTML = '<li>No se pudo buscar. Inténtalo de nuevo.</li>';
  }
};
document.addEventListener('click', (e) => {
  if (!(e.target as HTMLElement).closest('.search')) results.hidden = true;
});

// ---------- Background and 2D/3D ----------

function setStyleName(name: StyleName) {
  document.querySelectorAll<HTMLButtonElement>('[data-style]').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.style === name));
  });
  map.setStyle(STYLES[name], { diff: false });
}
function setView(view: '2d' | '3d', animate = true) {
  document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.view === view));
  });
  const opts = view === '3d' ? { pitch: 60 } : { pitch: 0, bearing: 0 };
  if (animate) map.easeTo({ ...opts, duration: 800 });
  else map.jumpTo(opts);
}
document.querySelectorAll<HTMLButtonElement>('[data-style]').forEach((b) => {
  b.onclick = () => setStyleName(b.dataset.style as StyleName);
});
document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((b) => {
  b.onclick = () => setView(b.dataset.view as '2d' | '3d');
});
map.on('pitchend', () => {
  const view = map.getPitch() > 5 ? '3d' : '2d';
  document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.view === view));
  });
});

// ---------- Lap flyover ----------

interface LapRun {
  profile: LapProfile;
  start: number;
  frame: number;
  bearing: number;
  marker: maplibregl.Marker;
  restore: { center: maplibregl.LngLat; zoom: number; pitch: number; bearing: number };
  panelWasCollapsed: boolean;
  hud: LapHud;
}
let lap: LapRun | null = null;
/** Playback speed: the lap runs this many times faster than real time. */
const LAP_RATE = 2;

function angleLerp(from: number, to: number, f: number): number {
  const diff = ((to - from + 540) % 360) - 180;
  return (from + diff * f + 360) % 360;
}

function startLap() {
  const profile = lapProfile(centre(), circuit.closed && circuit.points.length > 2);
  if (!profile || profile.length < 50) {
    setStatus('Dibuja un trazado más largo para dar una vuelta.');
    return;
  }
  select(null);
  setTool('pan');
  const closed = circuit.closed && circuit.points.length > 2;
  const line = centre();
  const { corners } = analyzeTrack(line, closed);
  const bounds = sectorBounds(circuit.elements);
  const L = profile.length;
  const zones = circuit.elements.filter((e): e is ZoneElement => e.type === 'straightmode');
  const trap = circuit.elements.find((e): e is MarkerElement => e.type === 'speedtrap');
  const hud = new LapHud($('lap-hud'), {
    profile,
    name: circuit.name,
    sectors: bounds.length === 2 ? [bounds[0], bounds[1]] : [L / 3, (2 * L) / 3],
    corners,
    straightMode: zones.map((z) => ({ from: z.from, to: z.to })),
    speedTrap: trap ? trap.at : null,
    closed,
  });
  const el = document.createElement('div');
  el.className = 'car-marker';
  const marker = new maplibregl.Marker({ element: el }).setLngLat(profile.coords[0]).addTo(map);
  lap = {
    profile,
    start: performance.now(),
    frame: 0,
    bearing: bearing(profile.coords[0], profile.coords[Math.min(8, profile.coords.length - 1)]),
    marker,
    restore: { center: map.getCenter(), zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() },
    panelWasCollapsed: $('panel').classList.contains('collapsed'),
    hud,
  };
  // Hide the panel for a clear view of the lap.
  $('panel').classList.add('collapsed');
  $('play').setAttribute('aria-pressed', 'true');
  $('play').textContent = '■ Parar';
  lap.frame = requestAnimationFrame(lapFrame);
}

function lapFrame(now: number) {
  if (!lap) return;
  const { profile } = lap;
  const t = ((now - lap.start) / 1000) * LAP_RATE;
  const car = carAt(profile, t);
  // Look 40 m ahead (wrapping on a loop) so the camera turns into corners smoothly.
  const n = profile.coords.length;
  const ahead = profile.coords[circuit.closed ? (car.index + 8) % n : Math.min(n - 1, car.index + 8)];
  const target = bearing(car.coord, ahead);
  lap.bearing = angleLerp(lap.bearing, target, 0.08);
  lap.marker.setLngLat(car.coord);
  // Top padding puts the car in the lower part of the screen, like a chase camera.
  map.jumpTo({ center: car.coord, bearing: lap.bearing, pitch: 68, zoom: 17.3, padding: { top: map.getContainer().clientHeight * 0.35, bottom: 0, left: 0, right: 0 } });
  lap.hud.update(t);
  // Hold the final time on screen for a moment before handing the camera back.
  if (t >= profile.lapTime + 3 * LAP_RATE) {
    stopLap(`Vuelta completada: ${formatLapTime(profile.lapTime, 3)} estimado (coche de carreras, ${(profile.length / 1000).toFixed(2)} km).`);
    return;
  }
  lap.frame = requestAnimationFrame(lapFrame);
}

function stopLap(message?: string) {
  if (!lap) return;
  cancelAnimationFrame(lap.frame);
  lap.marker.remove();
  lap.hud.destroy();
  const { restore, panelWasCollapsed } = lap;
  lap = null;
  if (!panelWasCollapsed) $('panel').classList.remove('collapsed');
  $('play').setAttribute('aria-pressed', 'false');
  $('play').textContent = '▶ Vuelta';
  map.easeTo({ ...restore, padding: { top: 0, bottom: 0, left: 0, right: 0 }, duration: 1200 });
  if (message) setStatus(message);
}

$('play').onclick = () => (lap ? stopLap() : startLap());
// Grabbing the map takes the camera back.
map.on('dragstart', () => stopLap());

// ---------- Start ----------

document.querySelector('[data-style="mapa"]')?.setAttribute('aria-pressed', 'true');
setView('2d', false);
setTool(tool);
updateUi();
if (circuit.snapToRoads) void fetchMissingRoutes();

// Exposed for automated checks and debugging in the browser console.
Object.assign(window, { trackpaint: { map, get circuit() { return circuit; }, loadCircuit, get lap() { return lap; } } });

// ---------- Keyboard panning (WASD, Shift to go faster) ----------

const PAN_KEYS: Record<string, [number, number]> = { w: [0, -1], a: [-1, 0], s: [0, 1], d: [1, 0] };
const heldKeys = new Set<string>();
let panFrame = 0;
let panFast = false;
function panLoop() {
  let dx = 0;
  let dy = 0;
  for (const k of heldKeys) {
    dx += PAN_KEYS[k][0];
    dy += PAN_KEYS[k][1];
  }
  if (!dx && !dy) {
    panFrame = 0;
    return;
  }
  const speed = panFast ? 24 : 10; // pixels per frame
  map.panBy([dx * speed, dy * speed], { duration: 0 });
  panFrame = requestAnimationFrame(panLoop);
}
const isTyping = (t: EventTarget | null) => !!(t as HTMLElement | null)?.closest?.('input, textarea, select, dialog[open]');
window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (!(k in PAN_KEYS) || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
  e.preventDefault();
  panFast = e.shiftKey;
  heldKeys.add(k);
  if (!panFrame) panFrame = requestAnimationFrame(panLoop);
});
window.addEventListener('keyup', (e) => {
  heldKeys.delete(e.key.toLowerCase());
  panFast = e.shiftKey;
});
window.addEventListener('blur', () => heldKeys.clear());
