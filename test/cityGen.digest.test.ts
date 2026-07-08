import { describe, expect, it } from 'vitest';
import { generateCityData } from '../src/core/cityGen';
import { xfnv1a } from '../src/core/rng';

// 代表シードのダイジェストスナップショット。
// 生成コードのrng呼び出し順を変えるとここが変わる = 既存シードの街が変わる。
// 意図的な変更のときだけ `vitest -u` でスナップショットを更新し、コミットメッセージに明記すること。
// 注意: Math.atan2/sin等はエンジン実装依存のため、Nodeのメジャー更新(V8更新)でも
// 最終ビット差が丸め境界に乗って変わることがある(例: Node 20→24でbuildingsのみ変化)。
// その場合は counts が不変であることを確認したうえで更新してよい
const SEEDS = ['BAKUGEKI-01', 'CITY-00001', 'CITY-31337', 'TOKYO', 'niigata', 'ながいシード文字列'];

// 浮動小数点を1e-6で丸めてからJSON化しハッシュ(プラットフォーム差のノイズを除去)
function digest(value: unknown): number {
  const json = JSON.stringify(value, (_k, v) =>
    typeof v === 'number' ? Math.round(v * 1e6) / 1e6 : v);
  return xfnv1a(json);
}

describe('generateCityData ダイジェスト', () => {
  it.each(SEEDS)('シード %s のダイジェストが凍結値と一致する', seed => {
    const c = generateCityData(seed);
    const summary = {
      plan: c.plan,
      counts: {
        buildings: c.buildings.length,
        cars: c.cars.length,
        movingCars: c.movingCars,
        trees: c.trees.length,
        roads: c.roadPaths.length,
        alleys: c.alleyPaths.length,
        groundPolys: c.groundPolys.length,
        lotDecals: c.lotDecals.length,
      },
      hashes: {
        buildings: digest(c.buildings),
        cars: digest(c.cars),
        trees: digest(c.trees),
        roadPaths: digest(c.roadPaths),
        alleyPaths: digest(c.alleyPaths),
        groundPolys: digest(c.groundPolys),
        lotDecals: digest(c.lotDecals),
      },
    };
    expect(summary).toMatchSnapshot();
  });
});
