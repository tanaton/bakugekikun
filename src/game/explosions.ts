// 爆発の演出システム(通常爆発・二次爆発・戦術核・汎用メッシュエフェクト)

import * as THREE from 'three';
import type { FxMesh } from '../render/fxPool';
import { decayLights, fireLight } from '../render/lightPool';
import { flashNuke } from '../ui/hud';
import { playBoom, playNuke, playPop } from '../ui/audio';
import { destroyAround } from './destruction';
import type { World } from './world';

function addFx(world: World, mesh: FxMesh, life: number,
    update: (mesh: FxMesh, k: number) => void): void {
  world.gfx.scene.add(mesh);
  world.sim.fx.push({ mesh, life, age: 0, update });
}

// 拡大しながらフェードする球エフェクト: s = base + k^exp * grow(高さはys倍、riseで上昇)
function growFx(world: World, mesh: FxMesh, x: number, y: number, z: number,
    life: number, base: number, grow: number, exp: number, op0: number, ys = 1, rise = 0): void {
  mesh.position.set(x, y, z);
  addFx(world, mesh, life, (o, k) => {
    const s = base + Math.pow(k, exp) * grow;
    o.scale.set(s, s * ys, s);
    if (rise) o.position.y = y + k * rise;
    o.material.opacity = op0 * (1 - k);
  });
}

// 地面に伏せて拡大するリングエフェクト
function ringFx(world: World, mesh: FxMesh, x: number, y: number, z: number,
    life: number, base: number, grow: number, exp: number, op0: number): void {
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(x, y, z);
  addFx(world, mesh, life, (o, k) => {
    const s = base + Math.pow(k, exp) * grow;
    o.scale.set(s, s, 1);
    o.material.opacity = op0 * (1 - k);
  });
}

export function updateFx(world: World, dt: number): void {
  const fx = world.sim.fx;
  for (let i = fx.length - 1; i >= 0; i--) {
    const f = fx[i];
    f.age += dt;
    if (f.age >= f.life) {
      world.gfx.fx.release(f.mesh);
      fx.splice(i, 1);
      continue;
    }
    f.update(f.mesh, f.age / f.life);
  }
}

export function updateBoomLights(world: World, dt: number): void {
  decayLights(world.gfx.boomLights, dt, 0.9, false);
  decayLights(world.gfx.nukeLights, dt, 4, true);
}

const flashLight = (world: World, x: number, z: number, peak: number, gy = 0): void =>
  fireLight(world.gfx.boomLights, x, gy + 60, z, peak);

const _pv = new THREE.Vector3();

// 演出の規模係数の基準半径。R=R_REFのとき等倍で、子弾など小半径ほど縮む
const R_REF = 105;

export function detonate(world: World, p: { x: number; y: number; z: number }, R: number): void {
  const { gfx, sim, city, view, debris } = world;
  const FX = gfx.fx;
  const f = R / R_REF;               // 規模係数(クラスター子弾は小さめ)
  const sf = 0.55 + 0.45 * f;        // サイズ・速度の縮尺
  const gy = p.y;
  flashLight(world, p.x, p.z, 7 * f, gy);
  // --- 閃光 ---
  growFx(world, FX.sphereAdd(0xfff7e0, 1), p.x, gy + 10, p.z, 0.25, 12 * f, 300 * f, 1, 1);
  // --- 火球(白熱コア + 外炎の二層) ---
  growFx(world, FX.sphereAdd(0xffd07a, 1), p.x, gy + 8, p.z, 0.6, 6 * f, 70 * f, 0.4, 1, 1.3);
  growFx(world, FX.sphereAdd(0xff5a1c, 0.9), p.x, gy + 6, p.z, 1.0, 8 * f, 130 * f, 0.45, 0.9, 1.2, 45 * f);
  // --- 衝撃波リング(発光 + 土埃の二重) ---
  ringFx(world, FX.ringAddD(0xffd9a8, 0.95), p.x, gy + 2.5, p.z, 0.7, 8 * f, 420 * f, 0.55, 0.95);
  ringFx(world, FX.ringD(0x8a7458, 0.5), p.x, gy + 1.8, p.z, 1.5, 12 * f, 520 * f, 0.6, 0.5);
  // --- クレーターと焦げ跡を地面テクスチャへ焼き込む(水中はGroundView側が弾く) ---
  view.ground.pushCrater(p.x, p.z, R * 0.7);
  view.ground.pushStamp({ kind: 'scorch', x: p.x, z: p.z, r: R * 1.6 });
  // --- 火球パーティクル(白核 → 橙 → 深紅の三層) ---
  const cnt = (n: number): number => Math.max(4, Math.round(n * f));
  for (let i = 0; i < cnt(45); i++) {
    const a = Math.random() * Math.PI * 2, sp = Math.random() * 50 * sf;
    const fp = gfx.fireP.spawn(p.x, gy + 6, p.z, 1, 0.93, 0.72);
    fp.gy = gy;
    fp.vx = Math.cos(a) * sp; fp.vy = (60 + Math.random() * 120) * sf; fp.vz = Math.sin(a) * sp;
    fp.life = 0.35 + Math.random() * 0.3; fp.size = (20 + Math.random() * 18) * sf; fp.drag = 1.2;
  }
  for (let i = 0; i < cnt(150); i++) {
    const a = Math.random() * Math.PI * 2, up = Math.random();
    const sp = (30 + Math.random() * 140) * sf;
    const fp = gfx.fireP.spawn(p.x, gy + 5, p.z, 1, 0.45 + Math.random() * 0.25, 0.1);
    fp.gy = gy;
    fp.vx = Math.cos(a) * sp * (1 - up * 0.5); fp.vy = (40 + up * 200) * sf;
    fp.vz = Math.sin(a) * sp * (1 - up * 0.5);
    fp.life = 0.6 + Math.random() * 0.8; fp.size = (14 + Math.random() * 16) * sf;
    fp.drag = 1.0; fp.growth = 1.2;
  }
  for (let i = 0; i < cnt(90); i++) {
    const a = Math.random() * Math.PI * 2, rr = Math.random() * 25 * f;
    const fp = gfx.fireP.spawn(p.x + Math.cos(a) * rr, gy + 8, p.z + Math.sin(a) * rr, 0.85, 0.22, 0.06);
    fp.gy = gy;
    fp.vx = Math.cos(a) * 18; fp.vy = (70 + Math.random() * 130) * sf; fp.vz = Math.sin(a) * 18;
    fp.life = 1.0 + Math.random() * 0.9; fp.size = (18 + Math.random() * 20) * sf;
    fp.drag = 1.4; fp.growth = 1.6;
  }
  // --- 火の粉スパーク ---
  for (let i = 0; i < cnt(160); i++) {
    const a = Math.random() * Math.PI * 2, up = Math.random();
    const sp = (60 + Math.random() * 220) * sf;
    const fp = gfx.fireP.spawn(p.x, gy + 4, p.z, 1, 0.6 + Math.random() * 0.3, 0.18);
    fp.gy = gy;
    fp.vx = Math.cos(a) * sp * (1 - up * 0.6); fp.vy = (60 + up * 260) * sf;
    fp.vz = Math.sin(a) * sp * (1 - up * 0.6);
    fp.life = 0.9 + Math.random() * 1.6; fp.size = 3.5 + Math.random() * 5;
    fp.grav = 220; fp.drag = 0.5;
  }
  // --- 3D瓦礫 ---
  for (let i = 0; i < cnt(55); i++)
    debris.spawn(city.terrain, p.x + (Math.random() - 0.5) * 14, gy + 4 + Math.random() * 10,
      p.z + (Math.random() - 0.5) * 14, (130 + Math.random() * 130) * sf);
  // --- 地を這う土煙 ---
  for (let i = 0; i < cnt(70); i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = (55 + Math.random() * 110) * sf;
    const sm = gfx.smokeP.spawn(p.x + Math.cos(a) * 18 * f, gy + 2 + Math.random() * 6,
      p.z + Math.sin(a) * 18 * f, 0.4, 0.35, 0.29);
    sm.gy = gy;
    sm.vx = Math.cos(a) * sp; sm.vy = 4 + Math.random() * 10; sm.vz = Math.sin(a) * sp;
    sm.life = 1.6 + Math.random() * 1.6; sm.size = (20 + Math.random() * 22) * sf;
    sm.growth = 2.6; sm.drag = 1.1; sm.fadeIn = 0.1; sm.baseAlpha = 0.55;
  }
  // --- 煙柱(きのこ雲) ---
  for (let i = 0; i < cnt(85); i++) {
    const a = Math.random() * Math.PI * 2, rr = Math.random() * R * 0.4;
    const sm = gfx.smokeP.spawn(p.x + Math.cos(a) * rr, gy + 6 + Math.random() * 26,
      p.z + Math.sin(a) * rr, 0.2, 0.185, 0.18);
    sm.gy = gy;
    sm.vx = Math.cos(a) * 10; sm.vy = (34 + Math.random() * 62) * sf; sm.vz = Math.sin(a) * 10;
    sm.life = 4 + Math.random() * 3.5; sm.size = (30 + Math.random() * 36) * sf;
    sm.growth = 2.6; sm.drag = 0.3; sm.fadeIn = 0.3; sm.baseAlpha = 0.66;
  }
  // --- 二次爆発の予約(大型弾のみ) ---
  if (f > 0.75) {
    const n2 = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n2; i++) {
      const a = Math.random() * Math.PI * 2, rr = 30 + Math.random() * R * 1.1;
      sim.delayedBooms.push({ t: sim.simT + 0.15 + Math.random() * 0.9,
        x: p.x + Math.cos(a) * rr, z: p.z + Math.sin(a) * rr });
    }
  }

  destroyAround(world, p, R);
  const dc = gfx.camera.position.distanceTo(_pv.set(p.x, gy, p.z));
  sim.shake += Math.min(26, 9000 / Math.max(220, dc)) * f;
  playBoom(dc / f);
}

// 二次爆発(小型・時間差で誘爆する)
export function miniBoom(world: World, d: { x: number; z: number }): void {
  const { gfx, city, debris } = world;
  if (city.terrain.inWater(d.x, d.z)) return;   // 水面下からは誘爆させない(着弾同様、水は跡も演出も残さない)
  const gy = city.terrain.h(d.x, d.z);
  flashLight(world, d.x, d.z, 3.5, gy);
  growFx(world, gfx.fx.sphereAdd(0xff7a30, 0.95), d.x, gy + 6, d.z, 0.5, 4, 42, 0.5, 0.95, 1.2);
  for (let i = 0; i < 45; i++) {
    const a = Math.random() * Math.PI * 2, sp = 25 + Math.random() * 90;
    const fp = gfx.fireP.spawn(d.x, gy + 4, d.z, 1, 0.5 + Math.random() * 0.3, 0.12);
    fp.gy = gy;
    fp.vx = Math.cos(a) * sp; fp.vy = 50 + Math.random() * 140; fp.vz = Math.sin(a) * sp;
    fp.life = 0.5 + Math.random() * 0.8; fp.size = 8 + Math.random() * 12;
    fp.grav = 120; fp.drag = 0.8;
  }
  for (let i = 0; i < 14; i++) debris.spawn(city.terrain, d.x, gy + 3, d.z, 70 + Math.random() * 80);
  for (let i = 0; i < 12; i++) {
    const a = Math.random() * Math.PI * 2;
    const sm = gfx.smokeP.spawn(d.x, gy + 5, d.z, 0.22, 0.2, 0.19);
    sm.gy = gy;
    sm.vx = Math.cos(a) * 20; sm.vy = 22 + Math.random() * 30; sm.vz = Math.sin(a) * 20;
    sm.life = 2.5 + Math.random() * 2; sm.size = 18 + Math.random() * 18;
    sm.growth = 2.2; sm.drag = 0.4; sm.fadeIn = 0.2; sm.baseAlpha = 0.55;
  }
  destroyAround(world, d, 26);
  world.sim.shake += 1.2;
  playPop();
}

// キノコ雲を数秒かけて生成し続ける
export function updateNukeEmitters(world: World, dt: number): void {
  const { sim, gfx } = world;
  for (let i = sim.nukeEmitters.length - 1; i >= 0; i--) {
    const e = sim.nukeEmitters[i];
    e.t += dt;
    if (e.t >= e.dur) { sim.nukeEmitters.splice(i, 1); continue; }
    const k = e.t / e.dur;
    // 柱(ステム): 熱で吸い上げられる土煙
    const nStem = e.t < e.dur * 0.7 ? 3 : 1;
    for (let j = 0; j < nStem; j++) {
      const a = Math.random() * Math.PI * 2, rr = Math.random() * 55;
      const sm = gfx.smokeP.spawn(e.x + Math.cos(a) * rr, e.gy + 10 + Math.random() * 90,
        e.z + Math.sin(a) * rr, 0.34 + Math.random() * 0.06, 0.29, 0.25);
      sm.gy = e.gy;
      sm.vx = Math.cos(a) * 6; sm.vy = 95 + Math.random() * 85; sm.vz = Math.sin(a) * 6;
      sm.life = 5 + Math.random() * 3; sm.size = 42 + Math.random() * 40;
      sm.growth = 1.8; sm.drag = 0.12; sm.fadeIn = 0.3; sm.baseAlpha = 0.7;
    }
    // 傘(キャップ): 上空でドーナツ状に広がる
    for (let j = 0; j < 2; j++) {
      const a = Math.random() * Math.PI * 2, rr = 40 + Math.random() * 90 + k * 140;
      const sm = gfx.smokeP.spawn(e.x + Math.cos(a) * rr, e.gy + 430 + Math.random() * 130,
        e.z + Math.sin(a) * rr, 0.3, 0.27, 0.25);
      sm.gy = e.gy;
      sm.vx = Math.cos(a) * (26 + k * 12); sm.vy = 12 + Math.random() * 22; sm.vz = Math.sin(a) * (26 + k * 12);
      sm.life = 6 + Math.random() * 4; sm.size = 62 + Math.random() * 55;
      sm.growth = 1.5; sm.drag = 0.25; sm.fadeIn = 0.5; sm.baseAlpha = 0.62;
    }
    // 内部の発光(最初の3秒は雲が中から焼ける)
    if (e.t < 3) {
      const gh = e.gy + 80 + Math.random() * 380 * Math.min(1, e.t / 2);
      const fp = gfx.fireP.spawn(e.x + (Math.random() - 0.5) * 70, gh,
        e.z + (Math.random() - 0.5) * 70, 1, 0.5, 0.16);
      fp.gy = e.gy;
      fp.vy = 40 + Math.random() * 50;
      fp.life = 0.5 + Math.random() * 0.4; fp.size = 30 + Math.random() * 40; fp.baseAlpha = 0.55;
    }
  }
}

export function detonateNuke(world: World, p: { x: number; y: number; z: number }): void {
  const { gfx, sim, city, view, debris } = world;
  const FX = gfx.fx;
  const R = 420;                     // 全壊半径
  const gy = p.y;
  // --- 画面全体が白く飛ぶ ---
  flashNuke();
  // --- 巨大な光源(街全体が照らされる) ---
  fireLight(gfx.nukeLights, p.x, gy + 220, p.z, 18);
  flashLight(world, p.x, p.z, 10, gy);
  // --- 白熱コア ---
  growFx(world, FX.sphereAdd(0xfffbee, 1), p.x, gy + 40, p.z, 1.2, 20, 190, 0.4, 1);
  // --- 上昇する大火球(白 → 橙 → 赤黒) ---
  const fbC1 = new THREE.Color(0xffe6a0), fbC2 = new THREE.Color(0xff3c08);
  const fb = FX.sphereAdd(0xffe6a0, 0.95);
  fb.position.set(p.x, gy + 40, p.z);
  addFx(world, fb, 4.5, (o, k) => {
    const s = 40 + Math.pow(k, 0.5) * 260;
    o.scale.set(s, s * 1.1, s);
    o.position.y = gy + 40 + k * 320;
    o.material.color.copy(fbC1).lerp(fbC2, Math.min(1, k * 1.6));
    o.material.opacity = 0.95 * (1 - k * k);
  });
  // --- 衝撃波ドーム ---
  growFx(world, FX.sphereAddD(0xfff2d8, 0.5), p.x, gy, p.z, 1.4, 30, 720, 0.6, 0.5, 0.7);
  // --- 地表の二重リング ---
  ringFx(world, FX.ringAddD(0xffd9a8, 1), p.x, gy + 3, p.z, 2, 20, 1500, 0.55, 1);
  ringFx(world, FX.ringD(0x8a7458, 0.6), p.x, gy + 2, p.z, 3.5, 30, 1900, 0.6, 0.6);
  // --- 上空の凝結リング(ウィルソン雲) ---
  ringFx(world, FX.ringD(0xf0f4f8, 0.55), p.x, gy + 260, p.z, 2.2, 80, 850, 0.7, 0.55);
  // --- 巨大な焦げ跡と舗装の破壊跡を地面テクスチャへ焼き込む(水中はGroundView側が弾く) ---
  view.ground.pushCrater(p.x, p.z, R * 0.7);
  view.ground.pushStamp({ kind: 'nuke', x: p.x, z: p.z, r: R * 1.3 });
  // --- 土煙・スパーク・瓦礫 ---
  for (let i = 0; i < 150; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 130 + Math.random() * 240;
    const sm = gfx.smokeP.spawn(p.x + Math.cos(a) * 40, gy + 3 + Math.random() * 12,
      p.z + Math.sin(a) * 40, 0.42, 0.37, 0.3);
    sm.gy = gy;
    sm.vx = Math.cos(a) * sp; sm.vy = 6 + Math.random() * 16; sm.vz = Math.sin(a) * sp;
    sm.life = 2.2 + Math.random() * 2.2; sm.size = 30 + Math.random() * 30;
    sm.growth = 2.6; sm.drag = 0.9; sm.fadeIn = 0.1; sm.baseAlpha = 0.6;
  }
  for (let i = 0; i < 250; i++) {
    const a = Math.random() * Math.PI * 2, up = Math.random();
    const sp = 120 + Math.random() * 420;
    const fp = gfx.fireP.spawn(p.x, gy + 6, p.z, 1, 0.62 + Math.random() * 0.3, 0.2);
    fp.gy = gy;
    fp.vx = Math.cos(a) * sp * (1 - up * 0.6); fp.vy = 80 + up * 380;
    fp.vz = Math.sin(a) * sp * (1 - up * 0.6);
    fp.life = 1.2 + Math.random() * 2; fp.size = 4 + Math.random() * 7;
    fp.grav = 200; fp.drag = 0.4;
  }
  for (let i = 0; i < 120; i++)
    debris.spawn(city.terrain, p.x + (Math.random() - 0.5) * 60, gy + 5 + Math.random() * 20,
      p.z + (Math.random() - 0.5) * 60, 200 + Math.random() * 220);
  // --- キノコ雲(9秒かけて成長) ---
  sim.nukeEmitters.push({ x: p.x, z: p.z, gy, t: 0, dur: 9 });
  // --- 二次爆発の嵐 ---
  for (let i = 0; i < 10; i++) {
    const a = Math.random() * Math.PI * 2, rr = 80 + Math.random() * R * 1.3;
    sim.delayedBooms.push({ t: sim.simT + 0.3 + Math.random() * 2.8,
      x: p.x + Math.cos(a) * rr, z: p.z + Math.sin(a) * rr });
  }
  // --- 破壊: 衝撃波の速度で外側へ波及 ---
  destroyAround(world, p, R, 0, 300);
  const dc = gfx.camera.position.distanceTo(_pv.set(p.x, gy, p.z));
  sim.shake += Math.min(40, 26000 / Math.max(300, dc));
  playNuke(dc);
}
