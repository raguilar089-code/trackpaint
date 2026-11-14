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
import { type LngLat, type Sample, simplify } from './geometry';
import { STYLES, addTrackLayers, renderStroke, renderTrack } from './render';
import { type Locality, flagUrl, reverseGeocode, routeSegment, searchPlaces } from './services';
import { analyzeTrack } from './analysis';
import { type PosterTheme, drawPoster } from './poster';
import * as storage from './storage';

type Tool = 'paint' | 'draw' | 'edit' | 'pan';
type StyleName = keyof typeof STYLES;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// ---------- State ----------

let circuit: Circuit = storage.loadDraft() ?? newCircuit();
let samples: Sample[] = [];
let tool: Tool = circuit.points.length ? 'edit' : 'paint';
let dragIndex: number | null = null;
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
  redraw();
});

// ---------- Rendering ----------

function redraw() {
  samples = buildCentreline(circuit, routes);
  if (map.getSource('tp-points')) renderTrack(map, circuit, samples, tool !== 'pan');
  updateStats();
}

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

map.on('click', (e) => {
  if (tool === 'pan' || tool === 'paint') return;
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
  const onTrack = map.queryRenderedFeatures(e.point, { layers: ['tp-hit'] }).length > 0;
  if (onTrack && samples.length > 1) {
    const seg = nearestSegment(p);
    commit((c) => c.points.splice(seg + 1, 0, p));
  }
});

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
  if (tool !== 'paint' || dragIndex !== null) return;
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
  applyStroke(pts);
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
  pan: 'Mueve, gira e inclina el mapa sin tocar el trazado.',
};

function setTool(t: Tool) {
  tool = t;
  document.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((b) => {
    b.setAttribute('aria-checked', String(b.dataset.tool === t));
  });
  $('hint').textContent = HINTS[t];
  $('map').classList.toggle('drawing', t === 'draw' || t === 'paint');
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
  const key = (c: Circuit) => JSON.stringify([c.name, c.points, c.closed, c.width, c.snapToRoads]);
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

// ---------- Start ----------

document.querySelector('[data-style="mapa"]')?.setAttribute('aria-pressed', 'true');
setView('2d', false);
setTool(tool);
updateUi();
if (circuit.snapToRoads) void fetchMissingRoutes();

// Exposed for automated checks and debugging in the browser console.
Object.assign(window, { trackpaint: { map, get circuit() { return circuit; }, loadCircuit } });
