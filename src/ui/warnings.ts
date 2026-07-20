// 爆撃予告の画面端方向インジケータ(視界外の着弾点への矢印)と警報トースト

import * as THREE from 'three';
import type { PendingStrike } from '../game/bomberAi';
import { $ } from './hud';

// 矢印プール数。difficulty.tsのmaxConcurrent最大値(6)より余裕を持たせている。
// 難易度テーブルを増強して同時予告がこれを超えると、超過分の矢印は出ない
const MAX_ARROWS = 8;
const EDGE = 0.88;   // 矢印を貼り付ける画面端(NDC)。これより内側に見えていれば矢印は不要

// 前回書いた値を持ち、変化したときだけDOMへ書く(hud.tsの差分更新方針と同じ。
// 毎フレーム×8要素の無差別書き込みを避ける)
interface Arrow {
  el: HTMLElement; tri: HTMLElement; dist: HTMLElement;
  shown: boolean; pos: string; rot: string; nuke: boolean; op: string; txt: string;
}
let arrows: Arrow[] | null = null;

function pool(): Arrow[] {
  if (!arrows) {
    const wrap = $('warnArrows');
    arrows = [];
    for (let i = 0; i < MAX_ARROWS; i++) {
      const el = document.createElement('div');
      el.className = 'arr';
      const tri = document.createElement('span');
      tri.className = 'tri';
      tri.textContent = '▲';
      const dist = document.createElement('span');
      dist.className = 'dist';
      el.appendChild(tri);
      el.appendChild(dist);
      wrap.appendChild(el);
      arrows.push({ el, tri, dist, shown: false, pos: '', rot: '', nuke: false, op: '', txt: '' });
    }
  }
  return arrows;
}

function hideArrow(a: Arrow): void {
  if (!a.shown) return;
  a.shown = false;
  a.el.style.display = 'none';
}

const _v = new THREE.Vector3();

// 各strikeの着弾点を画面へ投影し、視界外なら画面端に方向矢印を出す
export function updateWarnArrows(camera: THREE.PerspectiveCamera,
    strikes: readonly PendingStrike[], simT: number): void {
  const arr = pool();
  const w = innerWidth, h = innerHeight;
  for (let i = 0; i < MAX_ARROWS; i++) {
    const a = arr[i];
    const s = strikes[i];
    if (!s) { hideArrow(a); continue; }
    // ビュー空間を経由して投影する(projectだと行列適用が二重になる)。
    // カメラ背後は透視除算で座標が反転するため、ビュー空間のzで判定して向きを立て直す
    _v.set(s.x, s.gy, s.z).applyMatrix4(camera.matrixWorldInverse);
    const behind = _v.z > 0;
    _v.applyMatrix4(camera.projectionMatrix);   // 透視除算込みでNDCになる
    let nx = _v.x, ny = _v.y;
    if (behind) { nx = -nx; ny = -ny; }
    if (!behind && Math.abs(nx) < EDGE && Math.abs(ny) < EDGE && _v.z < 1) {
      hideArrow(a);   // 画面内に見えている(地面の警告円に任せる)
      continue;
    }
    // 画面中央からの方向を保ったまま矩形の端へクランプ
    const k = EDGE / Math.max(Math.abs(nx), Math.abs(ny), 1e-6);
    const ex = nx * k, ey = ny * k;
    const pos = `translate(${((ex * 0.5 + 0.5) * w).toFixed(0)}px, ${((-ey * 0.5 + 0.5) * h).toFixed(0)}px)`;
    const rot = `translate(-50%,-50%) rotate(${(Math.atan2(ex, ey) * 180 / Math.PI).toFixed(0)}deg)`;
    const remain = Math.max(0, s.impactT - simT);
    const op = remain < 1.2 ? '1' : '0.75';   // 着弾間際は強調
    const txt = Math.round(remain * 10) / 10 + 's';
    const nuke = s.w.boom === 'nuke';
    if (!a.shown) { a.shown = true; a.el.style.display = 'block'; }
    if (a.pos !== pos) { a.pos = pos; a.el.style.transform = pos; }
    if (a.rot !== rot) { a.rot = rot; a.tri.style.transform = rot; }
    if (a.nuke !== nuke) { a.nuke = nuke; a.el.classList.toggle('nuke', nuke); }
    if (a.op !== op) { a.op = op; a.el.style.opacity = op; }
    if (a.txt !== txt) { a.txt = txt; a.dist.textContent = txt; }
  }
}

// 警報トースト。CSSアニメ1回分を再発火させる(タイマー状態を持たない)
export function warnToast(msg: string, nuke: boolean): void {
  const el = $('warnToast');
  el.textContent = msg;
  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.toggle('nuke', nuke);
  el.classList.add('show');
}

export function resetWarnings(): void {
  if (arrows) for (const a of arrows) hideArrow(a);
  $('warnToast').classList.remove('show');
}
