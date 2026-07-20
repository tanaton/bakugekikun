// 逃走モードのHUDミニマップ(右上)。地面テクスチャのcanvas(爆撃跡が焼き込まれた最新の絵)を
// 縮小表示し、警告円とプレイヤー位置を重ねる。map.ts(全画面マップ)と同じ座標系を使う。
// 2048→176pxの縮小は重いので下地キャッシュに持ち、地面が変わった(rev)ときだけやり直す

import { GROUND_TEX, GROUND_WORLD } from '../core/config';
import type { EscapeState } from '../game/escapeMode';
import type { World } from '../game/world';
import { $ } from './hud';
import { focusToMapPx } from './map';

const SIZE = 176;          // 実バッファpx(表示サイズはCSS)
const REDRAW_SEC = 0.15;   // 再描画間隔(フレーム駆動。setIntervalは使わない)

let g: CanvasRenderingContext2D | null = null;
let base: HTMLCanvasElement | null = null;   // 縮小済みの下地キャッシュ
let baseCtx: CanvasRenderingContext2D | null = null;
let baseOf: unknown = null;   // 下地を描いたGroundView(街の再生成で差し替わる)
let baseRev = -1;             // 下地に描いたground.rev
let acc = REDRAW_SEC;         // 初回は即描画

export function updateMinimap(world: World, esc: EscapeState, dt: number): void {
  acc += dt;
  if (acc < REDRAW_SEC) return;
  acc = 0;
  if (!g) {
    const canvas = $('miniMap') as HTMLCanvasElement;
    canvas.width = canvas.height = SIZE;
    g = canvas.getContext('2d')!;
    base = document.createElement('canvas');
    base.width = base.height = SIZE;
    baseCtx = base.getContext('2d')!;
  }
  const ground = world.view.ground;
  if (baseOf !== ground || baseRev !== ground.rev) {
    baseOf = ground;
    baseRev = ground.rev;
    baseCtx!.drawImage(ground.canvas, 0, 0, GROUND_TEX, GROUND_TEX, 0, 0, SIZE, SIZE);
  }
  g.drawImage(base!, 0, 0);

  // 警告円(危険半径の縁+半透明塗り+縮むタイマー円)
  const mScale = SIZE / GROUND_WORLD;   // ワールドm → ミニマップpx
  for (const s of esc.strikes) {
    const { px, py } = focusToMapPx(s.x, s.z, SIZE);
    const r = Math.max(2, s.warnR * mScale);
    g.fillStyle = 'rgba(255,40,30,0.25)';
    g.strokeStyle = s.w.boom === 'nuke' ? '#ffd23e' : '#ff3322';
    g.lineWidth = 1.5;
    g.beginPath(); g.arc(px, py, r, 0, Math.PI * 2); g.fill(); g.stroke();
    const remain = Math.max(0, s.impactT - world.sim.simT);
    g.beginPath(); g.arc(px, py, Math.max(1, r * remain / s.warnDur), 0, Math.PI * 2); g.stroke();
  }

  // プレイヤー(点+向きティック)
  const p = esc.player;
  const { px, py } = focusToMapPx(p.x, p.z, SIZE);
  g.fillStyle = '#ffffff';
  g.strokeStyle = '#ffb454';
  g.lineWidth = 1.5;
  g.beginPath(); g.arc(px, py, 3, 0, Math.PI * 2); g.fill(); g.stroke();
  g.beginPath();
  g.moveTo(px, py);
  g.lineTo(px + Math.sin(p.yaw) * 8, py + Math.cos(p.yaw) * 8);
  g.stroke();
}
