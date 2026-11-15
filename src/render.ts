import type * as maplibregl from 'maplibre-gl';
import type { Map as MLMap, GeoJSONSource, StyleSpecification } from 'maplibre-gl';
import type { Circuit } from './circuit';
import { type LngLat, type Sample, ribbonEdges, ribbonQuads } from './geometry';
import {
  BLOCK_SIZES,
  ELEMENT_LABELS,
  PITLANE_WIDTH,
  type TrackElement,
  OVERTAKE_COLOR,
  SECTOR_COLORS,
  SPEEDTRAP_COLOR,
  STRAIGHT_MODE_COLOR,
  CRANE_COLOR,
  MARSHAL_COLOR,
  POST_SIZES,
  blockRing,
  crossLine,
  marshalNumbers,
  postBlock,
  kerbStripes,
  sectorBounds,
  sectorLines,
  sliceLine,
} from './elements';

const OSM_ATTR = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

export const STYLES: Record<'mapa' | 'satelite', string | StyleSpecification> = {
  mapa: 'https://tiles.openfreemap.org/styles/liberty',
  satelite: {
    version: 8,
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: {
      sat: {
        type: 'raster',
        tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
        tileSize: 256,
        maxzoom: 19,
        attribution: 'Imágenes © Esri, Maxar, Earthstar Geographics',
      },
      openmaptiles: { type: 'vector', url: 'https://tiles.openfreemap.org/planet', attribution: OSM_ATTR },
    },
    layers: [
      { id: 'sat', type: 'raster', source: 'sat' },
      {
        id: 'sat-buildings-3d',
        type: 'fill-extrusion',
        source: 'openmaptiles',
        'source-layer': 'building',
        minzoom: 14,
        paint: {
          'fill-extrusion-color': '#d8d2c8',
          'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 6],
          'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
          'fill-extrusion-opacity': 0.75,
        },
      },
    ],
  },
};

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
const SOURCES = [
  'tp-surface',
  'tp-edges',
  'tp-center',
  'tp-start',
  'tp-points',
  'tp-stroke',
  'tp-areas',
  'tp-pitlane',
  'tp-kerbs',
  'tp-lines',
  'tp-blocks',
  'tp-labels',
  'tp-selected',
  'tp-sectors',
  'tp-zones',
  'tp-markers',
  'tp-marker-labels',
] as const;

/** Line width in pixels that matches `m` metres on the ground at latitude `lat`. */
function metres(m: number, lat: number, minPx = 1): maplibregl.ExpressionSpecification {
  const mpp = (z: number) => (40075016.686 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** z);
  return ['interpolate', ['exponential', 2], ['zoom'], 12, Math.max(minPx, m / mpp(12)), 22, Math.max(minPx, m / mpp(22))];
}
let lastLat = 40;

function arrowImage(): ImageData {
  const size = 32;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.beginPath();
  ctx.moveTo(8, 6);
  ctx.lineTo(26, 16);
  ctx.lineTo(8, 26);
  ctx.lineTo(12, 16);
  ctx.closePath();
  ctx.fill();
  return ctx.getImageData(0, 0, size, size);
}

/** Add the track sources and layers. Call again after every style change. */
export function addTrackLayers(map: MLMap) {
  for (const id of SOURCES) {
    if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data: EMPTY });
  }
  if (!map.hasImage('tp-arrow')) map.addImage('tp-arrow', arrowImage(), { pixelRatio: 2 });

  map.addLayer({
    id: 'tp-grass',
    type: 'fill',
    source: 'tp-areas',
    filter: ['==', ['get', 'type'], 'grass'],
    paint: { 'fill-color': '#33763b' },
  });
  map.addLayer({
    id: 'tp-gravel',
    type: 'fill',
    source: 'tp-areas',
    filter: ['==', ['get', 'type'], 'gravel'],
    paint: { 'fill-color': '#d8c49b' },
  });
  map.addLayer({
    id: 'tp-runoff',
    type: 'fill',
    source: 'tp-areas',
    filter: ['==', ['get', 'type'], 'runoff'],
    paint: { 'fill-color': '#585c63' },
  });
  map.addLayer({
    id: 'tp-areas-outline',
    type: 'line',
    source: 'tp-areas',
    paint: { 'line-color': '#ffffff', 'line-opacity': 0.5, 'line-width': 1 },
  });
  map.addLayer({
    id: 'tp-pitlane-surface',
    type: 'fill',
    source: 'tp-pitlane',
    filter: ['==', ['geometry-type'], 'Polygon'],
    paint: { 'fill-color': '#3d4047', 'fill-antialias': false },
  });
  map.addLayer({
    id: 'tp-pitlane-edges',
    type: 'line',
    source: 'tp-pitlane',
    filter: ['==', ['geometry-type'], 'LineString'],
    paint: { 'line-color': '#ffffff', 'line-width': 1.2, 'line-dasharray': [4, 3] },
  });
  map.addLayer({
    id: 'tp-surface',
    type: 'fill',
    source: 'tp-surface',
    paint: { 'fill-color': '#34373d', 'fill-antialias': false },
  });
  map.addLayer({
    id: 'tp-edges',
    type: 'line',
    source: 'tp-edges',
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: {
      'line-color': '#ffffff',
      'line-width': ['interpolate', ['linear'], ['zoom'], 13, 0.5, 18, 2.5],
    },
  });
  // Straight Mode zones: translucent green band over the asphalt.
  map.addLayer({
    id: 'tp-zones',
    type: 'fill',
    source: 'tp-zones',
    paint: { 'fill-color': STRAIGHT_MODE_COLOR, 'fill-opacity': 0.35, 'fill-antialias': false },
  });
  // Sector colours as a stripe down the middle of the track.
  map.addLayer({
    id: 'tp-sectors',
    type: 'line',
    source: 'tp-sectors',
    layout: { 'line-cap': 'butt', 'line-join': 'round' },
    paint: { 'line-color': ['get', 'color'], 'line-width': metres(1.2, lastLat, 2), 'line-opacity': 0.9 },
  });
  map.addLayer({
    id: 'tp-kerbs',
    type: 'fill',
    source: 'tp-kerbs',
    paint: { 'fill-color': ['get', 'color'], 'fill-antialias': false },
  });
  map.addLayer({
    id: 'tp-walls',
    type: 'line',
    source: 'tp-lines',
    filter: ['==', ['get', 'type'], 'wall'],
    layout: { 'line-join': 'round' },
    paint: { 'line-color': '#c7cbd1', 'line-width': metres(0.8, lastLat, 2) },
  });
  map.addLayer({
    id: 'tp-fences',
    type: 'line',
    source: 'tp-lines',
    filter: ['==', ['get', 'type'], 'fence'],
    paint: { 'line-color': '#8fa1b3', 'line-width': metres(0.3, lastLat, 1.2), 'line-dasharray': [2, 1] },
  });
  // Round caps on zero-length dashes draw a row of tyres.
  map.addLayer({
    id: 'tp-tyres',
    type: 'line',
    source: 'tp-lines',
    filter: ['==', ['get', 'type'], 'tyres'],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#151515', 'line-width': metres(0.7, lastLat, 3), 'line-dasharray': [0, 1.4] },
  });
  // Start/finish line: white base with black dashes on top reads as a chequer.
  map.addLayer({
    id: 'tp-start-base',
    type: 'line',
    source: 'tp-start',
    paint: { 'line-color': '#ffffff', 'line-width': ['interpolate', ['linear'], ['zoom'], 14, 3, 19, 14] },
  });
  map.addLayer({
    id: 'tp-start-check',
    type: 'line',
    source: 'tp-start',
    paint: {
      'line-color': '#111111',
      'line-width': ['interpolate', ['linear'], ['zoom'], 14, 3, 19, 14],
      'line-dasharray': [0.5, 0.5],
    },
  });
  map.addLayer({
    id: 'tp-arrows',
    type: 'symbol',
    source: 'tp-center',
    minzoom: 14,
    layout: {
      'symbol-placement': 'line',
      'symbol-spacing': 140,
      'icon-image': 'tp-arrow',
      'icon-size': ['interpolate', ['linear'], ['zoom'], 14, 0.5, 19, 1.2],
      'icon-allow-overlap': true,
      'icon-rotation-alignment': 'map',
      'icon-pitch-alignment': 'map',
    },
  });
  // Invisible wide line used to click on the track to insert points.
  map.addLayer({
    id: 'tp-hit',
    type: 'line',
    source: 'tp-center',
    paint: { 'line-color': '#000000', 'line-opacity': 0, 'line-width': 22 },
  });
  // Live brush stroke while painting.
  map.addLayer({
    id: 'tp-stroke',
    type: 'line',
    source: 'tp-stroke',
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-color': '#e11d2e', 'line-width': 6, 'line-opacity': 0.75 },
  });
  map.addLayer({
    id: 'tp-markers',
    type: 'line',
    source: 'tp-markers',
    layout: { 'line-cap': 'round' },
    paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 13, 2, 18, 5] },
  });
  map.addLayer({
    id: 'tp-marker-labels',
    type: 'symbol',
    source: 'tp-marker-labels',
    minzoom: 14,
    layout: {
      'text-field': ['get', 'label'],
      'text-font': ['Noto Sans Bold'],
      'text-size': 11,
      'text-anchor': 'left',
      'text-offset': [0.6, 0],
      'text-allow-overlap': false,
    },
    paint: { 'text-color': ['get', 'color'], 'text-halo-color': '#111111', 'text-halo-width': 1.6 },
  });
  map.addLayer({
    id: 'tp-blocks',
    type: 'fill-extrusion',
    source: 'tp-blocks',
    paint: {
      'fill-extrusion-color': [
        'match',
        ['get', 'type'],
        'grandstand',
        '#2f6fd6',
        'marshal',
        MARSHAL_COLOR,
        'crane',
        CRANE_COLOR,
        '#e9eaec',
      ],
      'fill-extrusion-height': ['get', 'height'],
      'fill-extrusion-opacity': 0.92,
    },
  });
  map.addLayer({
    id: 'tp-labels',
    type: 'symbol',
    source: 'tp-labels',
    minzoom: 15,
    layout: {
      'text-field': ['get', 'label'],
      'text-font': ['Noto Sans Bold'],
      'text-size': 12,
      'text-rotation-alignment': 'map',
      'text-rotate': ['get', 'rotate'],
      'text-allow-overlap': true,
    },
    paint: { 'text-color': '#ffffff', 'text-halo-color': '#111111', 'text-halo-width': 1.4 },
  });
  map.addLayer({
    id: 'tp-selected',
    type: 'line',
    source: 'tp-selected',
    paint: { 'line-color': '#facc15', 'line-width': 3, 'line-dasharray': [2, 1] },
  });
  map.addLayer({
    id: 'tp-points',
    type: 'circle',
    source: 'tp-points',
    paint: {
      'circle-radius': ['case', ['==', ['get', 'index'], 0], 8, 6],
      'circle-color': ['case', ['==', ['get', 'index'], 0], '#22c55e', '#ffffff'],
      'circle-stroke-color': '#e11d2e',
      'circle-stroke-width': 2.5,
      'circle-pitch-alignment': 'map',
    },
  });
}

function setData(map: MLMap, id: string, data: GeoJSON.GeoJSON) {
  (map.getSource(id) as GeoJSONSource | undefined)?.setData(data);
}

export function renderTrack(map: MLMap, circuit: Circuit, samples: Sample[], showPoints: boolean) {
  const coords = samples.map((s) => s.coord);
  const line = (c: LngLat[]): GeoJSON.Feature => ({
    type: 'Feature',
    properties: {},
    geometry: { type: 'LineString', coordinates: c },
  });

  if (coords.length >= 2) {
    const { left, right } = ribbonEdges(coords, circuit.width);
    setData(map, 'tp-surface', {
      type: 'FeatureCollection',
      features: ribbonQuads(coords, circuit.width).map((ring) => ({
        type: 'Feature',
        properties: {},
        geometry: { type: 'Polygon', coordinates: [ring] },
      })),
    });
    setData(map, 'tp-edges', { type: 'FeatureCollection', features: [line(left), line(right)] });
    setData(map, 'tp-center', line(coords));
    setData(map, 'tp-start', line([left[0], right[0]]));
  } else {
    for (const id of ['tp-surface', 'tp-edges', 'tp-center', 'tp-start']) setData(map, id, EMPTY);
  }

  setData(map, 'tp-points', {
    type: 'FeatureCollection',
    features: showPoints
      ? circuit.points.map((p, index) => ({
          type: 'Feature',
          properties: { index },
          geometry: { type: 'Point', coordinates: p },
        }))
      : [],
  });
}

export function renderStroke(map: MLMap, coords: LngLat[]) {
  setData(
    map,
    'tp-stroke',
    coords.length > 1 ? { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } } : EMPTY,
  );
}

type Feature = GeoJSON.Feature;
const poly = (ring: LngLat[], props: Record<string, unknown> = {}): Feature => ({
  type: 'Feature',
  properties: props,
  geometry: { type: 'Polygon', coordinates: [ring] },
});
const lineF = (coords: LngLat[], props: Record<string, unknown> = {}): Feature => ({
  type: 'Feature',
  properties: props,
  geometry: { type: 'LineString', coordinates: coords },
});

/** Outline of an element, used to show it selected and to hit-test it. */
export function elementOutline(e: TrackElement, centre: LngLat[], closed: boolean, width: number): Feature | null {
  switch (e.type) {
    case 'kerb': {
      const stripes = kerbStripes(e, centre, closed, width);
      if (!stripes.length) return null;
      const outer = stripes.map((s) => s.ring[3]).concat([stripes[stripes.length - 1].ring[2]]);
      const inner = stripes.map((s) => s.ring[0]).concat([stripes[stripes.length - 1].ring[1]]);
      return poly([...inner, ...outer.reverse(), inner[0]], { id: e.id });
    }
    case 'gravel':
    case 'runoff':
    case 'grass':
      return poly([...e.ring, e.ring[0]], { id: e.id });
    case 'pits':
    case 'grandstand':
      return poly(blockRing(e), { id: e.id });
    case 'sector':
    case 'speedtrap':
    case 'overtake': {
      const l = crossLine(centre, e.at, closed, width, 6);
      return l.length ? lineF(l, { id: e.id }) : null;
    }
    case 'marshal':
    case 'crane': {
      const b = postBlock(e, centre, closed, width);
      return b ? poly(blockRing(b), { id: e.id }) : null;
    }
    case 'straightmode': {
      const path = sliceLine(centre, e.from, e.to, closed, 3);
      if (path.length < 2) return null;
      const { left, right } = ribbonEdges(path, width + 2);
      return poly([...left, ...right.reverse(), left[0]], { id: e.id });
    }
    default:
      return lineF(e.coords, { id: e.id });
  }
}

export function renderElements(
  map: MLMap,
  elements: TrackElement[],
  centre: LngLat[],
  closed: boolean,
  width: number,
  selectedId: string | null,
) {
  if (centre[0]) lastLat = centre[0][1];
  const areas: Feature[] = [];
  const pitlane: Feature[] = [];
  const kerbs: Feature[] = [];
  const lines: Feature[] = [];
  const blocks: Feature[] = [];
  const labels: Feature[] = [];
  const zones: Feature[] = [];
  const markers: Feature[] = [];
  const markerLabels: Feature[] = [];
  const markerLabel = (line: LngLat[], label: string, color: string, id: string) => {
    markers.push(lineF(line, { id, color }));
    markerLabels.push({ type: 'Feature', properties: { id, label, color }, geometry: { type: 'Point', coordinates: line[0] } });
  };
  const bounds = sectorBounds(elements);
  const sectors = bounds.length === 2 ? sectorLines(centre, bounds) : [];
  let zoneNo = 0;
  const postNo = marshalNumbers(elements);
  const sortedZones = elements
    .filter((e) => e.type === 'straightmode')
    .sort((a, b) => (a as { from: number }).from - (b as { from: number }).from)
    .map((e) => e.id);
  for (const e of elements) {
    switch (e.type) {
      case 'sector': {
        const l = crossLine(centre, e.at, closed, width, 6);
        const k = bounds.indexOf(e.at);
        if (l.length) markerLabel(l, k >= 0 ? `S${k + 2}` : 'Sector', SECTOR_COLORS[k >= 0 ? k + 1 : 0], e.id);
        break;
      }
      case 'speedtrap': {
        const l = crossLine(centre, e.at, closed, width, 6);
        if (l.length) markerLabel(l, 'SPEED TRAP', SPEEDTRAP_COLOR, e.id);
        break;
      }
      case 'overtake': {
        const l = crossLine(centre, e.at, closed, width, 6);
        if (l.length) markerLabel(l, 'DETECCIÓN OVERTAKE', OVERTAKE_COLOR, e.id);
        break;
      }
      case 'marshal':
      case 'crane': {
        const b = postBlock(e, centre, closed, width);
        if (!b) break;
        blocks.push(poly(blockRing(b), { id: e.id, type: e.type, height: POST_SIZES[e.type].height }));
        labels.push({
          type: 'Feature',
          properties: { id: e.id, label: e.type === 'marshal' ? `P${postNo.get(e.id)}` : 'GRÚA', rotate: 0 },
          geometry: { type: 'Point', coordinates: b.center },
        });
        break;
      }
      case 'straightmode': {
        const path = sliceLine(centre, e.from, e.to, closed, 3);
        if (path.length < 2) break;
        for (const q of ribbonQuads(path, width)) zones.push(poly(q, { id: e.id }));
        zoneNo = sortedZones.indexOf(e.id) + 1;
        const start = crossLine(centre, e.from, closed, width, 6);
        if (start.length) markerLabel(start, `STRAIGHT MODE ${zoneNo}`, STRAIGHT_MODE_COLOR, e.id);
        break;
      }
      case 'kerb':
        for (const s of kerbStripes(e, centre, closed, width)) kerbs.push(poly(s.ring, { id: e.id, color: s.color }));
        break;
      case 'gravel':
      case 'runoff':
      case 'grass':
        areas.push(poly([...e.ring, e.ring[0]], { id: e.id, type: e.type }));
        break;
      case 'pitlane': {
        for (const q of ribbonQuads(e.coords, PITLANE_WIDTH)) pitlane.push(poly(q, { id: e.id }));
        const { left, right } = ribbonEdges(e.coords, PITLANE_WIDTH);
        pitlane.push(lineF(left, { id: e.id }), lineF(right, { id: e.id }));
        break;
      }
      case 'pits':
      case 'grandstand':
        blocks.push(poly(blockRing(e), { id: e.id, type: e.type, height: BLOCK_SIZES[e.type].height }));
        labels.push({
          type: 'Feature',
          properties: {
            id: e.id,
            label: ELEMENT_LABELS[e.type].toUpperCase(),
            // Keep text upright-ish along the long side.
            rotate: ((((e.bearing - 90 + 90) % 180) + 180) % 180) - 90,
          },
          geometry: { type: 'Point', coordinates: e.center },
        });
        break;
      default:
        lines.push(lineF(e.coords, { id: e.id, type: e.type }));
    }
  }
  setData(map, 'tp-zones', { type: 'FeatureCollection', features: zones });
  setData(map, 'tp-markers', { type: 'FeatureCollection', features: markers });
  setData(map, 'tp-marker-labels', { type: 'FeatureCollection', features: markerLabels });
  setData(map, 'tp-sectors', {
    type: 'FeatureCollection',
    features: sectors.filter((l) => l.length > 1).map((l, i) => lineF(l, { color: SECTOR_COLORS[i] })),
  });
  const fc = (features: Feature[]): GeoJSON.FeatureCollection => ({ type: 'FeatureCollection', features });
  setData(map, 'tp-areas', fc(areas));
  setData(map, 'tp-pitlane', fc(pitlane));
  setData(map, 'tp-kerbs', fc(kerbs));
  setData(map, 'tp-lines', fc(lines));
  setData(map, 'tp-blocks', fc(blocks));
  setData(map, 'tp-labels', fc(labels));
  const sel = selectedId ? elements.find((e) => e.id === selectedId) : undefined;
  const outline = sel ? elementOutline(sel, centre, closed, width) : null;
  setData(map, 'tp-selected', fc(outline ? [outline] : []));
}

/** Use one of the user's textures as a fill pattern once it has loaded. */
export async function usePattern(map: MLMap, layer: string, name: string, url: string) {
  try {
    if (!map.hasImage(name)) {
      const img = await map.loadImage(url);
      if (!map.hasImage(name)) map.addImage(name, img.data, { pixelRatio: 4 });
    }
    if (map.getLayer(layer)) map.setPaintProperty(layer, 'fill-pattern', name);
  } catch {
    /* keep the plain colour */
  }
}
