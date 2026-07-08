// 建物パレットとロット → 建物・庭木・区画装飾への変換

import {
  floorValue, HOUSE_FLOORS, HOUSE_VALUE_PER_M2_FLOOR, inMap, PLACE_LOT,
} from './config';
import { palColor } from './color';
import { clamp } from './math';
import type { Rng } from './rng';
import type { Terrain } from './terrain';
import { B, type Building, type Lot, type LotDecal, type Tree, type Vec2 } from './types';

export const PAL_CON = [0xcfd2d6, 0xd8d2c6, 0xbac4cc, 0xc9c9c2, 0xaab4be, 0xd6cfc2, 0x9aa6b0,
  0xb9a88f, 0x8f9a8b, 0xa5988a, 0x93a0a8, 0xc2b6a0, 0x847e74, 0xbfae9c];      // ベージュ・煉瓦・緑灰なども
export const PAL_GLA = [0xe9eff6, 0xd8e2ec, 0xc6d2e0, 0xe2e8ee, 0xcdd8e2,
  0xbfd8d2, 0xaebfd8, 0xd8e4da, 0x9fb4cf];                                     // ティール・スチールブルー系
export const PAL_HOU = [0xf0ead8, 0xe6ddca, 0xdcd6c6, 0xd2d8dc, 0xdde2d2, 0xe8d8c0, 0xcfc8b8,
  0xe8d4d0, 0xd4dde6, 0xd8e4d4, 0xefe2b8, 0xcfc4b2,                            // 淡いピンク・水色・ミントなど
  0xf5f2ea, 0xe0cdb8, 0xd9cfe0, 0xc9d2c2, 0xe4c8b0, 0xd8d8d8, 0xc8bfae, 0xe6d2a8]; // 白・サンド・ラベンダー・セージ・テラコッタ・グレー系
export const ROOF_COLS = [0x9a5648, 0x55616c, 0x4a6250, 0x3f4145, 0xa96a3f, 0x6e5a48]; // 屋根: 赤茶/スレート/深緑/炭/オレンジ/焦茶
export const HOUSE_K0 = 2;   // bMeshes内で民家メッシュが始まるインデックス
export const BUILDING_KINDS = HOUSE_K0 + ROOF_COLS.length;

// 生成中の街(cityGenが組み立て、lots/plans関数が書き込む)
export interface GenCity {
  terrain: Terrain;
  cityHouseTh: number;     // 住宅街になる都心距離のしきい値
  buildings: Building[];
  trees: Tree[];
  lotDecals: LotDecal[];
}

// 区画ローカル座標(回転rot)→世界座標。符号は地面描画の g.rotate(-rot) と一致させる
export function lotToWorld(cx: number, cz: number, rot: number, lx: number, lz: number): Vec2 {
  const c = Math.cos(rot), s = Math.sin(rot);
  return { x: cx + lx * c + lz * s, z: cz - lx * s + lz * c };
}

// 木を1本登録(樹形と樹冠の幅係数はここで抽選し個体差を出す)。
// 配置可否(地図の縁マージン・川の中)もここで一括判定する。植えたらtrue。
// gy/rotY/color/ci/miはcityGenの最終パスが埋める
export function pushTree(city: GenCity, x: number, z: number, s: number, rng: Rng, margin: number): boolean {
  if (!inMap(x, z, margin) || city.terrain.inWater(x, z)) return false;
  // 樹種の抽選: 広葉樹32% / 針葉樹26% / ポプラ16% / ケヤキ26%
  const r = rng();
  const type = r < 0.32 ? 0 : r < 0.58 ? 1 : r < 0.74 ? 2 : 3;
  // w/w2: X/Z別の幅係数。非対称にすることで同じ樹形でも見る角度でシルエットが変わる
  city.trees.push({ x, z, s, w: 0.8 + rng() * 0.45, w2: 0.8 + rng() * 0.45, type, alive: true,
    gy: 0, rotY: 0, color: { r: 1, g: 1, b: 1 }, ci: 0, mi: 0 });
  return true;
}

// ロットの縁(建物の隙間)に木を植える。anywhereなら区画全体に
export function yardTrees(city: GenCity, lot: Lot, n: number, rng: Rng, anywhere = false): void {
  for (let k = 0; k < n; k++) {
    let lx: number, lz: number;
    if (anywhere) {
      lx = (rng() - 0.5) * (lot.availW - 5);
      lz = (rng() - 0.5) * (lot.availD - 5);
    } else if (rng() < 0.5) {
      lx = (rng() < 0.5 ? -1 : 1) * (lot.availW / 2 - 2.5);
      lz = (rng() - 0.5) * (lot.availD - 5);
    } else {
      lz = (rng() < 0.5 ? -1 : 1) * (lot.availD / 2 - 2.5);
      lx = (rng() - 0.5) * (lot.availW - 5);
    }
    const p = lotToWorld(lot.x, lot.z, lot.rot, lx, lz);
    pushTree(city, p.x, p.z, 4.5 + rng() * 4, rng, PLACE_LOT);
  }
}

// 空き区画をポケットパーク(緑地デカール + 密植)にする
export function makePocketPark(city: GenCity, lot: Lot, rng: Rng, minWD: number, minTrees: number): void {
  city.lotDecals.push({ x: lot.x, z: lot.z, rot: lot.rot,
    w: Math.max(minWD, lot.availW - 3), d: Math.max(minWD, lot.availD - 3), kind: 'park' });
  yardTrees(city, lot, clamp(Math.floor(lot.availW * lot.availD / 55), minTrees, 45), rng, true);
}

// 建物レコードの共通部分(接地高さ・初期状態)を埋めて登録する
function pushBuilding(city: GenCity, x: number, z: number, sx: number, sz: number, h: number,
                      rot: number, k: number, value: number, color: Building['color']): void {
  city.buildings.push({ x, z, gy: city.terrain.groundLevel(x, z, sx, sz),
    sx, sz, h, rot, k, mi: 0, value, color, state: B.Intact });
}

// プラン生成器が出したロット {x,z,rot,availW,availD,distC,house} を建物にする
export function addBuildingLot(city: GenCity, lot: Lot, rng: Rng): void {
  const { x, z, rot, availW, availD, distC } = lot;
  if (!inMap(x, z, PLACE_LOT)) return;
  if (city.terrain.cornerBlocked(x, z)) return;          // 山腹・川べりには建てない
  if (lot.house) {
    if (rng() < 0.14) {                                  // 空き地 → 児童公園(緑地 + 密な木)
      makePocketPark(city, lot, rng, 7, 4);
      return;
    }
    if (rng() < 0.05) {                                  // 低層アパート
      const sx = Math.max(8, availW - 4), sz = Math.max(8, availD - 4);
      const h = 9 + rng() * 15;
      pushBuilding(city, x, z, sx, sz, h, rot, 0, floorValue(sx, sz, h), palColor(PAL_CON, rng, 0, 0.1));
    } else {
      const m = 2.5 + rng() * 2;
      const sx = clamp(availW - m * 2, 5.5, 12);
      const sz = clamp(availD - m * 2, 5.5, 12);
      const h = 4.5 + rng() * 3.2;
      pushBuilding(city, x, z, sx, sz, h,
        rot + (rng() < 0.5 ? 0 : Math.PI / 2) + (rng() - 0.5) * 0.09,
        HOUSE_K0 + Math.floor(rng() * ROOF_COLS.length),
        sx * sz * HOUSE_FLOORS * HOUSE_VALUE_PER_M2_FLOOR,
        palColor(PAL_HOU, rng, 0.03, 0.09));
      if (rng() < 0.55) yardTrees(city, lot, 1 + Math.floor(rng() * 2), rng);  // 庭木
    }
  } else {
    if (rng() < 0.11) {                                  // 空地: 駐車場かポケットパーク
      if (rng() < 0.30) {
        city.lotDecals.push({ x, z, rot, w: Math.max(8, availW - 4), d: Math.max(8, availD - 4), kind: 'parking' });
      } else {
        // ビルの隙間の小公園: 緑地 + 森のような植栽
        makePocketPark(city, lot, rng, 8, 6);
      }
      return;
    }
    const m = 2 + rng() * 3;
    const sx = clamp(availW - m * 2, 9, availW * 0.92);
    const sz = clamp(availD - m * 2, 9, availD * 0.92);
    const urban = Math.pow(Math.max(0, 1 - distC), 2);
    let h = 10 + Math.pow(rng(), 2.2) * (24 + 300 * urban);
    if (distC < 0.22 && rng() < 0.35) h = 90 + rng() * 190;   // 都心の超高層
    h = Math.min(h, 300);
    const glass = rng() < (h > 55 ? 0.6 : 0.12);         // 高層はガラス張りが多い
    pushBuilding(city, x, z, sx, sz, h, rot, glass ? 1 : 0, floorValue(sx, sz, h),
      palColor(glass ? PAL_GLA : PAL_CON, rng, 0, 0.1));
    if (rng() < 0.4) yardTrees(city, lot, 1 + Math.floor(rng() * 2), rng);   // 敷地内の植栽
  }
}

// 都心距離distC(CITY_HALF比)から住宅街になるかを決める。境界はシード乱数で揺らぐ
export function isHouseZone(cityHouseTh: number, distC: number, rng: Rng): boolean {
  return distC > cityHouseTh + (rng() - 0.5) * 0.14;
}
