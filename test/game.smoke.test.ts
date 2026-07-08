// node + DOMスタブでゲーム本体(render/game層)を通す統合スモークテスト。
// WebGLRendererだけは使えないので、renderer.render以外の全経路
// (街の構築 → 爆撃 → 破壊 → 崩壊 → 再生成)を実行して例外と状態を検証する

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

// ---------- DOM/ブラウザAPIのスタブ ----------
// canvas 2Dコンテキスト等は「何を呼ばれても吸収する」Proxyで受ける
/* eslint-disable @typescript-eslint/no-explicit-any */
const absorb: any = new Proxy(function () { /* absorb */ }, {
  get(_t, key) {
    if (key === Symbol.toPrimitive) return () => 0;
    return absorb;
  },
  set: () => true,
  apply: () => absorb,
});

function makeCanvasStub(): any {
  return { width: 0, height: 0, style: {}, getContext: () => absorb };
}

function makeElementStub(): any {
  return {
    textContent: '', value: 'BAKUGEKI-01', offsetWidth: 0,
    style: {}, classList: { add() { /* noop */ }, remove() { /* noop */ } },
    addEventListener() { /* noop */ },
  };
}

const elements = new Map<string, any>();
(globalThis as any).document = {
  createElement: (tag: string) => tag === 'canvas' ? makeCanvasStub() : makeElementStub(),
  getElementById: (id: string) => {
    if (!elements.has(id)) elements.set(id, makeElementStub());
    return elements.get(id);
  },
};
(globalThis as any).Path2D = class {
  moveTo() { /* noop */ } lineTo() { /* noop */ } closePath() { /* noop */ }
};
(globalThis as any).window = { AudioContext: undefined };
(globalThis as any).innerWidth = 1280;
(globalThis as any).innerHeight = 720;
/* eslint-enable @typescript-eslint/no-explicit-any */

// スタブを立ててから本体モジュールを読み込む
const { ParticlePool } = await import('../src/render/particles');
const { FxPools } = await import('../src/render/fxPool');
const { makeLightPool } = await import('../src/render/lightPool');
const { SunShadow } = await import('../src/render/sky');
const { applyTime, createWorld, regenerate } = await import('../src/game/world');
const { detonate, detonateNuke, miniBoom, updateFx, updateNukeEmitters, updateBoomLights } =
  await import('../src/game/explosions');
const { updateCollapses } = await import('../src/game/destruction');
const { updateBurning, updateBurningBldgs } = await import('../src/game/fire');
const { requestStrike, updateMissiles } = await import('../src/game/missiles');
const { updateCars } = await import('../src/game/cars');
const { B } = await import('../src/core/types');
import type { Gfx } from '../src/render/gfx';

// WebGLRendererなしの偽Gfx(それ以外は本物)
function makeFakeGfx(): Gfx {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x8ec4f0);
  scene.fog = new THREE.Fog(0x8ec4f0, 1600, 9000);
  const camera = new THREE.PerspectiveCamera(55, 16 / 9, 2, 14000);
  const hemi = new THREE.HemisphereLight(0xbdd5ee, 0x8a8578, 1);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff1d6, 1);
  sun.position.set(-900, 2000, 700);
  scene.add(sun);
  scene.add(sun.target);
  return {
    canvas: null as unknown as HTMLCanvasElement,
    renderer: null as unknown as THREE.WebGLRenderer,
    scene, camera, hemi, sun,
    sunShadow: new SunShadow(sun, camera),
    fireP: new ParticlePool(5200, THREE.AdditiveBlending, scene),
    smokeP: new ParticlePool(4600, THREE.NormalBlending, scene),
    boomLights: makeLightPool(scene, 6, 0xffa050, 1000),
    nukeLights: makeLightPool(scene, 2, 0xffe2b0, 3400),
    fx: new FxPools(scene),
  };
}

// 1フレームぶんのシミュレーション(renderer.render以外のループ本体)
function step(world: ReturnType<typeof createWorld>, dt: number, now: number): void {
  const { sim } = world;
  sim.simT += dt;
  updateCars(world, dt);
  updateMissiles(world, dt, now);
  for (let i = sim.delayedBooms.length - 1; i >= 0; i--) {
    if (sim.simT >= sim.delayedBooms[i].t) {
      const d = sim.delayedBooms[i];
      sim.delayedBooms.splice(i, 1);
      miniBoom(world, d);
    }
  }
  updateBurning(world);
  updateBurningBldgs(world);
  updateNukeEmitters(world, dt);
  updateCollapses(world, dt);
  updateFx(world, dt);
  world.debris.update(dt, world.city.terrain);
  updateBoomLights(world, dt);
  world.gfx.fireP.update(dt);
  world.gfx.smokeP.update(dt);
}

describe('ゲーム統合スモーク(nodeスタブ)', () => {
  it('街の構築 → 爆撃 → 破壊 → 核 → 再生成が例外なく通り、統計が動く', () => {
    const gfx = makeFakeGfx();
    const world = createWorld(gfx, 'BAKUGEKI-01');

    // 街の3D表現が構築されている
    expect(world.view.bMeshes.length).toBeGreaterThanOrEqual(2);
    expect(world.view.treeChunks.length).toBeGreaterThan(0);
    expect(world.view.carMesh.count).toBe(world.city.cars.length);
    expect(world.sim.stats.bTotal).toBe(world.city.buildings.length);

    // カメラを構えて数フレーム回す(平常時)
    gfx.camera.position.set(400, 600, 400);
    gfx.camera.lookAt(0, 0, 0);
    gfx.camera.updateMatrixWorld(true);   // ブラウザではrenderer.renderが行う行列更新
    let now = 0;
    for (let i = 0; i < 10; i++) { now += 16; step(world, 0.016, now); }

    // 画面中央へ爆撃指定 → ミサイルが生まれる
    requestStrike(world, 640, 360);
    expect(world.sim.missiles.length).toBe(1);
    expect(world.sim.stats.mCount).toBe(1);

    // 着弾まで進める(最長10秒ぶん)
    for (let i = 0; i < 600 && world.sim.missiles.length; i++) { now += 16; step(world, 0.016, now); }
    expect(world.sim.missiles.length).toBe(0);

    // 建物密集地の中心に直接起爆して破壊を確認
    const target = world.city.buildings[Math.floor(world.city.buildings.length / 2)];
    const before = world.sim.stats.bDead;
    detonate(world, { x: target.x, y: target.gy, z: target.z }, 105);
    expect(world.sim.stats.bDead).toBeGreaterThan(before);
    expect(world.sim.stats.damage).toBeGreaterThan(0);
    // 崩壊が完了するまで回す → 対象の建物が死んでいる
    for (let i = 0; i < 600 && world.sim.collapsing.length; i++) { now += 16; step(world, 0.016, now); }
    expect(world.sim.collapsing.length).toBe(0);
    expect(target.state === B.Dead || target.state === B.Burning).toBe(true);

    // 戦術核
    detonateNuke(world, { x: 0, y: world.city.terrain.h(0, 0), z: 0 });
    for (let i = 0; i < 200; i++) { now += 16; step(world, 0.016, now); }
    expect(world.sim.stats.bDead).toBeGreaterThan(10);

    // 時間帯トグル
    applyTime(world, 'dusk');
    expect(world.settings.timeMode).toBe('dusk');

    // 再生成: シミュレーション状態がリセットされ、新しい街になる
    const oldBuildings = world.city.buildings;
    regenerate(world, 'CITY-00001');
    expect(world.city.buildings).not.toBe(oldBuildings);
    expect(world.sim.stats.bDead).toBe(0);
    expect(world.sim.stats.damage).toBe(0);
    expect(world.sim.missiles.length).toBe(0);
    expect(world.sim.stats.bTotal).toBe(world.city.buildings.length);
    for (const L of gfx.boomLights) expect(L.intensity).toBe(0);

    // 再生成後も普通に遊べる
    for (let i = 0; i < 10; i++) { now += 16; step(world, 0.016, now); }
    detonate(world, { x: 0, y: world.city.terrain.h(0, 0), z: 0 });
    for (let i = 0; i < 120; i++) { now += 16; step(world, 0.016, now); }
    expect(world.sim.stats.damage).toBeGreaterThanOrEqual(0);
  }, 60000);
});
