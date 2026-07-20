// 逃走モードのプレイヤー: スポーン地点探索と移動(接地・建物衝突・水の進入禁止)

import { pushOutOfRect } from '../core/collide';
import { clampToMap } from '../core/config';
import { euclideanModulo } from '../core/math';
import { B } from '../core/types';
import { combineMove, type InputState } from '../ui/input';
import { PLAYER_MAX_HP } from './damage';
import type { World } from './world';

export const PLAYER_R = 0.9;      // 衝突半径(m)
export const RUN_SPEED = 14;      // 走行速度(m/s)。単弾頭R=105を予告5秒で抜けられる調整
export const DASH_MULT = 2.0;     // ダッシュ倍率(スタミナ消費中のみ)
export const STAMINA_MAX = 100;
const STAMINA_DRAIN = 25;         // ダッシュ中の消費/s(満タンから4秒)
const STAMINA_REGEN = 14;         // 非ダッシュ時の回復/s(空から約7秒)
export const DASH_UNLOCK = 30;    // スタミナ切れ後、ここまで回復したら再ダッシュ可

export interface PlayerState {
  x: number; z: number; y: number;
  yaw: number;             // アバターの向き(移動方向へ滑らかに追従)
  vx: number; vz: number;  // 平滑化した実効速度。爆撃AIの偏差射撃が読む
  hp: number;
  stamina: number;         // 0..STAMINA_MAX
  exhausted: boolean;      // スタミナ切れ(DASH_UNLOCKまで回復するとダッシュ解禁)
  animT: number;           // 走りアニメの位相
  speed01: number;         // 現在速度/最高速度(アニメの振り幅用)
}

// スタミナの消費/回復とダッシュ可否(純ロジック。テスト対象)。
// 戻り値=このフレームにダッシュ速度が出るか。切れた直後に押しっぱなしでも
// ガクガクしないよう、DASH_UNLOCKまで回復するまではダッシュ不可のまま
export function updateStamina(p: PlayerState, wantDash: boolean, dt: number): boolean {
  if (p.exhausted && p.stamina >= DASH_UNLOCK) p.exhausted = false;
  const dashing = wantDash && !p.exhausted;
  if (dashing) {
    p.stamina = Math.max(0, p.stamina - STAMINA_DRAIN * dt);
    if (p.stamina <= 0) p.exhausted = true;
  } else {
    p.stamina = Math.min(STAMINA_MAX, p.stamina + STAMINA_REGEN * dt);
  }
  return dashing;
}

// スポーン地点: 都心からリング状に広げながら「水・山でなく建物に重ならない」点を探す。
// ゲームプレイの初期化なのでMath.randomでよい(街の生成には関与しない)
export function createPlayer(world: World): PlayerState {
  const { terrain } = world.city;
  const core = terrain.cityCore;
  let x = core.x, z = core.z;
  outer:
  for (let r = 0; r < 2200; r += 40) {
    const n = Math.max(1, Math.floor(r / 30));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const cx = clampToMap(core.x + Math.cos(a) * r), cz = clampToMap(core.z + Math.sin(a) * r);
      if (terrain.inWater(cx, cz) || terrain.inMountain(cx, cz)) continue;
      let blocked = false;
      world.index.buildings.forEachNear(cx, cz, 40, b => {
        if (!blocked && pushOutOfRect(cx, cz, PLAYER_R + 2, b)) blocked = true;
      });
      if (!blocked) { x = cx; z = cz; break outer; }
    }
  }
  return { x, z, y: terrain.h(x, z), yaw: 0, vx: 0, vz: 0, hp: PLAYER_MAX_HP,
    stamina: STAMINA_MAX, exhausted: false, animT: 0, speed01: 0 };
}

// 建物との衝突押し出し。角で複数の矩形に同時接触するため2パス回す
function resolveBuildings(world: World, p: { x: number; z: number }): void {
  for (let pass = 0; pass < 2; pass++) {
    let moved = false;
    world.index.buildings.forEachNear(p.x, p.z, 60, b => {
      if (b.state !== B.Intact && b.state !== B.Burning) return;   // 崩壊中/瓦礫は素通り
      const out = pushOutOfRect(p.x, p.z, PLAYER_R, b);
      if (out) { p.x = out.x; p.z = out.z; moved = true; }
    });
    if (!moved) break;
  }
}

export function updatePlayer(world: World, p: PlayerState, input: InputState, dt: number): void {
  const { terrain } = world.city;
  const { cam, keys } = input;
  const mv = combineMove(keys, input.move);
  // ダッシュ: Shift(PC) or DASHボタン(タッチ)。移動していない間はスタミナを消費しない
  const moving = mv.x !== 0 || mv.y !== 0;
  const wantDash = moving && !!(keys.ShiftLeft || keys.ShiftRight || input.dash);
  const dashing = updateStamina(p, wantDash, dt);
  const fwx = Math.sin(cam.yaw), fwz = Math.cos(cam.yaw);
  // カメラyaw基準でワールド方向へ(updateCameraの注視点移動と同じ座標系)
  const wx = fwz * mv.x - fwx * mv.y;
  const wz = -fwx * mv.x - fwz * mv.y;
  const ox = p.x, oz = p.z;
  const step = RUN_SPEED * (dashing ? DASH_MULT : 1) * dt;

  // 軸別に水の進入を判定して壁ずり移動(両軸まとめて弾くと岸沿いを歩けない)
  const nx = clampToMap(p.x + wx * step);
  if (!terrain.inWater(nx, p.z)) p.x = nx;
  const nz = clampToMap(p.z + wz * step);
  if (!terrain.inWater(p.x, nz)) p.z = nz;

  resolveBuildings(world, p);
  p.y = terrain.h(p.x, p.z);

  // 実効速度(押し出し・水キャンセル込み)を平滑化。偏差射撃と向き・アニメが読む
  const k = Math.min(1, dt * 6);
  p.vx += ((p.x - ox) / Math.max(1e-6, dt) - p.vx) * k;
  p.vz += ((p.z - oz) / Math.max(1e-6, dt) - p.vz) * k;
  const spd = Math.hypot(p.vx, p.vz);
  p.speed01 = Math.min(1, spd / (RUN_SPEED * DASH_MULT));
  if (spd > 1.5) {
    // 移動方向へ最短回転で向きを追従させる
    const d = euclideanModulo(Math.atan2(p.vx, p.vz) - p.yaw + Math.PI, Math.PI * 2) - Math.PI;
    p.yaw += d * Math.min(1, dt * 10);
  }
  p.animT += spd * dt * 0.62;   // 歩幅に合わせた腕脚の振り位相
}
