// 街を構成するエンティティの型定義(純データ。three/DOMオブジェクトは持たない)

import type { RGB } from './color';

export interface Vec2 { x: number; z: number }

// 建物の状態機械: Intact → (Burning →) Falling → Dead
export const B = { Intact: 0, Falling: 1, Dead: 2, Burning: 3 } as const;
export type BState = (typeof B)[keyof typeof B];

export interface Building {
  x: number; z: number;
  gy: number;              // 接地高さ(敷地サンプルの最も高い点)
  fd: number;              // 基礎の深さ(gyから敷地最低点まで。>=0)
  sx: number; sz: number; h: number;
  rot: number;
  k: number;               // メッシュ種別 0=コンクリ 1=ガラス 2以降=民家(屋根色別)
  mi: number;              // InstancedMesh内のインスタンス番号
  fi: number;              // 基礎台メッシュ内のインスタンス番号(=buildings配列のインデックス)
  value: number;
  color: RGB;
  state: BState;
}

export interface MovingCar {
  parked?: undefined;
  road: number;            // roadPathsのインデックス
  s: number;               // パス上の距離
  dir: 1 | -1;
  lane: number;
  speed: number;
  alive: boolean;
  i: number;               // carMeshのインスタンス番号
  color: number;           // hex
  px: number; pz: number;  // 現在位置キャッシュ(updateCarsが毎フレーム更新。被弾判定用)
}

export interface ParkedCar {
  parked: true;
  alive: boolean;
  i: number;
  px: number; pz: number;  // 駐車位置(不変)
  rot: number;
  y: number;
  color: number;           // hex
}

export type Car = MovingCar | ParkedCar;

export interface Tree {
  x: number; z: number;
  s: number;               // 高さスケール
  w: number; w2: number;   // X/Z別の幅係数(非対称にして見る角度でシルエットを変える)
  type: number;            // 樹形 0=広葉樹 1=針葉樹 2=ポプラ 3=ケヤキ
  alive: boolean;
  gy: number;              // 接地高さ
  rotY: number;
  color: RGB;              // 個体差(材質色に乗算される。>1でHDR的に明るくなる)
  ci: number;              // 空間チャンクメッシュのインデックス(render層が採番)
  mi: number;              // チャンクメッシュ内のインスタンス番号(render層が採番)
}

// 道路パス上の点。h(路面高)/hs(横断勾配)/dx,dz(正規化済み進行方向)はbakeRoadHeightsが埋める
export interface RoadPt { x: number; z: number; h: number; hs: number; dx: number; dz: number }

export interface RoadPath {
  pts: RoadPt[];           // 等間隔ROAD_STEP
  w: number;
  major: boolean;
  loop: boolean;
}

export interface AlleyPath { pts: Vec2[]; w: number }

export type GroundKind = 'park' | 'house' | 'block';
export interface GroundPoly { pts: Vec2[]; kind: GroundKind; v?: boolean }

export interface LotDecal { x: number; z: number; rot: number; w: number; d: number; kind: 'park' | 'parking' }

// プラン生成器 → 建物生成への受け渡し
export interface Lot {
  x: number; z: number; rot: number;
  availW: number; availD: number;
  distC: number;           // 都心からの距離(CITY_HALF比)
  house: boolean;
}

export type CityPlanKind = 'grid' | 'organic' | 'radial';
