// テスト共通ヘルパー

import * as THREE from 'three';
import { rngFor } from '../src/core/rng';
import { generateFeatures, Terrain } from '../src/core/terrain';
import { SunShadow, TIMES, type TimeMode } from '../src/render/sky';

// 本体(cityGen)と同じストリーム割り当てで地形だけを生成する
export const mkTerrain = (seed: string): Terrain =>
  new Terrain(generateFeatures(rngFor(seed, 'features')), rngFor(seed, 'terrain'));

export interface SunRig { sun: THREE.DirectionalLight; camera: THREE.PerspectiveCamera; sunShadow: SunShadow }

// 本体(createGfx)と同じ構成の太陽+影のリグ。ライトのscene追加はSunShadowが行う
export function mkSunRig(scene: THREE.Scene, mode: TimeMode = 'day'): SunRig {
  const sun = new THREE.DirectionalLight(0xfff1d6, 1);
  sun.position.set(...TIMES[mode].sunPos);
  const camera = new THREE.PerspectiveCamera(55, 16 / 9, 2, 14000);
  return { sun, camera, sunShadow: new SunShadow(scene, sun, camera) };
}
