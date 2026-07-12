import { describe, expect, it } from 'vitest';
import { generateCityData } from '../src/core/cityGen';
import { inMap, MAP_HALF, PLACE_LOT, PLACE_FOREST, ROAD_STEP } from '../src/core/config';
import { inPond } from '../src/core/ponds';
import { B } from '../src/core/types';

// ランダム風のシード20個で全件検査するプロパティテスト。
// 対象が数万件あるため、ループ内ではexpect()を呼ばず違反だけを集約する(1件ずつだと遅すぎる)
const SEEDS = Array.from({ length: 20 }, (_, i) => `PROP-${i * 7919}`);

// 都市データ全体を保持するとワーカーのメモリを圧迫するため、
// プラン網羅テスト用にプラン名だけ記録する(街は各テスト内で使い捨て)
const seenPlans = new Map<string, string>();

describe('generateCityData 不変条件', () => {
  it.each(SEEDS)('シード %s の街が不変条件を満たす', seed => {
    const city = generateCityData(seed);
    seenPlans.set(seed, city.plan);
    const errors: string[] = [];
    const check = (cond: boolean, msg: () => string): void => {
      if (!cond && errors.length < 10) errors.push(msg());
    };

    // 建物: 地図内・非水没・寸法/価値が正・初期状態
    expect(city.buildings.length).toBeGreaterThan(0);
    for (const b of city.buildings) {
      check(inMap(b.x, b.z, PLACE_LOT), () => `建物が地図外 (${b.x}, ${b.z})`);
      check(!city.terrain.inWater(b.x, b.z), () => `建物が水没 (${b.x}, ${b.z})`);
      check(b.sx > 0 && b.sz > 0 && b.h > 0 && b.h <= 300, () => `建物の寸法が不正 ${b.sx}x${b.sz}x${b.h}`);
      check(b.value > 0, () => `建物の価値が不正 ${b.value}`);
      check(b.state === B.Intact, () => `建物の初期状態が不正 ${b.state}`);
      check(b.gy >= city.terrain.h(b.x, b.z) - 1e-9, () => `接地高さが中心地形より低い (${b.x}, ${b.z})`);
      check(b.fd >= 0 && Number.isFinite(b.fd), () => `基礎深さが不正 ${b.fd}`);
    }
    // 種類別インスタンス番号が各種類内で0..n-1の連番
    const byK = new Map<number, number[]>();
    for (const b of city.buildings) {
      let mis = byK.get(b.k);
      if (!mis) byK.set(b.k, mis = []);
      mis.push(b.mi);
    }
    for (const [k, mis] of byK) {
      mis.sort((a, b2) => a - b2);
      mis.forEach((mi, idx) => check(mi === idx, () => `種類${k}のmiが非連番`));
    }

    // 道路: 点間隔がほぼROAD_STEP、進行方向が正規化済み。
    // 環状路(と山で刈られたその断片)は周長を等分したステップで刻まれるため
    // ROAD_STEPより最大+17%(3等分時の丸め上限)伸びうる。折れ点をまたぐ弦は短くなる
    expect(city.roadPaths.length).toBeGreaterThan(0);
    for (const rp of city.roadPaths) {
      check(rp.pts.length >= 3, () => `道路の点数が不足 ${rp.pts.length}`);
      for (let i = 1; i < rp.pts.length; i++) {
        const d = Math.hypot(rp.pts[i].x - rp.pts[i - 1].x, rp.pts[i].z - rp.pts[i - 1].z);
        check(d <= ROAD_STEP * 1.17 + 1e-6 && d > ROAD_STEP / Math.SQRT2 - 0.01,
          () => `道路の点間隔が不正 ${d}`);
      }
      for (const p of rp.pts) {
        check(Math.abs(Math.hypot(p.dx, p.dz) - 1) < 1e-6, () => `進行方向が非正規化`);
        check(Number.isFinite(p.h) && Number.isFinite(p.hs), () => `路面高が不正`);
      }
    }

    // 車: 走行車両はroadインデックスが有効、全車が位置キャッシュを持つ
    expect(city.movingCars).toBeGreaterThan(0);
    expect(city.cars.length).toBeGreaterThanOrEqual(city.movingCars);
    city.cars.forEach((c, idx) => {
      check(c.i === idx, () => `carのiが非連番 ${c.i} != ${idx}`);
      check(c.alive, () => 'carの初期aliveが不正');
      check(Number.isFinite(c.px) && Number.isFinite(c.pz), () => 'carの位置キャッシュが未設定');
      if (idx < city.movingCars) {
        check(!c.parked, () => '走行領域に駐車車両');
        if (!c.parked) check(c.road >= 0 && c.road < city.roadPaths.length, () => `roadが範囲外 ${c.road}`);
      } else {
        check(c.parked === true, () => '駐車領域に走行車両');
      }
    });

    // 木: 地図内・非水没・スケール正
    expect(city.trees.length).toBeGreaterThan(0);
    for (const t of city.trees) {
      check(inMap(t.x, t.z, PLACE_FOREST), () => `木が地図外 (${t.x}, ${t.z})`);
      check(!city.terrain.inWater(t.x, t.z), () => `木が水没 (${t.x}, ${t.z})`);
      check(t.s > 0 && t.type >= 0 && t.type < 4 && t.alive, () => '木のパラメータが不正');
      check(Number.isFinite(t.gy), () => '木の接地高さが不正');
      check(t.color.r >= 0 && t.color.g >= 0 && t.color.b >= 0, () => '木の色が不正');
    }

    // 池: 地図内・半径正・地形フィーチャ(山・水域)と重ならない
    for (const p of city.ponds) {
      check(inMap(p.x, p.z, MAP_HALF), () => `池が地図外 (${p.x}, ${p.z})`);
      check(p.r > 0 && p.wig >= 0 && p.wig < p.r, () => `池の形状が不正 r=${p.r} wig=${p.wig}`);
      check((p.e ?? 0) >= 0 && (p.e ?? 0) < 0.5, () => `池の伸長率が不正 e=${p.e}`);
      check(!city.terrain.roadBlocked(p.x, p.z), () => `池が山・水域と重なる (${p.x}, ${p.z})`);
    }
    // 園路が池に入らない(池は園路から一番離れた象限に置かれる)。
    // padは2まで: 中央広場の環状園路は池中心から7mと近い(岸帯5m+余裕2m)
    for (const pp of city.parkPaths) {
      for (const pt of pp.pts) {
        check(!inPond(city.ponds, pt.x, pt.z, 2), () => `園路が池に入る (${pt.x}, ${pt.z})`);
      }
    }

    // 街区ポリゴンが地図近傍に収まる(ワープや扇形で多少はみ出すのは許容)
    for (const gp of city.groundPolys) {
      check(gp.pts.length >= 3, () => '街区ポリゴンの点数が不足');
      for (const p of gp.pts) {
        check(Math.abs(p.x) < MAP_HALF + 600 && Math.abs(p.z) < MAP_HALF + 600,
          () => `街区ポリゴンが地図から大きくはみ出す (${p.x}, ${p.z})`);
      }
    }

    expect(errors).toEqual([]);
  }, 30000);

  // 上のit.eachが記録したプラン名を使う(このファイル内のテストは宣言順に実行される)
  it('3種類の都市プランがすべて出現する', () => {
    expect(seenPlans.size).toBe(SEEDS.length);
    const plans = new Set(seenPlans.values());
    expect(plans).toContain('grid');
    expect(plans).toContain('organic');
    expect(plans).toContain('radial');
  });
});
