// カメラ操作(WASD/矢印移動・ドラッグ回転・ホイール/ピンチズーム)と右クリック/タップ爆撃指定

import * as THREE from 'three';
import { clampToMap } from '../core/config';
import type { Terrain } from '../core/terrain';
import type { SunShadow } from '../render/sky';
import { initAudio } from './audio';
import { createGestureTracker } from './gestures';

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
}

export function createInput(canvas: HTMLCanvasElement,
    onStrike: (px: number, py: number) => void): InputState {
  const cam: CamState = { focus: new THREE.Vector3(0, 0, 0), yaw: 0.7, pitch: 0.95, dist: 950 };
  const keys: Record<string, boolean> = {};
  const move = { x: 0, y: 0 };
  addEventListener('keydown', e => {
    if ((e.target as HTMLElement).tagName !== 'INPUT') keys[e.code] = true;
  });
  addEventListener('keyup', e => { keys[e.code] = false; });
  // フォーカスを失うとkeyupが届かず押しっぱなしになるため、全キーを解除する
  addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

  const rotate = (dx: number, dy: number): void => {
    cam.yaw -= dx * 0.005;
    cam.pitch = THREE.MathUtils.clamp(cam.pitch + dy * 0.004, 0.28, 1.5);
  };
  const zoomBy = (f: number): void => {
    cam.dist = THREE.MathUtils.clamp(cam.dist * f, 120, 4200);
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
    if ((e.target as HTMLElement).tagName === 'INPUT') {
      for (const k in keys) keys[k] = false;   // メニュー表示中に失われるkeyupの代わり
    } else {
      e.preventDefault();
    }
  });

  return { cam, keys, move };
}

// カメラの更新。shakeRefは残り揺れ量を持つオブジェクト(worldのsimが所有)
export function updateCamera(input: InputState, dt: number, terrain: Terrain,
    camera: THREE.PerspectiveCamera, sunShadow: SunShadow, sim: { shake: number }): void {
  const { cam, keys, move } = input;
  const sp = cam.dist * 0.9 * dt * (keys.ShiftLeft || keys.ShiftRight ? 2.4 : 1);
  const fwx = Math.sin(cam.yaw), fwz = Math.cos(cam.yaw);
  // キーボード(WASD/矢印)とジョイスティックを合成。長さ1超は正規化して斜めも等速にする
  const kx = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
  const ky = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0);
  let mx = kx + move.x, my = ky + move.y;
  if (mx !== 0 || my !== 0) {
    const mlen = Math.hypot(mx, my);
    if (mlen > 1) { mx /= mlen; my /= mlen; }
    cam.focus.x += (fwz * mx - fwx * my) * sp;
    cam.focus.z += (-fwx * mx - fwz * my) * sp;
  }
  cam.focus.x = clampToMap(cam.focus.x);
  cam.focus.z = clampToMap(cam.focus.z);
  cam.focus.y = terrain.h(cam.focus.x, cam.focus.z);   // 注視点は地形に追従
  sunShadow.update(cam);                               // 影カメラも注視点に追従

  const cp = Math.cos(cam.pitch), sinP = Math.sin(cam.pitch);
  camera.position.set(
    cam.focus.x + fwx * cp * cam.dist,
    cam.focus.y + sinP * cam.dist,
    cam.focus.z + fwz * cp * cam.dist);
  const minY = terrain.h(camera.position.x, camera.position.z) + 12;  // 山にめり込まない
  if (camera.position.y < minY) camera.position.y = minY;
  camera.lookAt(cam.focus);
  sim.shake = Math.min(sim.shake, 36);
  if (sim.shake > 0.001) {
    const t = performance.now() * 0.05;
    camera.position.x += Math.sin(t * 1.3) * sim.shake;
    camera.position.y += Math.sin(t * 1.7 + 2) * sim.shake * 0.6;
    camera.position.z += Math.cos(t * 1.1) * sim.shake;
    sim.shake *= Math.exp(-4.5 * dt);
  }
}
