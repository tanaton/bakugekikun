// THREE.Color 相当の純粋カラー演算(ColorManagement無効時の挙動を再現)。
// 生成結果の色はcore層で確定させ、render層は値をそのまま流し込むだけにする。

import { clamp, euclideanModulo } from './math';
import { pick, type Rng } from './rng';

export interface RGB { r: number; g: number; b: number }

export const hexToRgb = (hex: number): RGB => ({
  r: (hex >> 16 & 255) / 255,
  g: (hex >> 8 & 255) / 255,
  b: (hex & 255) / 255,
});

function hue2rgb(p: number, q: number, t: number): number {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * 6 * (2 / 3 - t);
  return p;
}

// THREE.Color#offsetHSL と同一の変換(getHSL → 加算 → setHSL。s/lは[0,1]にクランプ)
export function offsetHSL(c: RGB, dh: number, ds: number, dl: number): RGB {
  const { r, g, b } = c;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (min + max) / 2;
  if (min !== max) {
    const d = max - min;
    s = l <= 0.5 ? d / (max + min) : d / (2 - max - min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4;
    }
    h /= 6;
  }
  h = euclideanModulo(h + dh, 1);
  s = clamp(s + ds, 0, 1);
  const l2 = clamp(l + dl, 0, 1);
  if (s === 0) return { r: l2, g: l2, b: l2 };
  const q = l2 <= 0.5 ? l2 * (1 + s) : l2 + s - l2 * s;
  const p = 2 * l2 - q;
  return { r: hue2rgb(p, q, h + 1 / 3), g: hue2rgb(p, q, h), b: hue2rgb(p, q, h - 1 / 3) };
}

// パレットから1色選び、色相dh・明度dlの幅でジッタをかける(dh=0なら色相のrngは消費しない)
export function palColor(pal: readonly number[], rng: Rng, dh: number, dl: number): RGB {
  return offsetHSL(hexToRgb(pick(pal, rng)), dh ? (rng() - 0.5) * dh : 0, 0, (rng() - 0.5) * dl);
}
