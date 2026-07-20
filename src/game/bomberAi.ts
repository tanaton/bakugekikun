// 逃走モードの爆撃AI: 目標選定(偏差射撃+退路潰し)→ 予告(地面の警告円)→ 発射 → 着弾。
// 飛翔・爆発・破壊は既存のミサイル/爆発システムをそのまま使う

import * as THREE from 'three';
import { clampToMap, WATER_SURFACE_Y } from '../core/config';
import { euclideanModulo } from '../core/math';
import { playAlarm } from '../ui/audio';
import { warnToast } from '../ui/warnings';
import { difficultyAt, NUKE_COOLDOWN, NUKE_WARN_BONUS, type Difficulty } from './difficulty';
import { flightTime, launchStrike } from './missiles';
import { NUKE_R, WEAPONS, type Weapon } from './weapons';
import type { EscapeState } from './escapeMode';
import type { World } from './world';

const NUKE_OFF_MIN = 240, NUKE_OFF_MAX = 400;   // 核は予測点から必ずこの距離だけずらす

// 警告円の危険半径。クラスターは散布半径+子弾爆発半径(親弾は分裂して着弾しない)
export function dangerRadius(w: Weapon): number {
  if (w.boom === 'nuke') return NUKE_R;
  return w.split ? w.split.rMax + w.split.boom : w.boom;
}

// 着弾目標の選定(純関数。randを注入してテストする)。
// 60%は偏差射撃(移動先を予測+散布誤差)、40%はプレイヤー周囲への退路潰し。
// 難易度進行(t)で予測が鋭く・散布が狭くなる。核は直上に置くと理不尽なので必ずオフセット
export function pickTarget(px: number, pz: number, vx: number, vz: number,
    warnT: number, t: number, nuke: boolean,
    rand: () => number = Math.random): { x: number; z: number } {
  const prog = Math.min(1, t / 480);
  if (nuke) {
    const fx = px + vx * warnT * 0.7, fz = pz + vz * warnT * 0.7;
    const a = rand() * Math.PI * 2, off = NUKE_OFF_MIN + rand() * (NUKE_OFF_MAX - NUKE_OFF_MIN);
    return { x: clampToMap(fx + Math.cos(a) * off), z: clampToMap(fz + Math.sin(a) * off) };
  }
  if (rand() < 0.6) {
    const lead = 0.5 + 0.4 * prog;
    const scatter = (150 - 110 * prog) * rand();
    const a = rand() * Math.PI * 2;
    return { x: clampToMap(px + vx * warnT * lead + Math.cos(a) * scatter),
             z: clampToMap(pz + vz * warnT * lead + Math.sin(a) * scatter) };
  }
  const a = rand() * Math.PI * 2, rr = 60 + rand() * 240;
  return { x: clampToMap(px + Math.cos(a) * rr), z: clampToMap(pz + Math.sin(a) * rr) };
}

// 武器の重み抽選(純関数)。核がクールダウン中は核の重みを単弾頭へ振り替える
export function pickWeapon(diff: Difficulty, nukeAllowed: boolean,
    rand: () => number = Math.random): Weapon {
  const wNuke = nukeAllowed ? diff.wNuke : 0;
  const r = rand();
  if (r < wNuke) return WEAPONS[2];
  if (r < wNuke + diff.wCluster) return WEAPONS[1];
  return WEAPONS[0];
}

export interface PendingStrike {
  x: number; z: number; gy: number;
  w: Weapon;
  warnR: number;              // 危険半径(警告円の外周)
  impactT: number;            // 着弾予定時刻(sim.simT基準)
  warnDur: number;            // 予告の全長(タイマーリングの縮小率に使う)
  launched: boolean;
  ringOuter: THREE.Mesh;      // 危険範囲の外周リング(点滅)
  ringTimer: THREE.Mesh;      // 残り時間で縮むリング
}

// 警告リングのマテリアル(全strikeで共有、点滅は同位相)。missiles.tsのmarkerMatsと同じ思想
let outerMat: THREE.MeshBasicMaterial | null = null;
let timerMat: THREE.MeshBasicMaterial | null = null;
function ringMats(): { outer: THREE.MeshBasicMaterial; timer: THREE.MeshBasicMaterial } {
  outerMat ??= new THREE.MeshBasicMaterial({
    color: 0xff2020, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide });
  timerMat ??= new THREE.MeshBasicMaterial({
    color: 0xff7a30, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide });
  return { outer: outerMat, timer: timerMat };
}

function spawnRing(world: World, mat: THREE.MeshBasicMaterial,
    x: number, y: number, z: number, scale: number): THREE.Mesh {
  const ring = new THREE.Mesh(world.gfx.fx.ringGeo, mat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(x, y, z);
  ring.scale.set(scale, scale, 1);
  world.gfx.scene.add(ring);
  return ring;
}

function removeStrike(world: World, s: PendingStrike): void {
  world.gfx.scene.remove(s.ringOuter);
  world.gfx.scene.remove(s.ringTimer);
}

export function clearStrikes(world: World, esc: EscapeState): void {
  for (const s of esc.strikes) removeStrike(world, s);
  esc.strikes.length = 0;
}

// 8方位の名前(トースト用)。マップ座標系は +x=東, -z=北
export function dirName(dx: number, dz: number): string {
  const a = Math.atan2(dx, -dz);   // 0=北, 時計回り
  const i = euclideanModulo(Math.round(a / (Math.PI / 4)), 8);
  return ['北', '北東', '東', '南東', '南', '南西', '西', '北西'][i];
}

export function updateBomberAi(world: World, esc: EscapeState): void {
  const { sim, city } = world;
  const pl = esc.player;

  // --- 新規予告(ゲームオーバー後は撃ち止め。飛翔中・予告済みはそのまま進行)。
  // 難易度計算は予告タイミングでだけ行う(毎フレームのテーブル補間+確保を避ける) ---
  if (!esc.over && sim.simT >= esc.nextStrikeT) {
    const diff = difficultyAt(esc.t);
    if (esc.strikes.length >= diff.maxConcurrent) {
      esc.nextStrikeT = sim.simT + 0.25;   // 上限中は少し置いて再判定
    } else {
      const nukeAllowed = sim.simT >= esc.nukeCooldownUntil;
      const w = pickWeapon(diff, nukeAllowed);
      const nuke = w.boom === 'nuke';
      const warnDur = diff.warnT + (nuke ? NUKE_WARN_BONUS : 0);
      const t = pickTarget(pl.x, pl.z, pl.vx, pl.vz, warnDur, esc.t, nuke);
      const gy = city.terrain.h(t.x, t.z);
      const warnR = dangerRadius(w);
      const y = Math.max(gy, WATER_SURFACE_Y) + 2.5;
      const { outer, timer } = ringMats();
      esc.strikes.push({
        x: t.x, z: t.z, gy, w, warnR,
        impactT: sim.simT + warnDur, warnDur, launched: false,
        ringOuter: spawnRing(world, outer, t.x, y, t.z, warnR),
        ringTimer: spawnRing(world, timer, t.x, y + 0.5, t.z, warnR),
      });
      if (nuke) esc.nukeCooldownUntil = sim.simT + NUKE_COOLDOWN;
      esc.nextStrikeT = sim.simT + diff.interval;
      const dist = Math.round(Math.hypot(t.x - pl.x, t.z - pl.z));
      warnToast(nuke
        ? `☢ 戦術核投下警報: ${dirName(t.x - pl.x, t.z - pl.z)} ${dist}m`
        : `⚠ 爆撃警報: ${dirName(t.x - pl.x, t.z - pl.z)} ${dist}m`, nuke);
      playAlarm(nuke);
    }
  }

  // --- 予告中のstrikeの進行(点滅・タイマーリング縮小・発射・着弾で撤去) ---
  if (outerMat) outerMat.opacity = 0.5 + 0.4 * Math.sin(sim.simT * 12);
  for (let i = esc.strikes.length - 1; i >= 0; i--) {
    const s = esc.strikes[i];
    const remain = s.impactT - sim.simT;
    if (remain <= 0) {
      removeStrike(world, s);
      esc.strikes.splice(i, 1);
      continue;
    }
    const sc = Math.max(2, s.warnR * remain / s.warnDur);
    s.ringTimer.scale.set(sc, sc, 1);
    if (!s.launched && remain <= flightTime(s.w)) {
      launchStrike(world, new THREE.Vector3(s.x, s.gy, s.z), s.w, false);
      s.launched = true;
    }
  }
}
