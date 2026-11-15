import * as THREE from 'three';
import { loadModel } from '../src/models3d';

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(1200, 800);
document.body.appendChild(renderer.domElement);

async function show(name: string, view: 'front' | 'top' | 'iso' | 'side') {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#9aa');
  scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 2.2));
  const sun = new THREE.DirectionalLight(0xffffff, 2);
  sun.position.set(1, 2, 1.5);
  scene.add(sun);
  const obj = (await loadModel(name)).clone();
  scene.add(obj);
  scene.add(new THREE.AxesHelper(5));
  const box = new THREE.Box3().setFromObject(obj);
  const c = box.getCenter(new THREE.Vector3());
  const r = box.getSize(new THREE.Vector3()).length();
  const cam = new THREE.PerspectiveCamera(35, 1.5, 0.1, 5000);
  const dir = view === 'side' ? new THREE.Vector3(1, 0.05, 0) : view === 'front' ? new THREE.Vector3(0, 0.15, 1) : view === 'top' ? new THREE.Vector3(0, 1, 0.001) : new THREE.Vector3(1, 0.7, 1);
  cam.position.copy(c).addScaledVector(dir.normalize(), r * 1.4);
  cam.lookAt(c);
  renderer.render(scene, cam);
  return renderer.domElement.toDataURL('image/jpeg', 0.85);
}
Object.assign(window, { show });
