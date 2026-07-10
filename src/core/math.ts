// THREE.MathUtils 相当の小道具(core層はthreeをimportしない)

export const clamp = (v: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, v));

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

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
