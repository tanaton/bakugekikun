// ゲーム全体で共有する定数(純粋層。three/DOMに依存しない)

export const CITY_HALF = 2500;          // 街の半径 (m) → 5km四方
export const MAP_HALF = 2700;           // 余白込みの世界半径。カメラ移動・着弾クランプ・空間ハッシュの原点
export const CAR_VALUE = 3000000;       // 車1台の被害額
export const FLOOR_H = 3.5;             // 1フロアの高さ
export const VALUE_PER_M2_FLOOR = 300000;      // 床面積1m2あたりの資産額
export const HOUSE_FLOORS = 2;                 // 民家は2階建て想定
export const HOUSE_VALUE_PER_M2_FLOOR = 200000; // 民家の床面積1m2あたりの資産額

// ビル・アパートの資産額(延床面積 × 単価)
export const floorValue = (sx: number, sz: number, h: number): number =>
  sx * sz * (h / FLOOR_H) * VALUE_PER_M2_FLOOR;

// 地図の縁からのマージン込みの配置可能範囲(±)。対象ごとにマージンが異なる
export const PLACE_LOT = 2600, PLACE_TREE = 2550, PLACE_FOREST = 2560;
export const inMap = (x: number, z: number, half: number): boolean =>
  Math.abs(x) <= half && Math.abs(z) <= half;

// 地面テクスチャの座標系。地面メッシュ・破壊跡の焼き込み・地肌マスクが全て共有する
export const GROUND_TEX = 2048;                       // テクスチャ解像度(px)
export const GROUND_WORLD = 5400;                     // 地面メッシュの一辺(m)
export const GROUND_SCALE = GROUND_TEX / GROUND_WORLD;
export const worldToTex = (v: number): number => (v + GROUND_WORLD / 2) * GROUND_SCALE;

export const GRID_CELL = 130;   // 空間ハッシュのセルサイズ
export const ROAD_STEP = 20;    // 道路パス上の点の間隔(m)
export const N_CARS = 5000;     // 走行車両の台数
