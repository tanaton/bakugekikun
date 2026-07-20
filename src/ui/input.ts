// カメラ操作(WASD/矢印移動・ドラッグ回転・ホイール/ピンチズーム)と右クリック/タップ爆撃指定

import * as THREE from 'three';
import { clampToMap } from '../core/config';
import type { Terrain } from '../core/terrain';
import type { SunShadow } from '../render/sky';
import { initAudio } from './audio';
import { createGestureTracker } from './gestures';
import { isInputTarget } from './hud';

export interface CamState {
  focus: THREE.Vector3;
  yaw: number;
  pitch: number;
  dist: number;
}

export interface InputState {
  cam: CamState;
  keys: Record<string, boolean>;
  move: { x: number; y: number };   // ジョイスティック等のアナログ移動入力(x=右, y=前、長さ1以下)
  dash: boolean;                    // タッチのDASHボタン押下(PCのShiftと同じ扱い)
  zoomRange: { min: number; max: number };   // ホイール/ピンチのズーム範囲(モードで差し替える)
}

// 神視点(サンドボックス)のズーム範囲。逃走モードはescapeMode側が三人称用に差し替える
export const GOD_ZOOM = { min: 40, max: 4200 } as const;

// キーボード(WASD/矢印)とジョイスティックの合成(長さ1超は正規化して斜めも等速)。
// 神視点のカメラ移動と逃走モードのプレイヤー移動で共用
export function combineMove(keys: Record<string, boolean>,
    move: { x: number; y: number }): { x: number; y: number } {
  const kx = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
  const ky = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0);
  let mx = kx + move.x, my = ky + move.y;
  const mlen = Math.hypot(mx, my);
  if (mlen > 1) { mx /= mlen; my /= mlen; }
  return { x: mx, y: my };
}

export function createInput(canvas: HTMLCanvasElement,
    onStrike: (px: number, py: number) => void): InputState {
  const cam: CamState = { focus: new THREE.Vector3(0, 0, 0), yaw: 0.7, pitch: 0.95, dist: 950 };
  const keys: Record<string, boolean> = {};
  const move = { x: 0, y: 0 };
  const zoomRange = { min: GOD_ZOOM.min, max: GOD_ZOOM.max };
  const state: InputState = { cam, keys, move, dash: false, zoomRange };
  const releaseAll = (): void => { for (const k in keys) keys[k] = false; };
  addEventListener('keydown', e => {
    // IME(日本語入力)が変換を横取りするとkeydownがkeyCode 229/isComposingになり、
    // 対応するkeyupが届かず押しっぱなしになる。変換扱いのキーは移動に使わず、
    // その時点で押下中の全キーも解除する(IMEがONのまま遊び始めた場合の保険)
    if (e.isComposing || e.keyCode === 229) {
      releaseAll();
      return;
    }
    if (!isInputTarget(e)) keys[e.code] = true;
  });
  addEventListener('keyup', e => { keys[e.code] = false; });
  // フォーカスを失うとkeyupが届かず押しっぱなしになるため、全キーを解除する。
  // タブ切り替え(blurが発火しない環境がある)も同様
  addEventListener('blur', releaseAll);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) releaseAll();
  });

  const rotate = (dx: number, dy: number): void => {
    cam.yaw -= dx * 0.005;
    cam.pitch = THREE.MathUtils.clamp(cam.pitch + dy * 0.004, 0.28, 1.5);
  };
  const zoomBy = (f: number): void => {
    cam.dist = THREE.MathUtils.clamp(cam.dist * f, zoomRange.min, zoomRange.max);
  };

  // タッチはマウスと違いタップ(=爆撃)/ドラッグ/ピンチの判別が要るので状態機械に通す。
  // タッチのpointerdownもbutton===0なので、マウス分岐より先に振り分ける
  let dragging = false, lastX = 0, lastY = 0;
  const touch = createGestureTracker();
  canvas.addEventListener('pointerdown', e => {
    if (e.pointerType === 'touch') {
      canvas.setPointerCapture(e.pointerId);
      touch.down(e.pointerId, e.clientX, e.clientY, e.timeStamp);
    } else {
      if (e.button === 0) { dragging = true; lastX = e.clientX; lastY = e.clientY; canvas.setPointerCapture(e.pointerId); }
      if (e.button === 2) { onStrike(e.clientX, e.clientY); }
    }
    initAudio();
  });
  addEventListener('pointerup', e => {
    if (e.pointerType === 'touch'
        && touch.up(e.pointerId, e.clientX, e.clientY, e.timeStamp)) {
      onStrike(e.clientX, e.clientY);   // タップ=爆撃
    }
    dragging = false;
    // モバイルブラウザはtouchend/click相当のジェスチャーでしか音声を解禁しない
    // (pointerdownでのresumeは拒否される)ため、指を離すたびにも試みる
    initAudio();
  });
  // OSのジェスチャー横取り等で発生。タッチでは必須(放置すると指が残った扱いになる)
  addEventListener('pointercancel', e => {
    touch.cancel(e.pointerId);
    dragging = false;
  });
  addEventListener('pointermove', e => {
    if (e.pointerType === 'touch') {
      const g = touch.move(e.pointerId, e.clientX, e.clientY);
      if (g?.kind === 'rotate') rotate(g.dx, g.dy);
      else if (g?.kind === 'pinch') zoomBy(1 / g.scale);   // 指を開く=寄る
      return;
    }
    if (!dragging) return;
    rotate(e.clientX - lastX, e.clientY - lastY);
    lastX = e.clientX; lastY = e.clientY;
  });
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    zoomBy(Math.exp(e.deltaY * 0.0011));
  }, { passive: false });
  // コンテキストメニューは全画面で抑止する(シード入力欄だけ貼り付け等のため例外)。
  // canvas限定だと、マップオーバーレイやHUDパネル上の右クリックでメニューが開き、
  // 押していた移動キーのkeyupがページに届かず移動しっぱなしになる(メニューはblurも発火させない)
  addEventListener('contextmenu', e => {
    if (isInputTarget(e)) {
      for (const k in keys) keys[k] = false;   // メニュー表示中に失われるkeyupの代わり
    } else {
      e.preventDefault();
    }
  });

  return state;
}

// yaw/pitch/distの球面座標でfocusを注視するカメラを配置し、地形めり込み防止と
// 画面揺れの適用・減衰を行う。神視点(updateCamera)と逃走モードの三人称で共用。
// minClear=地形からの最低クリアランス(m)、shakeScale=揺れ幅係数(至近カメラは小さく)
export function placeOrbitCamera(cam: CamState, terrain: Terrain,
    camera: THREE.PerspectiveCamera, sim: { shake: number }, dt: number, now: number,
    minClear: number, shakeScale: number): void {
  const fwx = Math.sin(cam.yaw), fwz = Math.cos(cam.yaw);
  const cp = Math.cos(cam.pitch), sinP = Math.sin(cam.pitch);
  camera.position.set(
    cam.focus.x + fwx * cp * cam.dist,
    cam.focus.y + sinP * cam.dist,
    cam.focus.z + fwz * cp * cam.dist);
  const minY = terrain.h(camera.position.x, camera.position.z) + minClear;
  if (camera.position.y < minY) camera.position.y = minY;
  camera.lookAt(cam.focus);
  sim.shake = Math.min(sim.shake, 36);
  if (sim.shake > 0.001) {
    const t = now * 0.05, k = sim.shake * shakeScale;
    camera.position.x += Math.sin(t * 1.3) * k;
    camera.position.y += Math.sin(t * 1.7 + 2) * k * 0.6;
    camera.position.z += Math.cos(t * 1.1) * k;
    sim.shake *= Math.exp(-4.5 * dt);
  }
}

// カメラの更新。shakeRefは残り揺れ量を持つオブジェクト(worldのsimが所有)
export function updateCamera(input: InputState, dt: number, terrain: Terrain,
    camera: THREE.PerspectiveCamera, sunShadow: SunShadow, sim: { shake: number }): void {
  const { cam, keys, move } = input;
  const sp = cam.dist * 0.9 * dt * (keys.ShiftLeft || keys.ShiftRight ? 2.4 : 1);
  const fwx = Math.sin(cam.yaw), fwz = Math.cos(cam.yaw);
  const { x: mx, y: my } = combineMove(keys, move);
  if (mx !== 0 || my !== 0) {
    cam.focus.x += (fwz * mx - fwx * my) * sp;
    cam.focus.z += (-fwx * mx - fwz * my) * sp;
  }
  cam.focus.x = clampToMap(cam.focus.x);
  cam.focus.z = clampToMap(cam.focus.z);
  cam.focus.y = terrain.h(cam.focus.x, cam.focus.z);   // 注視点は地形に追従
  sunShadow.update(cam);                               // 影カメラも注視点に追従
  placeOrbitCamera(cam, terrain, camera, sim, dt, performance.now(), 12, 1);
}
