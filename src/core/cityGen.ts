// 街生成のオーケストレータ。シード文字列から街の全データを純粋に確定する。
// 描画(InstancedMesh構築・テクスチャ)はrender層のbuildCityViewが行う。
//
// 乱数はサブシステム別ストリーム(rngFor)に分割してあり、例えば木の生成ロジックを
// 変えても建物や道路の配置は変わらない。

import { N_CARS, PLACE_FOREST, PLACE_TREE, ROAD_STEP, inMap } from './config';
import { hslToRgb, jitterHdr } from './color';
import { addBuildingLot, BUILDING_KINDS, pushTree, type GenCity } from './lots';
import { lotToWorld } from './math';
import { bakeRoadHeights, carPose, cullMountainAlleys, cullMountainRoads, laneOffset, RoadMask } from './roads';
import { genGridPlan, genRadialPlan } from './plans';
import { pick, rngFor } from './rng';
import { SpatialHash } from './spatialHash';
import { bandPt, generateFeatures, Terrain } from './terrain';
import type {
  AlleyPath, Building, Car, CityPlanKind, GroundPoly, LotDecal, MovingCar,
  ParkedCar, RoadPath, Tree,
} from './types';

export interface CityData {
  seed: string;
  plan: CityPlanKind;
  terrain: Terrain;
  buildings: Building[];
  kindCounts: number[];    // 建物種類別の棟数(b.miの採番結果。renderのInstancedMesh確保数)
  cars: Car[];
  movingCars: number;      // cars配列の先頭movingCars台が走行車両。以降は駐車車両(行列は不変)
  trees: Tree[];
  roadPaths: RoadPath[];
  alleyPaths: AlleyPath[];
  groundPolys: GroundPoly[];
  lotDecals: LotDecal[];
}

const CAR_COLORS = [0xd0d3d8, 0x30343c, 0xa33a2e, 0x3a5d8f, 0xc2b26a, 0x777d88];

export function generateCityData(seed: string): CityData {
  // --- 地形フィーチャと起伏 ---
  const features = generateFeatures(rngFor(seed, 'features'));
  const terrain = new Terrain(features, rngFor(seed, 'terrain'));

  // --- 都市プランをシードで選ぶ ---
  const planRng = rngFor(seed, 'plan');
  const roll = planRng();
  const plan: CityPlanKind = roll < 0.34 ? 'grid' : roll < 0.67 ? 'organic' : 'radial';
  const po = plan === 'radial'
    ? genRadialPlan(planRng, features.cityCore, features.cityHouseTh)
    : genGridPlan(planRng, plan === 'organic', features.cityCore, features.cityHouseTh);
  const roadPaths = cullMountainRoads(po.roadPaths, terrain);   // 山にかかった道路・路地は消して森にする
  const alleyPaths = cullMountainAlleys(po.alleyPaths, terrain);

  // --- 建物・民家(プラン生成が出したロットから) ---
  const gen: GenCity = { terrain, cityHouseTh: features.cityHouseTh,
    buildings: [], trees: [], lotDecals: [] };
  const lotsRng = rngFor(seed, 'lots');
  for (const lot of po.pendingLots) addBuildingLot(gen, lot, lotsRng);
  // 種類別メッシュ内の番号を採番(countsはkindCountsとして返し、renderが確保数に使う)
  const kindCounts = new Array<number>(BUILDING_KINDS).fill(0);
  for (const b of gen.buildings) b.mi = kindCounts[b.k]++;

  // --- 車(道路パスに沿って走る) ---
  bakeRoadHeights(roadPaths, terrain);
  const carsRng = rngFor(seed, 'cars');
  const cars: Car[] = [];
  for (let i = 0; i < N_CARS; i++) {
    const ri = Math.floor(carsRng() * roadPaths.length);
    const rp = roadPaths[ri];
    const dir: 1 | -1 = carsRng() < 0.5 ? 1 : -1;
    const c: MovingCar = {
      road: ri, dir,
      lane: dir * (rp.w / 2 - 4 - carsRng() * (rp.major ? 6 : 1)),
      s: carsRng() * (rp.pts.length - 1) * ROAD_STEP,
      speed: 9 + carsRng() * 12, alive: true, i,
      color: pick(CAR_COLORS, carsRng),
      px: 0, pz: 0,
    };
    // 被弾判定用の位置キャッシュを初期化(以降はupdateCarsが毎フレーム更新)
    const q = laneOffset(carPose(rp, c.s), c.lane);
    c.px = q.x; c.pz = q.z;
    cars.push(c);
  }
  const movingCars = cars.length;
  // 駐車場の停車中の車(動かない)。区画のローカル座標で列に並べる
  for (const dcl of gen.lotDecals) {
    if (dcl.kind !== 'parking') continue;
    for (let lz = -dcl.d / 2 + 3.2; lz <= dcl.d / 2 - 3.2; lz += 11) {    // 列: 枠5.5 + 通路
      for (let lx = -dcl.w / 2 + 2; lx <= dcl.w / 2 - 2; lx += 3.4) {     // 枠のピッチ
        if (carsRng() < 0.45) continue;                                   // 空き枠
        const { x, z } = lotToWorld(dcl.x, dcl.z, dcl.rot, lx, lz);
        const c: ParkedCar = { parked: true, alive: true, i: cars.length, px: x, pz: z,
          rot: dcl.rot + Math.PI / 2, y: terrain.h(x, z) + 1,
          color: pick(CAR_COLORS, carsRng) };
        cars.push(c);
      }
    }
  }

  // --- 公園の木と並木(庭木はロット生成時に追加済み) ---
  const treesRng = rngFor(seed, 'trees');
  for (const job of po.parkTreeJobs) {
    for (let k = 0; k < job.n; k++) {
      const pt = job.sample(treesRng);
      pushTree(gen, pt.x, pt.z, 6.5 + treesRng() * 7, treesRng, PLACE_TREE);
    }
  }
  const roadMask = new RoadMask(roadPaths);
  for (const rp of roadPaths) {
    let spacing: number, skip: number;
    if (rp.major) { spacing = 24; skip = 0.15; }
    else if (treesRng() < 0.45) { spacing = 46; skip = 0.35; }  // 生活道路にもまばらに
    else continue;
    const total = (rp.pts.length - 1) * ROAD_STEP;
    for (let sd = 30; sd < total - 30; sd += spacing + treesRng() * 14) {
      if (treesRng() < skip) continue;
      const p = carPose(rp, sd);
      const off = rp.w / 2 + 3.5;
      for (const sgn of [1, -1]) {
        const { x: tx, z: tz } = laneOffset(p, off * sgn);
        if (roadMask.onRoad(tx, tz)) continue;  // 交差点上には植えない
        pushTree(gen, tx, tz, 6 + treesRng() * 4, treesRng, PLACE_TREE);
      }
    }
  }
  // 山は公園以上の密度の森に覆われる(山裾は民家と重ならないよう減衰)。
  // sample()は {x, z, tn} を返す(tn: 0=縁 1=内側の裾。山裾では密度を外側に向かって減衰させる)
  const plantForest = (target: number, sample: () => { x: number; z: number; tn: number }): void => {
    let placed = 0;
    for (let k = 0; k < target * 4 && placed < target; k++) {
      const s = sample();
      if (s.tn > 0.72 && treesRng() > Math.pow(Math.max(0, 1 - (s.tn - 0.72) / 0.26), 2)) continue;
      if (roadMask.onRoad(s.x, s.z)) continue;
      if (pushTree(gen, s.x, s.z, 7 + treesRng() * 6.5, treesRng, PLACE_FOREST)) placed++;
    }
  };
  for (const f of terrain.feats) {
    if (f.type !== 'm') continue;
    if (f.kind === 'band') {
      // 1辺全体の山脈の森
      plantForest(Math.min(20000, Math.round(5300 * f.depth * 0.9 / 105)), () => {
        const t = -2650 + treesRng() * 5300;
        const du = treesRng() * f.depth * 0.95;
        const p = bandPt(f, t, du);
        return { x: p.x, z: p.z, tn: du / f.depth };
      });
      continue;
    }
    // 湾曲の山: 地図内に入る面積比を見積もってから植える(サンプラは見積もりと植栽で共用)
    const sampleDisc = () => {
      const a = treesRng() * Math.PI * 2, rr = Math.sqrt(treesRng()) * f.r * 0.95;
      return { x: f.x + Math.cos(a) * rr, z: f.z + Math.sin(a) * rr, tn: rr / f.r };
    };
    let nIn = 0;
    for (let k = 0; k < 128; k++) {
      const s = sampleDisc();
      if (inMap(s.x, s.z, PLACE_FOREST)) nIn++;
    }
    plantForest(Math.min(20000, Math.round(Math.PI * f.r * f.r * (nIn / 128) / 105)), sampleDisc);
  }
  // 木の個体差(向き・色)と接地高さを確定する。
  // 色相・彩度・明度を広めに振り、針葉樹以外の約12%は紅葉(黄 / 橙 / 赤)の個体にする
  for (const t of gen.trees) {
    t.gy = terrain.h(t.x, t.z);
    t.rotY = treesRng() * Math.PI * 2;
    if (t.type !== 1 && treesRng() < 0.12) {
      const a = treesRng();
      const base = a < 0.4 ? { r: 1.9, g: 1.0, b: 0.35 }
        : a < 0.75 ? { r: 2.0, g: 0.72, b: 0.30 } : { r: 1.75, g: 0.5, b: 0.32 };
      t.color = jitterHdr(base, (treesRng() - 0.5) * 0.04, (treesRng() - 0.5) * 0.1);
    } else {
      // 白(=無変化)はoffsetHSLだと色相・彩度が乗らないため、白→純色のティントで
      // 色味を作り、明度は全体スケールで振る(1を超える個体はHDR的に明るくなる)
      const tint = hslToRgb((treesRng() - 0.5) * 0.09, 1,
        1 - Math.max(0, (treesRng() - 0.5) * 0.25) / 2);
      const k = 1 + (treesRng() - 0.5) * 0.14 - 0.02;
      t.color = { r: tint.r * k, g: tint.g * k, b: tint.b * k };
    }
  }

  return {
    seed, plan, terrain,
    buildings: gen.buildings, kindCounts, cars, movingCars, trees: gen.trees,
    roadPaths, alleyPaths, groundPolys: po.groundPolys, lotDecals: gen.lotDecals,
  };
}

// 静的オブジェクトの空間ハッシュ(破壊判定の近傍走査用)
export interface CityIndex {
  buildings: SpatialHash<Building>;
  trees: SpatialHash<Tree>;
  parked: SpatialHash<ParkedCar>;   // 走行車両は毎フレーム動くので対象外(全数走査)
}

export function buildCityIndex(city: CityData): CityIndex {
  const buildings = new SpatialHash<Building>();
  for (const b of city.buildings) buildings.insert(b.x, b.z, b);
  const trees = new SpatialHash<Tree>();
  for (const t of city.trees) trees.insert(t.x, t.z, t);
  const parked = new SpatialHash<ParkedCar>();
  for (const c of city.cars) if (c.parked) parked.insert(c.px, c.pz, c);
  return { buildings, trees, parked };
}
