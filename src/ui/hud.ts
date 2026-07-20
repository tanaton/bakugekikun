// HUDのDOM操作(統計表示・ラベル・ヒント・核閃光)

import type { CityPlanKind } from '../core/types';
import type { HudStats } from '../game/simState';
import type { QualityMode } from '../render/gfx';
import type { TimeMode } from '../render/sky';

export const $ = (id: string): HTMLElement => document.getElementById(id)!;

// イベントの発生源がシード入力欄か(ゲーム操作のキー・右クリックと区別する共通ガード)
export const isInputTarget = (e: Event): boolean =>
  (e.target as HTMLElement).tagName === 'INPUT';

function yen(v: number): string {
  if (v >= 1e12) return '¥' + (v / 1e12).toFixed(2) + '兆';
  if (v >= 1e8) return '¥' + (v / 1e8).toFixed(1) + '億';
  if (v >= 1e4) return '¥' + Math.round(v / 1e4).toLocaleString() + '万';
  return '¥' + Math.round(v).toLocaleString();
}

const hudShown: Record<string, string> = {};   // 前回表示した文字列。変化した項目だけDOMを書き換える

// 変化したときだけtextContentを書き換える(毎フレーム呼ばれるHUD更新の共通機構)
export function setText(id: string, s: string): void {
  if (hudShown[id] === s) return;
  hudShown[id] = s;
  $(id).textContent = s;
}

function setHud(id: string, value: number, fmt?: (v: number) => string): void {
  setText(id, fmt ? fmt(value) : value.toLocaleString());
}

let dmgShown = 0;   // 被害総額のカウントアップ演出値(表示専用の状態なのでHUD側で持つ)

export function updateHUD(stats: HudStats): void {
  dmgShown += (stats.damage - dmgShown) * 0.08;
  if (stats.damage - dmgShown < 1e5) dmgShown = stats.damage;
  setHud('bDead', stats.bDead);
  setHud('bTotal', stats.bTotal);
  setHud('cDead', stats.cDead);
  setHud('cTotal', stats.cTotal);
  setHud('tDead', stats.tDead);
  setHud('tTotal', stats.tTotal);
  setHud('mCount', stats.mCount);
  setHud('dmgTotal', dmgShown, yen);
}

export function resetHUD(): void {
  dmgShown = 0;
}

export function setPlanName(plan: CityPlanKind): void {
  $('planName').textContent =
    '都市プラン: ' + ({ grid: '碁盤目', organic: '有機的街路', radial: '放射環状' } as const)[plan];
}

export function setPerf(fps: number): void {
  $('perf').textContent = `${fps} fps`;
}

export function hideHint(): void {
  $('hint').classList.add('gone');
}

export function setTimeLabel(mode: TimeMode): void {
  $('timeBtn').textContent = mode === 'day' ? '時間帯: 昼' : '時間帯: 夕暮れ';
}

export function setQualityLabel(mode: QualityMode): void {
  $('qualityBtn').textContent = { high: '画質: 高', mid: '画質: 中', low: '画質: 低' }[mode];
}

export function setSoundLabel(on: boolean): void {
  $('soundBtn').textContent = on ? 'SOUND: ON' : 'SOUND: OFF';
}

export function setWeaponLabel(label: string, hot: boolean): void {
  const btn = $('weaponBtn');
  btn.textContent = label;
  btn.style.color = hot ? 'var(--red)' : '';
  btn.style.borderColor = hot ? 'var(--red)' : '';
}

// 核爆発の全画面閃光
export function flashNuke(): void {
  const nf = $('nukeFlash');
  nf.style.transition = 'none';
  nf.style.opacity = '0.95';
  void nf.offsetWidth;
  nf.style.transition = 'opacity 2.4s ease-out';
  nf.style.opacity = '0';
}

export function resetNukeFlash(): void {
  const nf = $('nukeFlash');
  nf.style.transition = 'none';
  nf.style.opacity = '0';
}
