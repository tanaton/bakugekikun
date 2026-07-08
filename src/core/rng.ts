// シード付き乱数。街の生成は必ずこのrngを使う(同じシードで同じ街を再現するため)。
// 爆発などのゲームプレイ演出は Math.random() でよい。

export type Rng = () => number;

export function xfnv1a(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function mulberry32(a: number): Rng {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// サブシステム別の独立乱数ストリーム。ストリームを分けることで、あるサブシステムの
// rng消費数が変わっても他のサブシステムの生成結果が変わらない(決定性の影響半径を限定)
// ストリーム名の全リストはここが唯一の登録簿(名前の衝突・typoを型エラーにする)
export const STREAMS = [
  'features', 'terrain', 'plan', 'lots', 'cars', 'trees',   // core: 街の決定性を構成する
  'facadeTex', 'groundNoise',                               // render: 見た目のみ(街レイアウト非依存)
] as const;
export type StreamName = (typeof STREAMS)[number];

export const rngFor = (seed: string, stream: StreamName): Rng =>
  mulberry32(xfnv1a(seed + '\u0000' + stream));

// 配列からランダムに1要素選ぶ(rは rng か Math.random)
export const pick = <T>(arr: readonly T[], r: Rng): T => arr[Math.floor(r() * arr.length)];
