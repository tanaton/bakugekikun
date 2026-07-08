// 処理時間プロファイラ (Pキーで表示切替)。
// pt(name)をループ内の各処理の直後に置き、直前のチェックポイントからの経過を区間名に積算する。
// 表示OFF中は即returnするので計測オーバーヘッドはほぼゼロ。

import type * as THREE from 'three';
import { $ } from './hud';

let profOn = false;
const profSum = new Map<string, number>();
let profMark = 0;

export const isProfilerOn = (): boolean => profOn;

export function ptBegin(): void {
  if (profOn) profMark = performance.now();
}

export function pt(name: string): void {
  if (!profOn) return;
  const t = performance.now();
  profSum.set(name, (profSum.get(name) || 0) + (t - profMark));
  profMark = t;
}

export function profShow(renderer: THREE.WebGLRenderer, frames: number): void {
  const rows = [...profSum].sort((a, b) => b[1] - a[1]);
  let js = 0;
  for (const r of rows) js += r[1];
  const lines = rows.map(([k, v]) => k.padEnd(10) + (v / frames).toFixed(2).padStart(6) + 'ms');
  lines.push('-'.repeat(18));
  lines.push('js total'.padEnd(10) + (js / frames).toFixed(2).padStart(6) + 'ms');
  const info = renderer.info.render;
  lines.push(`draw:${info.calls}  tri:${Math.round(info.triangles / 1000)}k`);
  $('prof').textContent = lines.join('\n');
  profSum.clear();
}

export function wireProfilerKey(): void {
  addEventListener('keydown', e => {
    if (e.code !== 'KeyP' || (e.target as HTMLElement).tagName === 'INPUT') return;
    profOn = !profOn;
    profSum.clear();
    $('prof').style.display = profOn ? 'block' : 'none';
  });
}
