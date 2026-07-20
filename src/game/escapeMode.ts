// 逃走モード: 地上のプレイヤーがAIの爆撃予告から逃げ回るサバイバル。
// world.escapeが非null=逃走モード中。stepSim(ミサイル・爆発・破壊)はサンドボックスと共通で、
// このモジュールはプレイヤー・爆撃AI・三人称カメラ・逃走HUDだけを担う

import * as THREE from 'three';
import { createPlayerAvatar, type PlayerAvatar } from '../render/playerMesh';
import { flashDamage, hideGameOver, loadBest, saveBest, showGameOver,
  updateEscapeHUD } from '../ui/escapeHud';
import { GOD_ZOOM, placeOrbitCamera, type InputState } from '../ui/input';
import { updateMinimap } from '../ui/minimap';
import { resetWarnings, updateWarnArrows } from '../ui/warnings';
import { clearStrikes, updateBomberAi, type PendingStrike } from './bomberAi';
import { explosionDamage, PLAYER_MAX_HP } from './damage';
import { createPlayer, updatePlayer, type PlayerState } from './player';
import { resetSim, type World } from './world';

const ESC_ZOOM = { min: 14, max: 70 };   // 三人称カメラのズーム範囲
const HIT_INVUL = 0.35;      // 被弾後の無敵時間(クラスターの同時多発ヒットで即溶けしない)
const REGEN_DELAY = 6;       // 最終被弾からHP回復が始まるまでの秒数
const REGEN_RATE = 5;        // HP回復速度(/s)
const GAMEOVER_DELAY = 1.2;  // 撃破から結果画面までの間(倒れて街が燃える画を見せる)

export interface EscapeState {
  player: PlayerState;
  avatar: PlayerAvatar;
  strikes: PendingStrike[];
  t: number;                 // 生存時間(ゲームオーバーで停止)
  best: number;
  nextStrikeT: number;
  nukeCooldownUntil: number;
  lastHitT: number;
  over: boolean;
  overT: number;             // 撃破からの経過(転倒演出・結果表示の遅延)
  shown: boolean;            // 結果画面を表示済みか
  newRecord: boolean;        // 今回の生存時間がベスト更新か(撃破時に確定)
}

export function enterEscape(world: World, input: InputState): void {
  resetSim(world);
  const player = createPlayer(world);
  world.escape = {
    player,
    avatar: createPlayerAvatar(world.gfx.scene),
    strikes: [],
    t: 0, best: loadBest(),
    nextStrikeT: 2.5,        // 開始直後に少しだけ猶予
    nukeCooldownUntil: 0, lastHitT: -10,
    over: false, overT: 0, shown: false, newRecord: false,
  };
  const { cam } = input;
  cam.pitch = 0.55;
  cam.dist = 26;
  cam.focus.set(player.x, player.y + 1.6, player.z);
  input.zoomRange.min = ESC_ZOOM.min;
  input.zoomRange.max = ESC_ZOOM.max;
  document.documentElement.classList.add('escape');
  hideGameOver();
  resetWarnings();
  updateEscapeHUD(player.hp, player.stamina, false, 0, world.escape.best);
}

export function exitEscape(world: World, input: InputState): void {
  const esc = world.escape;
  if (!esc) return;
  clearStrikes(world, esc);
  esc.avatar.dispose(world.gfx.scene);
  world.escape = null;
  resetSim(world);
  input.zoomRange.min = GOD_ZOOM.min;
  input.zoomRange.max = GOD_ZOOM.max;
  input.cam.pitch = 0.95;
  input.cam.dist = 950;      // 神視点へ復帰(注視点は現在地のまま)
  document.documentElement.classList.remove('escape');
  hideGameOver();
  resetWarnings();
}

// 爆発 → プレイヤーの被弾判定。explosions.tsのdetonate系から差し込まれる
// (サンドボックス中はescape==nullで即return)
export function hitPlayer(world: World, p: { x: number; z: number }, R: number,
    nuke: boolean): void {
  const esc = world.escape;
  if (!esc || esc.over) return;
  if (world.sim.simT - esc.lastHitT < HIT_INVUL) return;
  const pl = esc.player;
  const dmg = explosionDamage(Math.hypot(pl.x - p.x, pl.z - p.z), R, nuke);
  if (dmg <= 0) return;
  esc.lastHitT = world.sim.simT;
  pl.hp = Math.max(0, pl.hp - dmg);
  flashDamage();
  world.sim.shake += Math.min(20, dmg * 0.3);
  if (pl.hp <= 0) {
    esc.over = true;
    esc.newRecord = esc.t > esc.best;
    if (esc.newRecord) esc.best = esc.t;
    saveBest(esc.t);
  }
}

// 三人称カメラ。focusをプレイヤー頭上に置き、配置と揺れはplaceOrbitCameraを共用
// (クリアランス1.5m、至近距離のカメラなので揺れ幅は神視点の0.2倍)
function updateEscapeCamera(world: World, input: InputState, dt: number, now: number): void {
  const { cam } = input;
  const pl = world.escape!.player;
  cam.dist = THREE.MathUtils.clamp(cam.dist, ESC_ZOOM.min, ESC_ZOOM.max);
  cam.focus.set(pl.x, pl.y + 1.6, pl.z);
  world.gfx.sunShadow.update(cam);
  placeOrbitCamera(cam, world.city.terrain, world.gfx.camera, world.sim, dt, now, 1.5, 0.2);
}

// 逃走モードの1フレーム(startLoopがupdateCameraの代わりに呼ぶ。stepSimは別途共通で回る)
export function updateEscapeFrame(world: World, input: InputState, dt: number,
    now: number): void {
  const esc = world.escape!;
  const pl = esc.player;

  if (!esc.over) {
    esc.t += dt;
    updatePlayer(world, pl, input, dt);
    if (world.sim.simT - esc.lastHitT > REGEN_DELAY) {
      pl.hp = Math.min(PLAYER_MAX_HP, pl.hp + REGEN_RATE * dt);
    }
    esc.avatar.setPose(pl.x, pl.y, pl.z, pl.yaw, pl.animT, pl.speed01);
  } else {
    esc.overT += dt;
    esc.avatar.setDead(Math.min(1, esc.overT / 0.6));
    esc.avatar.setPose(pl.x, pl.y, pl.z, pl.yaw, 0, 0);
    if (esc.overT >= GAMEOVER_DELAY && !esc.shown) {
      esc.shown = true;
      showGameOver(esc.t, esc.best, esc.newRecord);
    }
  }

  updateBomberAi(world, esc);
  updateEscapeCamera(world, input, dt, now);
  updateEscapeHUD(pl.hp, pl.stamina, pl.exhausted, esc.t, esc.best);
  updateWarnArrows(world.gfx.camera, esc.strikes, world.sim.simT);
  updateMinimap(world, esc, dt);
}
