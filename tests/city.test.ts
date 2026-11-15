import { describe, expect, it, vi } from 'vitest';
import geojsonvt from 'geojson-vt';
import vtpbf from 'vt-pbf';
import { fetchCity } from '../src/city';

describe('fetchCity', () => {
  it('reads streets and buildings from the vector tiles around the track', async () => {
    const street = { type: 'Feature', properties: { class: 'primary' }, geometry: { type: 'LineString', coordinates: [[-3.71, 40.4], [-3.69, 40.4]] } };
    const tunnel = { type: 'Feature', properties: { class: 'minor', brunnel: 'tunnel' }, geometry: { type: 'LineString', coordinates: [[-3.7, 40.399], [-3.7, 40.401]] } };
    const house = { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[-3.7, 40.4005], [-3.6995, 40.4005], [-3.6995, 40.401], [-3.7, 40.401], [-3.7, 40.4005]]] } };
    const fc = (features: unknown[]) => ({ type: 'FeatureCollection', features }) as never;
    const t = geojsonvt(fc([street, tunnel]), { maxZoom: 14, indexMaxZoom: 14 });
    const b = geojsonvt(fc([house]), { maxZoom: 14, indexMaxZoom: 14 });
    const urls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      urls.push(url);
      const [z, x, y] = url.match(/(\d+)\/(\d+)\/(\d+)/)!.slice(1).map(Number);
      const layers: Record<string, unknown> = {};
      const tt = t.getTile(z, x, y);
      const bt = b.getTile(z, x, y);
      if (tt) layers.transportation = tt;
      if (bt) layers.building = bt;
      const buf = vtpbf.fromGeojsonVt(layers as never, { version: 2 });
      return { ok: true, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
    });
    const map = { getStyle: () => ({ sources: { openmaptiles: { type: 'vector', tiles: ['https://t/{z}/{x}/{y}.pbf'], maxzoom: 14 } } }) };
    const city = await fetchCity(map as never, [[-3.705, 40.398], [-3.695, 40.402]]);
    vi.unstubAllGlobals();
    expect(urls.every((u) => u.startsWith('https://t/14/'))).toBe(true);
    expect(city!.roads.length).toBeGreaterThan(0);
    expect(city!.roads.every((r) => r.kind === 'major')).toBe(true); // the tunnel is left out
    expect(city!.buildings.length).toBeGreaterThan(0);
    const [lng, lat] = city!.buildings[0][0][0];
    expect(lng).toBeCloseTo(-3.7, 3);
    expect(lat).toBeCloseTo(40.4005, 3);
  });

  it('gives nothing when the map has no street tiles', async () => {
    const map = { getStyle: () => ({ sources: {} }) };
    expect(await fetchCity(map as never, [[0, 0], [0.01, 0.01]])).toBeNull();
  });
});
