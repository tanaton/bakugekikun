// THREE.MathUtils 相当の小道具(core層はthreeをimportしない)

import type { Vec2 } from './types';

export const clamp = (v: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, v));

// 区画ローカル座標(回転rot)→世界座標。符号は地面描画の g.rotate(-rot) と一致させる
export function lotToWorld(cx: number, cz: number, rot: number, lx: number, lz: number): Vec2 {
  const c = Math.cos(rot), s = Math.sin(rot);
  return { x: cx + lx * c + lz * s, z: cz - lx * s + lz * c };
}

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

// 円形水域の岸線の揺らぎ(角度→張り出し量)。湾・川(terrain)と公園の池(ponds)が
// 同じ形の定義を共有する(片方だけ調整すると水辺の見た目が食い違うため)
export const shoreWigAt = (wig: number, ph: number, a: number): number =>
  wig * (0.5 + 0.5 * Math.sin(a * 3 + ph));

export const euclideanModulo = (n: number, m: number): number => ((n % m) + m) % m;

// smoothstep補間付きバイリニア格子サンプラ(地形グリッドと街路ワープ場で共用)
export function gridSample(gr: ArrayLike<number>, N: number, u: number, v: number): number {
  u = clamp(u, 0, N - 1.001);
  v = clamp(v, 0, N - 1.001);
  const x0 = Math.floor(u), z0 = Math.floor(v);
  let fx = u - x0, fz = v - z0;
  fx = fx * fx * (3 - 2 * fx); fz = fz * fz * (3 - 2 * fz);
  const i = z0 * N + x0;
  const a = gr[i], b = gr[i + 1], c = gr[i + N], d = gr[i + N + 1];
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}
