// カメラ操作(WASD移動・ドラッグ回転・ホイールズーム)と右クリック爆撃指定

import * as THREE from 'three';
import { clampToMap } from '../core/config';
import type { Terrain } from '../core/terrain';
import type { SunShadow } from '../render/sky';
import { initAudio } from './audio';

export interface CamState {
  focus: THREE.Vector3;
  yaw: number;
  pitch: number;
  dist: number;
}

export interface InputState {
  cam: CamState;
  keys: Record<string, boolean>;
}

export function createInput(canvas: HTMLCanvasElement,
    onStrike: (px: number, py: number) => void): InputState {
  const cam: CamState = { focus: new THREE.Vector3(0, 0, 0), yaw: 0.7, pitch: 0.95, dist: 950 };
  const keys: Record<string, boolean> = {};
  addEventListener('keydown', e => {
    if ((e.target as HTMLElement).tagName !== 'INPUT') keys[e.code] = true;
  });
  addEventListener('keyup', e => { keys[e.code] = false; });
  // フォーカスを失うとkeyupが届かず押しっぱなしになるため、全キーを解除する
  addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

  let dragging = false, lastX = 0, lastY = 0;
  canvas.addEventListener('pointerdown', e => {
    if (e.button === 0) { dragging = true; lastX = e.clientX; lastY = e.clientY; canvas.setPointerCapture(e.pointerId); }
    if (e.button === 2) { onStrike(e.clientX, e.clientY); }
    initAudio();
  });
  addEventListener('pointerup', () => { dragging = false; });
  addEventListener('pointermove', e => {
    if (!dragging) return;
    cam.yaw -= (e.clientX - lastX) * 0.005;
    cam.pitch += (e.clientY - lastY) * 0.004;
    cam.pitch = THREE.MathUtils.clamp(cam.pitch, 0.28, 1.5);
    lastX = e.clientX; lastY = e.clientY;
  });
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    cam.dist *= Math.exp(e.deltaY * 0.0011);
    cam.dist = THREE.MathUtils.clamp(cam.dist, 120, 4200);
  }, { passive: false });
  addEventListener('contextmenu', e => e.preventDefault());

  return { cam, keys };
}

// カメラの更新。shakeRefは残り揺れ量を持つオブジェクト(worldのsimが所有)
export function updateCamera(input: InputState, dt: number, terrain: Terrain,
    camera: THREE.PerspectiveCamera, sunShadow: SunShadow, sim: { shake: number }): void {
  const { cam, keys } = input;
  const sp = cam.dist * 0.9 * dt * (keys.ShiftLeft || keys.ShiftRight ? 2.4 : 1);
  const fwx = Math.sin(cam.yaw), fwz = Math.cos(cam.yaw);
  if (keys.KeyW) { cam.focus.x -= fwx * sp; cam.focus.z -= fwz * sp; }
  if (keys.KeyS) { cam.focus.x += fwx * sp; cam.focus.z += fwz * sp; }
  if (keys.KeyA) { cam.focus.x -= fwz * sp; cam.focus.z += fwx * sp; }
  if (keys.KeyD) { cam.focus.x += fwz * sp; cam.focus.z -= fwx * sp; }
  cam.focus.x = clampToMap(cam.focus.x);
  cam.focus.z = clampToMap(cam.focus.z);
  cam.focus.y = terrain.h(cam.focus.x, cam.focus.z);   // 注視点は地形に追従
  sunShadow.update(cam);                               // 影カメラも注視点に追従

  const cp = Math.cos(cam.pitch), sinP = Math.sin(cam.pitch);
  camera.position.set(
    cam.focus.x + fwx * cp * cam.dist,
    cam.focus.y + sinP * cam.dist,
    cam.focus.z + fwz * cp * cam.dist);
  const minY = terrain.h(camera.position.x, camera.position.z) + 12;  // 山にめり込まない
  if (camera.position.y < minY) camera.position.y = minY;
  camera.lookAt(cam.focus);
  sim.shake = Math.min(sim.shake, 36);
  if (sim.shake > 0.001) {
    const t = performance.now() * 0.05;
    camera.position.x += Math.sin(t * 1.3) * sim.shake;
    camera.position.y += Math.sin(t * 1.7 + 2) * sim.shake * 0.6;
    camera.position.z += Math.cos(t * 1.1) * sim.shake;
    sim.shake *= Math.exp(-4.5 * dt);
  }
}
