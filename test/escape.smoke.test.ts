// 逃走モードのnode+スタブ統合スモークテスト。
// enterEscape → 爆撃AIの予告 → 発射・着弾 → 被弾 → ゲームオーバー → リトライ/サンドボックス復帰
// の全経路を、game.smoke.test.tsと同じDOMスタブ流儀(+localStorage)で通す

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

// ---------- DOM/ブラウザAPIのスタブ ----------
/* eslint-disable @typescript-eslint/no-explicit-any */
const absorb: any = new Proxy(function () { /* absorb */ }, {
  get(_t, key) {
    if (key === Symbol.toPrimitive) return () => 0;
    return absorb;
  },
  set: () => true,
  apply: () => absorb,
});

function makeElementStub(): any {
  const children: any[] = [];
  const classes = new Set<string>();
  return {
    textContent: '', value: 'BAKUGEKI-01', offsetWidth: 0, width: 0, height: 0,
    style: {},
    classList: {
      add: (c: string) => classes.add(c),
      remove: (c: string) => classes.delete(c),
      toggle: (c: string, v?: boolean) => {
        if (v ?? !classes.has(c)) classes.add(c); else classes.delete(c);
      },
      contains: (c: string) => classes.has(c),
    },
    addEventListener() { /* noop */ },
    appendChild(c: any) { children.push(c); return c; },
    get firstChild() { return children[0] ?? null; },
    getContext: () => absorb,
  };
}

const elements = new Map<string, any>();
(globalThis as any).document = {
  documentElement: makeElementStub(),
  createElement: () => makeElementStub(),
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
const lsStore = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => lsStore.get(k) ?? null,
  setItem: (k: string, v: string) => lsStore.set(k, String(v)),
};
/* eslint-enable @typescript-eslint/no-explicit-any */

// スタブを立ててから本体モジュールを読み込む
const { ParticlePool } = await import('../src/render/particles');
const { FxPools } = await import('../src/render/fxPool');
const { makeLightPool } = await import('../src/render/lightPool');
const { mkSunRig } = await import('./helpers');
const { createWorld, regenerate } = await import('../src/game/world');
const { enterEscape, exitEscape, hitPlayer, updateEscapeFrame } =
  await import('../src/game/escapeMode');
const { updatePlayer, PLAYER_R } = await import('../src/game/player');
const { dangerRadius } = await import('../src/game/bomberAi');
const { pushOutOfRect } = await import('../src/core/collide');
const { detonate } = await import('../src/game/explosions');
const { requestStrike } = await import('../src/game/missiles');
const { stepSim } = await import('../src/game/loop');
const { B } = await import('../src/core/types');
import type { Gfx } from '../src/render/gfx';
import type { InputState } from '../src/ui/input';

// WebGLRendererなしの偽Gfx(game.smoke.test.tsと同じ)
function makeFakeGfx(): Gfx {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x8ec4f0);
  scene.fog = new THREE.Fog(0x8ec4f0, 1600, 9000);
  const hemi = new THREE.HemisphereLight(0xbdd5ee, 0x8a8578, 1);
  scene.add(hemi);
  const { sun, camera, sunShadow } = mkSunRig(scene);
  return {
    canvas: null as unknown as HTMLCanvasElement,
    quality: 'high',
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

function makeInput(): InputState {
  return {
    cam: { focus: new THREE.Vector3(), yaw: 0.7, pitch: 0.95, dist: 950 },
    keys: {}, move: { x: 0, y: 0 }, dash: false,
    zoomRange: { min: 40, max: 4200 },
  };
}

describe('逃走モード統合スモーク(nodeスタブ)', () => {
  it('開始 → 予告 → 着弾 → 被弾 → ゲームオーバー → リトライ/復帰が通る', () => {
    const gfx = makeFakeGfx();
    const world = createWorld(gfx, 'BAKUGEKI-01');
    const input = makeInput();
    let now = 0;
    // startLoopと同じ順で1フレーム進める
    const frame = (dt = 0.016): void => {
      now += dt * 1000;
      if (world.escape) updateEscapeFrame(world, input, dt, now);
      stepSim(world, dt, now);
    };

    // --- 開始: プレイヤーが陸上にスポーンし三人称カメラになる ---
    enterEscape(world, input);
    const esc = world.escape!;
    expect(esc).toBeTruthy();
    const { terrain } = world.city;
    expect(terrain.inWater(esc.player.x, esc.player.z)).toBe(false);
    expect(terrain.inMountain(esc.player.x, esc.player.z)).toBe(false);
    expect(input.cam.dist).toBeLessThanOrEqual(70);
    expect(world.sim.stats.bTotal).toBe(world.city.buildings.length);   // resetSim後も総数は張られる

    // --- 建物衝突: 建物の中心へ押し込んでも押し出される ---
    const b = world.city.buildings.find(x => x.state === B.Intact)!;
    esc.player.x = b.x; esc.player.z = b.z;
    updatePlayer(world, esc.player, input, 0.016);
    expect(pushOutOfRect(esc.player.x, esc.player.z, PLAYER_R - 0.01, b)).toBeNull();

    // --- 爆撃AI: 予告(警告円)が発生し、発射→着弾で予告が消える ---
    // 待機中にAIの爆撃が静止プレイヤーへ偶然直撃して先にゲームオーバーになると
    // 後段のHP検証が成り立たないため、待機ループでは無敵時間を張り続けて護る
    const waitFrames = (cond: () => boolean, max: number): void => {
      for (let i = 0; i < max && cond(); i++) {
        esc.lastHitT = world.sim.simT;   // 常に無敵(被弾フック自体は最後に個別検証する)
        frame();
      }
    };
    waitFrames(() => esc.strikes.length === 0, 250);
    expect(esc.strikes.length).toBeGreaterThan(0);
    const strike = esc.strikes[0];
    expect(strike.warnR).toBe(dangerRadius(strike.w));   // 警告円=武器の危険半径
    expect(strike.w.boom).not.toBe('nuke');              // 序盤に核は出ない
    expect(gfx.scene.children).toContain(strike.ringOuter);
    const impactT = strike.impactT;
    waitFrames(() => world.sim.simT < impactT + 0.1, 900);
    expect(world.sim.stats.mCount).toBeGreaterThan(0);            // 発射された
    expect(esc.strikes).not.toContain(strike);                    // 着弾で予告撤去
    expect(gfx.scene.children).not.toContain(strike.ringOuter);

    // --- 被弾: 至近距離の爆発で無敵時間を挟みつつHPが減り、直撃で死ぬ ---
    expect(esc.over).toBe(false);                 // 待機中の無敵が効いている
    esc.player.hp = 100;
    esc.lastHitT = -10;
    hitPlayer(world, { x: esc.player.x + 90, z: esc.player.z }, 105, false);
    expect(esc.player.hp).toBeLessThan(100);      // 外縁のかすり傷
    expect(esc.player.hp).toBeGreaterThan(0);
    const hpAfterGraze = esc.player.hp;
    hitPlayer(world, { x: esc.player.x, z: esc.player.z }, 105, false);
    expect(esc.player.hp).toBe(hpAfterGraze);     // 無敵時間内は連続被弾しない
    world.sim.simT += 1;                          // 無敵明けまで時計だけ進める(AIの介入なし)
    detonate(world, { x: esc.player.x, y: esc.player.y, z: esc.player.z }, 105);
    expect(esc.player.hp).toBe(0);                // 即死圏 → detonateフック経由で死亡
    expect(esc.over).toBe(true);
    expect(lsStore.get('bakugeki:escapeBest')).toBeDefined();   // ベスト記録が保存される

    // --- ゲームオーバー後: 生存時間が止まり、遅延して結果画面が出る ---
    const tAtDeath = esc.t;
    for (let i = 0; i < 100; i++) frame();
    expect(esc.t).toBe(tAtDeath);
    expect(esc.shown).toBe(true);

    // --- リトライ: 街を再生成して再入場(mainのregen相当) ---
    exitEscape(world, input);
    regenerate(world, world.seed);
    enterEscape(world, input);
    expect(world.escape!.player.hp).toBe(100);
    expect(world.escape!.t).toBe(0);
    expect(world.escape!.best).toBeGreaterThan(0);   // 前回の記録を読み込む
    expect(world.escape!.strikes.length).toBe(0);

    // --- サンドボックス復帰: 爆撃指定が普通に効く ---
    exitEscape(world, input);
    expect(world.escape).toBeNull();
    expect(input.cam.dist).toBe(950);
    gfx.camera.position.set(400, 600, 400);
    gfx.camera.lookAt(0, 0, 0);
    gfx.camera.updateMatrixWorld(true);
    requestStrike(world, 640, 360);
    expect(world.sim.missiles.length).toBe(1);
    for (let i = 0; i < 600 && world.sim.missiles.length; i++) frame();
    expect(world.sim.stats.damage).toBeGreaterThanOrEqual(0);
  }, 60000);
});
