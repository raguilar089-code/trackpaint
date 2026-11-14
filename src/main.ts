import maplibregl, { type MapMouseEvent, type MapTouchEvent } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
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
import type { LngLat, Sample } from './geometry';
import { STYLES, addTrackLayers, renderTrack } from './render';
import { routeSegment, searchPlaces } from './services';
import * as storage from './storage';

type Tool = 'draw' | 'edit' | 'pan';
type StyleName = keyof typeof STYLES;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// ---------- State ----------

let circuit: Circuit = storage.loadDraft() ?? newCircuit();
let samples: Sample[] = [];
let tool: Tool = circuit.points.length ? 'edit' : 'draw';
let dragIndex: number | null = null;
const history = new History();
const routes = new Map<string, LngLat[]>();
const pendingRoutes = new Set<string>();

// ---------- Map ----------

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
}

// ---------- Editing on the map ----------

function pointAt(e: MapMouseEvent | MapTouchEvent): number | null {
  const f = map.queryRenderedFeatures(e.point, { layers: ['tp-points'] })[0];
  return f ? Number(f.properties?.index) : null;
}

map.on('click', (e) => {
  if (tool === 'pan') return;
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

// ---------- Panel ----------

const HINTS: Record<Tool, string> = {
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
  $('map').classList.toggle('drawing', t === 'draw');
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
  setTool(c.points.length ? 'edit' : 'draw');
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
  setTool('draw');
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
