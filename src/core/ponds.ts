// 公園の池。地形の水域フィーチャ(terrain)とは独立した、テクスチャ描画のみの小さな水域。
// 揺らぐ岸線の定義をここに集約し、2D地面描画と内外判定(爆撃跡の抑制・植栽除け)で共用する

import { shoreWigAt } from './math';
import type { Vec2 } from './types';

// e/rotは細長い池の伸長率と長軸の向き(省略時は丸池)。
// ひょうたん池は重なり合う2つのPondの合併として表す(inPondが自然に合併判定になる)
export interface Pond { x: number; z: number; r: number; wig: number; ph: number; e?: number; rot?: number }

// 池の岸帯(陸側の砂色の帯)の張り出し幅(m)。湾のBANK_INSETより小さい(池は半径が小さい)
export const POND_BANK_INSET = 5;

// 角度aにおける岸線の半径(湾・川と共通の揺らぎ × 楕円の伸長)
export const pondEdgeR = (p: Pond, a: number): number =>
  (p.r - shoreWigAt(p.wig, p.ph, a))
  * (1 + (p.e ?? 0) * Math.cos(2 * (a - (p.rot ?? 0))));

// 岸線半径の上界(内外判定の早期棄却・地形フィーチャとの重なり判定用)
export const pondMaxR = (p: Pond): number => p.r * (1 + (p.e ?? 0));
// 岸線半径の下界(揺らぎと楕円の最小側。「完全に水面内」の保守的判定用)
export const pondMinR = (p: Pond): number => (p.r - p.wig) * (1 - (p.e ?? 0));

// 円(中心x,z・半径r)がいずれかの池の水面に完全に収まるか。
// 爆撃跡の抑制に使う: 池に収まる小さな爆発は水が呑み込み跡を残さないが、
// 池からはみ出す爆発(核など)は池ごと焼き払うので跡を描く
export function pondSwallows(ponds: readonly Pond[], x: number, z: number, r: number): boolean {
  for (const p of ponds) {
    const lim = pondMinR(p) - r;
    if (lim < 0) continue;
    const dx = x - p.x, dz = z - p.z;
    if (dx * dx + dz * dz <= lim * lim) return true;
  }
  return false;
}

// 揺らぐ岸線の点列(insetは陸側への張り出し量。岸帯は+POND_BANK_INSET、水面は0)
export function pondPts(p: Pond, inset: number): Vec2[] {
  const pts: Vec2[] = [];
  for (let i = 0; i < 40; i++) {
    const a = i / 40 * Math.PI * 2, rr = pondEdgeR(p, a) + inset;
    pts.push({ x: p.x + Math.cos(a) * rr, z: p.z + Math.sin(a) * rr });
  }
  return pts;
}

// 点がいずれかの池の中か(padは岸からの余白。植栽除けなどに正で使う)
export function inPond(ponds: readonly Pond[], x: number, z: number, pad = 0): boolean {
  for (const p of ponds) {
    const dx = x - p.x, dz = z - p.z, d2 = dx * dx + dz * dz;
    const rMax = pondMaxR(p) + pad;
    if (d2 > rMax * rMax) continue;   // 揺らぎ計算前の早期棄却
    if (Math.sqrt(d2) < pondEdgeR(p, Math.atan2(dz, dx)) + pad) return true;
  }
  return false;
}
