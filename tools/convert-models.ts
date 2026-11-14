// Dev tool: converts the Unity FBX models to compact GLB (geometry, UVs and
// material names only; textures are shared files loaded at runtime).
// Run through Playwright: see tools/convert-models.cjs.
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

const BASE = `${import.meta.env.BASE_URL}assets-src/unity/models/`;

async function convert(name: string) {
  const loader = new FBXLoader();
  // Textures are not needed here; stop the loader from fetching them.
  loader.manager.setURLModifier((url) => (/\.(png|jpe?g|tga|psd)$/i.test(url) ? 'data:,' : url));
  const obj = await loader.loadAsync(BASE + name + '.FBX');
  const info: unknown[] = [];
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mats = (Array.isArray(m.material) ? m.material : [m.material]) as THREE.Material[];
    const plain = mats.map((src) => new THREE.MeshStandardMaterial({ name: src.name, side: THREE.DoubleSide }));
    m.material = Array.isArray(m.material) ? plain : plain[0];
    m.geometry.deleteAttribute('color');
    info.push({ mesh: m.name, verts: m.geometry.attributes.position.count, mats: plain.map((x) => x.name) });
  });
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);
  const glb = (await new GLTFExporter().parseAsync(obj, { binary: true })) as ArrayBuffer;
  const bytes = new Uint8Array(glb);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { name, size: box.getSize(new THREE.Vector3()).toArray(), min: box.min.toArray(), info, glb: btoa(bin) };
}

Object.assign(window, { convert });
