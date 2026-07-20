// 逃走モードの難易度カーブ(純関数)。生存時間 → 予告時間・爆撃間隔・同時数・武器抽選重み

import { lerp } from '../core/math';

export interface Difficulty {
  warnT: number;          // 予告から着弾までの秒数
  interval: number;       // 爆撃予告の発生間隔(秒)
  maxConcurrent: number;  // 同時に予告できる爆撃数
  wSingle: number; wCluster: number; wNuke: number;   // 武器の抽選重み(和=1)
}

export const NUKE_WARN_BONUS = 5;    // 核はエリアが広いぶん予告を長くして逃げる余地を残す
export const NUKE_COOLDOWN = 25;     // 核の連発禁止(秒)

// 折れ線テーブル: [生存秒, warnT, interval, maxConcurrent, single, cluster, nuke]。
// 行間は線形補間、最終行以降は一定
const TABLE: [number, number, number, number, number, number, number][] = [
  [0,   5.5, 3.5, 1, 1.00, 0,    0],
  [60,  5.0, 3.0, 2, 0.80, 0.20, 0],
  [120, 4.5, 2.5, 3, 0.65, 0.35, 0],
  [180, 4.0, 2.0, 4, 0.60, 0.30, 0.10],
  [300, 3.2, 1.4, 5, 0.50, 0.35, 0.15],
  [480, 2.5, 0.9, 6, 0.45, 0.35, 0.20],
];

export function difficultyAt(t: number): Difficulty {
  const last = TABLE[TABLE.length - 1];
  let row: number[] = last;
  if (t <= TABLE[0][0]) row = TABLE[0];
  else if (t < last[0]) {
    for (let i = 1; i < TABLE.length; i++) {
      if (t < TABLE[i][0]) {
        const a = TABLE[i - 1], b = TABLE[i];
        const k = (t - a[0]) / (b[0] - a[0]);
        row = a.map((v, j) => lerp(v, b[j], k));
        break;
      }
    }
  }
  // 重みは補間後に正規化(補間途中で和が1からわずかにずれても抽選が破綻しないように)
  const wSum = row[4] + row[5] + row[6];
  return {
    warnT: row[1], interval: row[2],
    maxConcurrent: Math.round(row[3]),
    wSingle: row[4] / wSum, wCluster: row[5] / wSum, wNuke: row[6] / wSum,
  };
}
