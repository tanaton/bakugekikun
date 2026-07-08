// 爆発光のプール。
// 注意: ライトをシーンにadd/removeするとライト数が変わり、Three.jsが全マテリアルの
// シェーダーを作り直して100ms級のスパイクになる。ライトは常設してintensityだけ動かすこと

import * as THREE from 'three';
import { LIGHT_SCALE } from './sky';

interface LightState { peak: number; age: number }

// decay=0: 逆二乗減衰を打ち消し、distanceまでのスムーズな減衰だけ残す(旧legacy lightsの見た目に近い)
export function makeLightPool(scene: THREE.Scene, n: number, color: number, distance: number): THREE.PointLight[] {
  const pool: THREE.PointLight[] = [];
  for (let i = 0; i < n; i++) {
    const L = new THREE.PointLight(color, 0, distance, 0);
    scene.add(L);
    pool.push(L);
  }
  return pool;
}

// プールから空きライトを取って点灯する(空きがなければ最古を上書き)
export function fireLight(pool: THREE.PointLight[], x: number, y: number, z: number, peak: number): void {
  let L = pool[0], oldest = -1;
  for (const l of pool) {
    if (l.intensity <= 0.05) { L = l; break; }
    const age = (l.userData as LightState).age;
    if (age > oldest) { oldest = age; L = l; }
  }
  L.position.set(x, y, z);
  L.userData = { peak: peak * LIGHT_SCALE, age: 0 } satisfies LightState;
  L.intensity = peak * LIGHT_SCALE;
}

// durかけて減光する。sq=trueは二乗カーブ(核の長い残光)、falseは線形
export function decayLights(pool: THREE.PointLight[], dt: number, dur: number, sq: boolean): void {
  for (const L of pool) {
    if (L.intensity <= 0) continue;
    const st = L.userData as LightState;
    st.age += dt;
    const k = Math.min(1, st.age / dur);
    L.intensity = k >= 1 ? 0 : st.peak * (sq ? (1 - k) * (1 - k) : 1 - k);
  }
}
