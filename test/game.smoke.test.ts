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
const { mkSunRig } = await import('./helpers');
const { applyTime, createWorld, regenerate } = await import('../src/game/world');
const { detonate, detonateNuke } = await import('../src/game/explosions');
const { requestStrike } = await import('../src/game/missiles');
const { stepSim } = await import('../src/game/loop');
const { B } = await import('../src/core/types');
const { GROUND_TEX } = await import('../src/core/config');
const { FLUSH_FULL_RATIO } = await import('../src/render/ground');
import type { Gfx } from '../src/render/gfx';

// WebGLRendererなしの偽Gfx(それ以外は本物)
function makeFakeGfx(): Gfx {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x8ec4f0);
  scene.fog = new THREE.Fog(0x8ec4f0, 1600, 9000);
  const hemi = new THREE.HemisphereLight(0xbdd5ee, 0x8a8578, 1);
  scene.add(hemi);
  const { sun, camera, sunShadow } = mkSunRig(scene);
  return {
    canvas: null as unknown as HTMLCanvasElement,
    renderer: null as unknown as THREE.WebGLRenderer,
    scene, camera, hemi, sun,
    sunShadow,
    fireP: new ParticlePool(5200, THREE.AdditiveBlending, scene),
    smokeP: new ParticlePool(4600, THREE.NormalBlending, scene),
    boomLights: makeLightPool(scene, 6, 0xffa050, 1000),
    nukeLights: makeLightPool(scene, 2, 0xffe2b0, 3400),
    fx: new FxPools(scene),
  };
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

    // 幹はインスタンス色(紅葉)を無視する: パッチ後の頂点シェーダーに乗算行がなく、
    // チャンクの展開自体は行われている(置換の空振り検出)
    const trunkMat = (world.view.treeChunks[0].material as THREE.Material[])[0];
    const sh = { vertexShader: THREE.ShaderLib.lambert.vertexShader };
    trunkMat.onBeforeCompile(sh as never, null as never);
    expect(sh.vertexShader).not.toContain('instanceColor');
    expect(sh.vertexShader).not.toContain('#include <color_vertex>');
    expect(sh.vertexShader).toContain('vColor = vec4( 1.0 );');

    // カメラを構えて数フレーム回す(平常時)
    gfx.camera.position.set(400, 600, 400);
    gfx.camera.lookAt(0, 0, 0);
    gfx.camera.updateMatrixWorld(true);   // ブラウザではrenderer.renderが行う行列更新
    let now = 0;
    for (let i = 0; i < 10; i++) { now += 16; stepSim(world, 0.016, now); }

    // 画面中央へ爆撃指定 → ミサイルが生まれる
    requestStrike(world, 640, 360);
    expect(world.sim.missiles.length).toBe(1);
    expect(world.sim.stats.mCount).toBe(1);

    // 着弾まで進める(最長10秒ぶん)
    for (let i = 0; i < 600 && world.sim.missiles.length; i++) { now += 16; stepSim(world, 0.016, now); }
    expect(world.sim.missiles.length).toBe(0);

    // 建物密集地の中心に直接起爆して破壊を確認
    const target = world.city.buildings[Math.floor(world.city.buildings.length / 2)];
    const before = world.sim.stats.bDead;
    detonate(world, { x: target.x, y: target.gy, z: target.z }, 105);
    expect(world.sim.stats.bDead).toBeGreaterThan(before);
    expect(world.sim.stats.damage).toBeGreaterThan(0);
    // 崩壊が完了するまで回す → 対象の建物が死んでいる
    for (let i = 0; i < 600 && world.sim.collapsing.length; i++) { now += 16; stepSim(world, 0.016, now); }
    expect(world.sim.collapsing.length).toBe(0);
    expect(target.state === B.Dead || target.state === B.Burning).toBe(true);

    // 戦術核
    detonateNuke(world, { x: 0, y: world.city.terrain.h(0, 0), z: 0 });
    for (let i = 0; i < 200; i++) { now += 16; stepSim(world, 0.016, now); }
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
    for (let i = 0; i < 10; i++) { now += 16; stepSim(world, 0.016, now); }
    detonate(world, { x: 0, y: world.city.terrain.h(0, 0), z: 0 });
    for (let i = 0; i < 120; i++) { now += 16; stepSim(world, 0.016, now); }
    expect(world.sim.stats.damage).toBeGreaterThanOrEqual(0);
  }, 60000);

  it('GPU転送が生存車両の範囲と地面のダーティ矩形に絞られる', () => {
    const gfx = makeFakeGfx();
    const world = createWorld(gfx, 'BAKUGEKI-02');
    gfx.camera.position.set(400, 600, 400);
    gfx.camera.lookAt(0, 0, 0);
    gfx.camera.updateMatrixWorld(true);
    let now = 0;

    // 車: 全車生存なら走行車両の全域を転送し、全滅後は転送予約自体が出ない
    const carAttr = world.view.carMesh.instanceMatrix;
    carAttr.clearUpdateRanges();
    now += 16; stepSim(world, 0.016, now);
    expect(carAttr.updateRanges.pop()).toEqual({ start: 0, count: world.city.movingCars * 16 });
    for (let i = 0; i < world.city.movingCars; i++) world.city.cars[i].alive = false;
    carAttr.clearUpdateRanges();
    now += 16; stepSim(world, 0.016, now);
    expect(carAttr.updateRanges).toEqual([]);

    // 地面: 破壊跡のフラッシュはダーティ矩形の部分コピーで、全量転送の面積しきい値未満
    const copies: { box: THREE.Box2; pos: THREE.Vector2 }[] = [];
    gfx.renderer = {
      copyTextureToTexture: (_s: unknown, _d: unknown, box: THREE.Box2, pos: THREE.Vector2) => {
        copies.push({ box: box.clone(), pos: pos.clone() });
      },
    } as unknown as THREE.WebGLRenderer;
    const b = world.city.buildings[0];   // 陸上が保証された座標(水中は跡を残さない)
    detonate(world, { x: b.x, y: b.gy, z: b.z }, 105);
    now += 200; stepSim(world, 0.2, now);   // flushの間引き(0.15s)を跨いで焼き込ませる
    expect(copies.length).toBe(1);
    const { box, pos } = copies[0];
    const w = box.max.x - box.min.x, h = box.max.y - box.min.y;
    expect(w).toBeGreaterThan(0);
    expect(h).toBeGreaterThan(0);
    expect(w * h).toBeLessThan(GROUND_TEX * GROUND_TEX * FLUSH_FULL_RATIO);
    expect(pos.x).toBe(box.min.x);
    expect(pos.y).toBe(box.min.y);
  }, 60000);
});
