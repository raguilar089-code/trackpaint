// Loading of the circuit furniture models (converted from the Unity project).
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const BASE = `${import.meta.env.BASE_URL}assets/models/`;
/** The FBX files are in inches. */
export const MODEL_SCALE = 0.0254;

/** Shared texture for each material name used in the models. */
const TEXTURES: Record<string, { file: string; alpha?: boolean }> = {
  PORTIMAO: { file: 'PORTIMAO.jpg' },
  garages_PORTIMAO: { file: 'garages_PORTIMAO.webp', alpha: true },
  barriers_PORTIMAO: { file: 'barriers_PORTIMAO.jpg' },
  tyres_PORTIMAO: { file: 'tyres_PORTIMAO.jpg' },
  fence_metal_PORTIMAO: { file: 'metal_fence_PORTIMAO.webp', alpha: true },
};

const texLoader = new THREE.TextureLoader();
const materials = new Map<string, THREE.Material>();
function material(name: string): THREE.Material {
  let m = materials.get(name);
  if (m) return m;
  const t = TEXTURES[name];
  const mat = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
  if (t) {
    const tex = texLoader.load(BASE + 'tex/' + t.file);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.flipY = true; // UVs kept in the FBX convention
    tex.anisotropy = 4;
    mat.map = tex;
    if (t.alpha) mat.alphaTest = 0.5;
  } else mat.color.set('#bbbbbb');
  materials.set(name, mat);
  return mat;
}

const cache = new Map<string, Promise<THREE.Object3D>>();

/** A model scaled to metres, Y up, with the shared textures applied. */
export function loadModel(name: string): Promise<THREE.Object3D> {
  let p = cache.get(name);
  if (!p) {
    p = new GLTFLoader().loadAsync(`${BASE}${name}.glb`).then((gltf) => {
      const root = new THREE.Group();
      gltf.scene.scale.setScalar(MODEL_SCALE);
      root.add(gltf.scene);
      gltf.scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.material = Array.isArray(mesh.material)
          ? mesh.material.map((m) => material(m.name))
          : material(mesh.material.name);
      });
      root.updateMatrixWorld(true);
      return root;
    });
    cache.set(name, p);
  }
  return p;
}
