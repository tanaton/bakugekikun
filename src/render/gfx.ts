// レンダラ・シーン・カメラ・常設プールの起動時初期化。
// ここで作るものは街の再生成をまたいで生存する(ライト常設の約束事を構造で保証)

import * as THREE from 'three';
import './colorMode';
import { FxPools } from './fxPool';
import { forEachMaterial } from './instanced';
import { makeLightPool } from './lightPool';
import { ParticlePool } from './particles';
import { LIGHT_SCALE, SunShadow, TIMES } from './sky';

export interface Gfx {
  canvas: HTMLCanvasElement;
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  hemi: THREE.HemisphereLight;
  sun: THREE.DirectionalLight;
  sunShadow: SunShadow;
  fireP: ParticlePool;
  smokeP: ParticlePool;
  boomLights: THREE.PointLight[];   // 通常爆発
  nukeLights: THREE.PointLight[];   // 核爆発の巨大光源
  fx: FxPools;
}

export function createGfx(canvas: HTMLCanvasElement): Gfx {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;   // r185でPCFSoftは廃止(指定しても警告つきでPCFに落ちる)

  // 初期状態は昼プリセット(値の二重管理を避けてTIMESを唯一の定義にする。
  // Settingsの初期timeModeも'day'で、以後の切り替えはapplyTimeが同じTIMESを適用する)
  const T = TIMES.day;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(T.fog);
  scene.fog = new THREE.Fog(T.fog, T.fogNear, T.fogFar);

  const camera = new THREE.PerspectiveCamera(55, 1, 2, 14000);

  // 環境光(時間帯で切り替え)
  const hemi = new THREE.HemisphereLight(T.hemiSky, T.hemiGnd, T.hemiInt * LIGHT_SCALE);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(T.sunCol, T.sunInt * LIGHT_SCALE);
  sun.position.set(...T.sunPos);
  const sunShadow = new SunShadow(scene, sun, camera);   // ライトのscene追加もSunShadowが行う

  return {
    canvas, renderer, scene, camera, hemi, sun, sunShadow,
    fireP: new ParticlePool(5200, THREE.AdditiveBlending, scene),
    smokeP: new ParticlePool(4600, THREE.NormalBlending, scene),
    boomLights: makeLightPool(scene, 6, 0xffa050, 1000),
    nukeLights: makeLightPool(scene, 2, 0xffe2b0, 3400),
    fx: new FxPools(scene),
  };
}

export function resizeGfx(gfx: Gfx): void {
  gfx.renderer.setSize(innerWidth, innerHeight);
  gfx.camera.aspect = innerWidth / innerHeight;
  gfx.camera.updateProjectionMatrix();
}

// 影品質(高=4096 / 低=2048 / OFF)。ON/OFFはshadowMap.enabledの変更で、全マテリアルに
// needsUpdateを立てないと反映されず、その再コンパイルで切替の瞬間だけスパイクが出る
// (ユーザー操作時のみなので許容)。高↔低は解像度の切り替えだけで再コンパイルは起きない
export type ShadowMode = 'high' | 'low' | 'off';

export function applyShadowMode(gfx: Gfx, mode: ShadowMode): void {
  const on = mode !== 'off';
  if (gfx.renderer.shadowMap.enabled !== on) {
    gfx.renderer.shadowMap.enabled = on;
    gfx.scene.traverse(o => forEachMaterial(o, m => { m.needsUpdate = true; }));
  }
  if (on) gfx.sunShadow.setResolution(mode === 'high' ? 1 : 0.5);
}
