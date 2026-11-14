import type { Map as MLMap, GeoJSONSource, StyleSpecification } from 'maplibre-gl';
import type { Circuit } from './circuit';
import { type LngLat, type Sample, ribbonEdges, ribbonQuads } from './geometry';

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
const SOURCES = ['tp-surface', 'tp-edges', 'tp-center', 'tp-start', 'tp-points'] as const;

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
