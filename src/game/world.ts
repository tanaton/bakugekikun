// World: ゲーム全体の状態の束。所有権で区画化する:
//   gfx/debris  … 起動時に1回生成、街の再生成をまたいで生存(常設プール類)
//   city/index/view … 街の再生成で丸ごと差し替え
//   sim         … 再生成でリセット
//   settings    … ユーザーのトグル状態

import { buildCityIndex, generateCityData, type CityData, type CityIndex } from '../core/cityGen';
import { buildCityView, type CityView } from '../render/cityMeshes';
import type { Gfx } from '../render/gfx';
import { LIGHT_SCALE, TIMES, type TimeMode } from '../render/sky';
import { resetNukeFlash } from '../ui/hud';
import { DebrisSystem } from './debris';
import { createSimState, type SimState } from './simState';

export interface Settings {
  timeMode: TimeMode;
  weaponIdx: number;
}

export interface World {
  seed: string;
  city: CityData;
  index: CityIndex;
  sim: SimState;
  view: CityView;
  gfx: Gfx;
  debris: DebrisSystem;
  settings: Settings;
}

export function createWorld(gfx: Gfx, seed: string): World {
  const settings: Settings = { timeMode: 'day', weaponIdx: 0 };
  const city = generateCityData(seed);
  const world: World = {
    seed, city,
    index: buildCityIndex(city),
    sim: createSimState(),
    view: buildCityView(gfx.scene, city, settings.timeMode),
    gfx,
    debris: new DebrisSystem(gfx.scene),
    settings,
  };
  setTotals(world);
  return world;
}

function setTotals(world: World): void {
  const { stats } = world.sim;
  stats.bTotal = world.city.buildings.length;
  stats.cTotal = world.city.cars.length;
  stats.tTotal = world.city.trees.length;
}

// シミュレーション状態のリセット(飛翔中のミサイル・エフェクト・光源・瓦礫を消す)
function resetSim(world: World): void {
  const { sim, gfx } = world;
  for (const m of sim.missiles) {
    gfx.scene.remove(m.mesh);
    if (m.marker) gfx.scene.remove(m.marker);
  }
  for (const f of sim.fx) gfx.fx.release(f.mesh);
  for (const L of gfx.boomLights) L.intensity = 0;
  for (const L of gfx.nukeLights) L.intensity = 0;
  world.debris.clear();
  gfx.fireP.clear();
  gfx.smokeP.clear();
  resetNukeFlash();
  world.sim = createSimState();
}

// 街の再生成。gfxの常設プールには触らない
export function regenerate(world: World, seed: string): void {
  resetSim(world);
  world.view.dispose();
  world.seed = seed;
  world.city = generateCityData(seed);
  world.index = buildCityIndex(world.city);
  world.view = buildCityView(world.gfx.scene, world.city, world.settings.timeMode);
  world.gfx.sunShadow.markFarDirty();   // 新しい街を全域シャドウマップへ焼き直す
  setTotals(world);
}

// 時間帯の切り替え(空・霧・太陽・窓明かり・地面・水面をまとめて更新)
export function applyTime(world: World, mode: TimeMode): void {
  world.settings.timeMode = mode;
  const T = TIMES[mode];
  const { scene, hemi, sun, sunShadow } = world.gfx;
  const fog = scene.fog as import('three').Fog;
  fog.color.setHex(T.fog); fog.near = T.fogNear; fog.far = T.fogFar;
  (scene.background as import('three').Color).setHex(T.fog);
  hemi.color.setHex(T.hemiSky); hemi.groundColor.setHex(T.hemiGnd);
  hemi.intensity = T.hemiInt * LIGHT_SCALE;
  sun.color.setHex(T.sunCol); sun.intensity = T.sunInt * LIGHT_SCALE;
  sunShadow.setSunOffset(T.sunPos);   // 影の向きは次フレームのupdateで反映される
  for (const m of world.view.emissiveMats) {
    m.emissiveIntensity = T.emissive * ((m.userData.eScale as number) || 1);
  }
  world.view.ground.drawGround(T.ground);
  if (world.view.water) {
    world.view.water.mat.color.set(T.ground.waterSurf);
    world.view.water.mat.specular.set(T.ground.waterSpec);
    world.view.water.mat.shininess = T.ground.waterShine;
    world.view.water.skyColor.value.set(T.ground.waterSky);
  }
}
