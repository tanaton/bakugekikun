// 逃走モードのHUD(HPバー・生存時間・ベスト記録・被弾ビネット・ゲームオーバー画面)

import { clamp } from '../core/math';
import { $, setText } from './hud';

const BEST_KEY = 'bakugeki:escapeBest';

// localStorageはプライベートモード等で例外を投げるためtry/catchで包む(記録は必須機能ではない)
export function loadBest(): number {
  try {
    return parseFloat(localStorage.getItem(BEST_KEY) ?? '0') || 0;
  } catch { return 0; }
}

export function saveBest(t: number): void {
  try {
    if (t > loadBest()) localStorage.setItem(BEST_KEY, String(t));
  } catch { /* 保存できなくてもゲームは続行 */ }
}

// 生存時間の表示形式 "分:秒.1桁"(純関数。テスト対象)
export function fmtTime(t: number): string {
  const m = Math.floor(t / 60);
  return `${m}:${(t - m * 60).toFixed(1).padStart(4, '0')}`;
}

// 毎フレーム呼ばれるため、hud.tsの差分更新方針に合わせて変化時だけDOMへ書く。
// バーの幅は0.1%刻みに量子化してから前回値と比較する
const shownNum: Record<string, number> = {};
const shownColor: Record<string, string> = {};
function setBar(id: string, pct: number, color: string): void {
  const q = Math.round(clamp(pct, 0, 100) * 10);
  if (shownNum[id] !== q) {
    shownNum[id] = q;
    $(id).style.width = q / 10 + '%';
  }
  if (shownColor[id] !== color) {
    shownColor[id] = color;
    $(id).style.background = color;
  }
}

export function updateEscapeHUD(hp: number, stamina: number, exhausted: boolean,
    t: number, best: number): void {
  // 表示は0.1秒刻みなので、量子化した数値が動いたときだけ文字列を組む
  const tq = Math.floor(t * 10);
  if (shownNum.t !== tq) { shownNum.t = tq; setText('survT', fmtTime(tq / 10)); }
  const bq = Math.floor(best * 10);
  if (shownNum.b !== bq) { shownNum.b = bq; setText('bestT', 'BEST ' + fmtTime(bq / 10)); }
  const pct = clamp(hp, 0, 100);
  setBar('hpFill', pct, pct > 50 ? '#7dd87d' : pct > 25 ? '#ffb454' : '#ff5533');
  setBar('stFill', stamina, exhausted ? '#ff5533' : '#5ab8e8');
  const low = pct > 0 && pct < 30 ? 1 : 0;
  if (shownNum.low !== low) {
    shownNum.low = low;
    $('dmgVignette').classList.toggle('low', low === 1);
  }
}

// 被弾の赤ビネット(flashNukeと同じ「transition切ってから戻す」再発火パターン)
export function flashDamage(): void {
  const v = $('dmgVignette');
  v.style.transition = 'none';
  v.style.opacity = '0.85';
  void v.offsetWidth;
  v.style.transition = 'opacity 0.9s ease-out';
  v.style.opacity = '';   // 空に戻す(.lowの脈動アニメを妨げない)
}

export function showGameOver(t: number, best: number, isNew: boolean): void {
  $('goTime').textContent = '生存時間 ' + fmtTime(t);
  $('goBest').textContent = 'ベスト ' + fmtTime(best);
  $('goNew').style.display = isNew ? 'block' : 'none';
  $('gameOver').classList.add('open');
}

export function hideGameOver(): void {
  $('gameOver').classList.remove('open');
  const v = $('dmgVignette');
  v.classList.remove('low');
  v.style.transition = 'none';
  v.style.opacity = '';
}

export function setModeLabel(escape: boolean): void {
  $('modeBtn').textContent = escape ? 'モード: 逃走 🏃' : 'モード: 爆撃';
}
