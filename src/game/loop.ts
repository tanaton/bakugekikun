// メインループ

import { updateHUD, setPerf } from '../ui/hud';
import { updateCamera, type InputState } from '../ui/input';
import { isProfilerOn, profShow, pt, ptBegin } from '../ui/profiler';
import { updateCars } from './cars';
import { updateBoomLights, miniBoom, updateFx, updateNukeEmitters } from './explosions';
import { updateBurning, updateBurningBldgs } from './fire';
import { updateCollapses } from './destruction';
import { updateMissiles } from './missiles';
import type { World } from './world';

// 1フレームぶんのシミュレーション進行(カメラ・HUD・renderer.render以外の全部)。
// スモークテストもこの関数で実機と同じ経路を回す
export function stepSim(world: World, dt: number, now: number): void {
  const { gfx, sim } = world;
  sim.simT += dt;
  updateCars(world, dt);   pt('cars');
  updateMissiles(world, dt, now);
  for (let i = sim.delayedBooms.length - 1; i >= 0; i--) {   // 二次爆発の発火
    if (sim.simT >= sim.delayedBooms[i].t) {
      const d = sim.delayedBooms[i];
      sim.delayedBooms.splice(i, 1);
      miniBoom(world, d);
    }
  }
  pt('missiles');
  updateBurning(world);          pt('burning');
  updateBurningBldgs(world);     pt('brnBldgs');
  updateNukeEmitters(world, dt); pt('nukeEmit');
  updateCollapses(world, dt);
  world.view.ground.flush(gfx.renderer, sim.simT);
  pt('collapse');
  updateFx(world, dt);           pt('fx');
  world.debris.update(dt, world.city.terrain); pt('debris');
  updateBoomLights(world, dt);   pt('boomLight');
  gfx.fireP.update(dt);
  gfx.smokeP.update(dt);         pt('particles');
  // 川の水面: 波のスクロールはシェーダー側(patchWaterShader)。時刻だけ渡す
  if (world.view.water) world.view.water.time.value = sim.simT;
}

export function startLoop(world: World, input: InputState): void {
  let last = performance.now();
  // FPS表示: 0.5秒ごとに更新
  let perfFrames = 0, perfLastT = performance.now();

  function loop(now: number): void {
    const { gfx, sim } = world;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    ptBegin();
    updateCamera(input, dt, world.city.terrain, gfx.camera, gfx.sunShadow, sim);
    pt('camera');
    stepSim(world, dt, now);
    updateHUD(sim.stats);          pt('hud');
    gfx.renderer.render(gfx.scene, gfx.camera);
    pt('render');
    perfFrames++;
    if (now - perfLastT >= 500) {
      setPerf(Math.round(perfFrames * 1000 / (now - perfLastT)));
      if (isProfilerOn()) profShow(gfx.renderer, perfFrames);
      perfFrames = 0; perfLastT = now;
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
}
