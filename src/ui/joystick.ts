// バーチャルジョイスティック(タッチ端末のみCSSで表示)。InputState.moveに移動ベクトルを書き込む
// 音声解禁はinput.tsのグローバルpointerupが一手に担うので、ここでは呼ばない

import { $ } from './hud';
import type { InputState } from './input';

const RADIUS = 40;   // ノブの可動半径(px)

export function wireJoystick(input: InputState): void {
  const stick = $('stick');
  const knob = $('stickKnob');
  let activeId = -1;   // 追跡中のポインタ(1本だけ)
  let cx = 0, cy = 0;  // スティック中心。ドラッグ中は動かないのでpointerdown時に1回だけ測る

  const apply = (dx: number, dy: number): void => {
    const len = Math.hypot(dx, dy);
    if (len > RADIUS) { dx *= RADIUS / len; dy *= RADIUS / len; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    input.move.x = dx / RADIUS;
    input.move.y = -dy / RADIUS;   // 画面の上方向=前進
  };

  stick.addEventListener('pointerdown', e => {
    if (activeId !== -1) return;
    activeId = e.pointerId;
    try { stick.setPointerCapture(e.pointerId); } catch { /* 既に解放済みのポインタ */ }
    const r = stick.getBoundingClientRect();
    cx = r.left + r.width / 2; cy = r.top + r.height / 2;
    apply(e.clientX - cx, e.clientY - cy);
  });
  stick.addEventListener('pointermove', e => {
    if (e.pointerId === activeId) apply(e.clientX - cx, e.clientY - cy);
  });
  const release = (e: PointerEvent): void => {
    if (e.pointerId !== activeId) return;
    activeId = -1;
    apply(0, 0);
  };
  stick.addEventListener('pointerup', release);
  stick.addEventListener('pointercancel', release);
  // キャプチャがOSやブラウザに横取りされてpointerup/cancelが届かない場合の保険。
  // 追跡中の指を見失ったらスティックを必ずニュートラルへ戻す(走りっぱなし防止)
  stick.addEventListener('lostpointercapture', release);

  // DASHボタン(逃走モード+タッチ端末のみCSSで表示)。押している間だけinput.dash
  const dashBtn = $('dashBtn');
  dashBtn.addEventListener('pointerdown', e => {
    input.dash = true;
    try { dashBtn.setPointerCapture(e.pointerId); } catch { /* 既に解放済みのポインタ */ }
  });
  const dashOff = (): void => { input.dash = false; };
  dashBtn.addEventListener('pointerup', dashOff);
  dashBtn.addEventListener('pointercancel', dashOff);
  dashBtn.addEventListener('lostpointercapture', dashOff);
}
