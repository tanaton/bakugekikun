// 地形: シード付き値ノイズの高さ場 + 四隅/四辺の地形フィーチャ(山・水域)

import { CITY_HALF, MAP_HALF, WATER_BED_Y } from './config';
import { clamp, gridSample, lerp, lotToWorld } from './math';
import type { Rng } from './rng';
import type { Vec2 } from './types';

// 四隅は山か湾、四辺は1辺全体の山脈か水辺
export type CornerFeat =
  | { type: 'm'; kind: 'disc'; x: number; z: number; r: number; amp: number }
  | { type: 'r'; kind: 'disc'; x: number; z: number; r: number; wig: number; ph: number }
  | { type: 'm'; kind: 'band'; axis: 'x' | 'z'; side: -1 | 1; depth: number; amp: number }
  | { type: 'r'; kind: 'band'; axis: 'x' | 'z'; side: -1 | 1; off: number; wig: number; ph: number };

export type BandFeat = Extract<CornerFeat, { kind: 'band' }>;
export type WaterFeat = Extract<CornerFeat, { type: 'r' }>;
export type MountainFeat = Extract<CornerFeat, { type: 'm' }>;

// 帯状フィーチャにおける、地図の縁からの内向き距離
export function bandDu(f: BandFeat, x: number, z: number): number {
  return CITY_HALF - (f.axis === 'x' ? x * f.side : z * f.side);
}
// 帯状フィーチャ: (縁沿い位置t, 内向き距離du) → 世界座標(bandDuの逆変換)
export function bandPt(f: BandFeat, t: number, du: number): Vec2 {
  return f.axis === 'x' ? { x: f.side * (CITY_HALF - du), z: t } : { x: t, z: f.side * (CITY_HALF - du) };
}
// 岸線の揺らぎ。3D水面メッシュと2D地面描画が同じ岸線を描くための共用定義
const bandWig = (f: Extract<WaterFeat, { kind: 'band' }>, t: number): number =>
  f.wig * (0.5 + 0.5 * Math.sin(t / 380 + f.ph));
const discWig = (f: Extract<WaterFeat, { kind: 'disc' }>, a: number): number =>
  f.wig * (0.5 + 0.5 * Math.sin(a * 3 + f.ph));

// 岸帯(陸側の砂色の帯)の張り出し幅(m)。shorePtsのinsetとして2D地面描画が使う
export const BANK_INSET = 14;

// 揺らぐ岸線の点列(insetは陸側への張り出し量。岸帯は+BANK_INSET、水面は0)。
// 3D水面メッシュと2D地面描画が必ず同じ岸線をたどるための共用サンプラ
export function shorePts(f: WaterFeat, inset: number): Vec2[] {
  const pts: Vec2[] = [];
  if (f.kind === 'band') {
    for (let t = -MAP_HALF; t <= MAP_HALF; t += 100)
      pts.push(bandPt(f, t, f.off - bandWig(f, t) + inset));
  } else {
    for (let i = 0; i <= 64; i++) {
      const a = i / 64 * Math.PI * 2, rr = f.r - discWig(f, a) + inset;
      pts.push({ x: f.x + Math.cos(a) * rr, z: f.z + Math.sin(a) * rr });
    }
  }
  return pts;
}

// 水域フィーチャ内側への侵入量(正=水側)。band/discの形状差を吸収する
export function waterPen(f: WaterFeat, x: number, z: number): number {
  return f.kind === 'band' ? f.off - bandDu(f, x, z) : f.r - Math.hypot(x - f.x, z - f.z);
}
// 山フィーチャの正規化距離(0=中心・縁, 1=裾)
export function mtnNorm(f: MountainFeat, x: number, z: number): number {
  return f.kind === 'band' ? bandDu(f, x, z) / f.depth : Math.hypot(x - f.x, z - f.z) / f.r;
}
// フィーチャfの影響領域に点が入っているか
function featRegion(f: CornerFeat, x: number, z: number): boolean {
  return f.type === 'm' ? mtnNorm(f, x, z) < 1 : waterPen(f, x, z) > -30;
}

// 候補フィーチャが既存の「逆タイプ」(山⇔水)と重なるか。同種同士の連なりは許可
function featConflicts(feats: CornerFeat[], cand: CornerFeat): boolean {
  const pts: [number, number][] = [];
  if (cand.kind === 'disc') {
    pts.push([cand.x, cand.z]);
    for (let i = 0; i < 16; i++) {
      const a = i / 16 * Math.PI * 2;
      pts.push([cand.x + Math.cos(a) * cand.r * 0.55, cand.z + Math.sin(a) * cand.r * 0.55]);
      pts.push([cand.x + Math.cos(a) * cand.r * 0.98, cand.z + Math.sin(a) * cand.r * 0.98]);
    }
  } else {
    const dep = cand.type === 'm' ? cand.depth : cand.off + 20;
    for (let t = -CITY_HALF; t <= CITY_HALF; t += 250) {
      for (const du of [10, dep * 0.5, dep * 0.95]) {
        const q = bandPt(cand, t, du);
        pts.push([q.x, q.z]);
      }
    }
  }
  for (const f of feats) {
    if (f.type === cand.type) continue;
    for (const [px, pz] of pts) {
      if (Math.abs(px) > MAP_HALF || Math.abs(pz) > MAP_HALF) continue;
      if (featRegion(f, px, pz)) return true;
    }
  }
  return false;
}

export interface CityFeatures {
  cityCore: Vec2;          // 都心(ビル群)の位置。シードでずれる
  cityHouseTh: number;     // 住宅街になる都心距離のしきい値。小さいほど住宅街が多い
  feats: CornerFeat[];
}

// 都心位置・住宅比率・四隅/四辺の地形フィーチャをシードから決める('features'ストリーム)
export function generateFeatures(rng: Rng): CityFeatures {
  const coreA = rng() * Math.PI * 2, coreR = rng() * 900;
  const cityCore = { x: Math.cos(coreA) * coreR, z: Math.sin(coreA) * coreR };
  const cityHouseTh = 0.53 + rng() * 0.2;   // 0.53(住宅多め) 〜 0.73(ビル多め)
  const feats: CornerFeat[] = [];
  const corners: [number, number][] = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
  for (const [sx, sz] of corners) {
    const roll = rng(), fr = rng(), fp = rng(), ph = rng() * Math.PI * 2;
    let cand: CornerFeat | null = null;
    if (roll < 0.34) {
      cand = { type: 'm', kind: 'disc', x: sx * CITY_HALF, z: sz * CITY_HALF,
        r: 1100 + fr * 650, amp: 170 + fp * 260 };
    } else if (roll < 0.67) {
      cand = { type: 'r', kind: 'disc', x: sx * CITY_HALF, z: sz * CITY_HALF,
        r: 700 + fr * 600, wig: 30 + fp * 50, ph };
    }
    if (cand && !featConflicts(feats, cand)) feats.push(cand);   // 山と水は重ねない
  }
  const edges: ['x' | 'z', -1 | 1][] = [['z', -1], ['z', 1], ['x', -1], ['x', 1]];
  for (const [axis, side] of edges) {
    const roll = rng(), fr = rng(), fp = rng(), ph = rng() * Math.PI * 2;
    let cand: CornerFeat | null = null;
    if (roll < 0.22) {
      cand = { type: 'm', kind: 'band', axis, side, depth: 500 + fr * 450, amp: 170 + fp * 260 };
    } else if (roll < 0.44) {
      cand = { type: 'r', kind: 'band', axis, side, off: 230 + fr * 300, wig: 30 + fp * 50, ph };
    }
    if (cand && !featConflicts(feats, cand)) feats.push(cand);
  }
  return { cityCore, cityHouseTh, feats };
}

const TG_N = 33, TG_SPAN = 6400;

// groundSpanのサンプル点(中心+4隅+4辺中点)。辺中点は大型ビルの敷地内で
// 二重スケールノイズが凸になり隅より高くなるケースを拾う
export const SPAN_OFFS: [number, number][] =
  [[0, 0], [-1, -1], [1, -1], [-1, 1], [1, 1], [-1, 0], [1, 0], [0, -1], [0, 1]];

export class Terrain {
  readonly feats: CornerFeat[];
  readonly cityCore: Vec2;
  private readonly grid: Float32Array;
  private readonly amp: number;

  // 起伏の格子と強さは'terrain'ストリームで決める
  constructor(features: CityFeatures, rng: Rng) {
    this.feats = features.feats;
    this.cityCore = features.cityCore;
    this.grid = new Float32Array(TG_N * TG_N);
    for (let i = 0; i < this.grid.length; i++) this.grid[i] = rng();
    this.amp = 45 + rng() * 55;
  }

  h(x: number, z: number): number {
    const u = (x + TG_SPAN / 2) / TG_SPAN * (TG_N - 1);
    const v = (z + TG_SPAN / 2) / TG_SPAN * (TG_N - 1);
    const c1 = gridSample(this.grid, TG_N, u * 0.28 + 2.3, v * 0.28 + 4.1);   // 大きなうねり
    const c2 = gridSample(this.grid, TG_N, u, v);                             // 細かい起伏
    const h = (c1 - 0.5) * 1.6 + (c2 - 0.5) * 0.5;
    const distC = Math.hypot(x - this.cityCore.x, z - this.cityCore.z) / CITY_HALF;
    const flat = 0.25 + 0.75 * clamp((distC - 0.15) / 0.75, 0, 1); // 都心部は平坦
    let hh = h * this.amp * flat;
    // 地形フィーチャ: 山は隆起、水域は固定水面レベルへ平坦化ブレンド
    let wb = 0;   // 水面ブレンド率(1=完全な水面)
    for (const f of this.feats) {
      if (f.type === 'm') {
        const tn = mtnNorm(f, x, z);
        // 高さプロファイルは意図的に band=線形の肩 / disc=釣鐘型 で異なる
        if (tn < 1) { const k = f.kind === 'band' ? 1 - tn : 1 - tn * tn; hh += f.amp * k * k; }
      } else {
        // 岸線(pen=0)の少し手前でwb=1に到達させ、水域内の地形を必ず水底まで沈める。
        // 以前は岸から水側50mまでかけて沈めていたため、その帯の地形が水面メッシュ
        // (WATER_SURFACE_Y)より上に露出し、水色に塗った地面が見えていた
        const pen = waterPen(f, x, z);
        if (pen > -90) wb = Math.max(wb, Math.min(1, (pen + 90) / 86));
      }
    }
    if (wb > 0) hh = lerp(hh, WATER_BED_Y, wb);   // 水面は起伏の影響を受けず平坦
    return hh;
  }

  // 地形フィーチャで建物が建てられない場所か(山腹・水辺)
  cornerBlocked(x: number, z: number): boolean {
    for (const f of this.feats) {
      if (f.type === 'm') { if (mtnNorm(f, x, z) < 0.8) return true; }
      else if (waterPen(f, x, z) > -16) return true;
    }
    return false;
  }

  // 山の中か(道路も通さない)
  inMountain(x: number, z: number): boolean {
    for (const f of this.feats) {
      if (f.type === 'm' && mtnNorm(f, x, z) < 0.82) return true;
    }
    return false;
  }

  // 水面の中か(木も生えない)。湾は隅の円内、帯は縁側すべてが水
  inWater(x: number, z: number): boolean {
    for (const f of this.feats) {
      if (f.type === 'r' && waterPen(f, x, z) > 6) return true;
    }
    return false;
  }

  // 道路を通せない場所(山の中・水の中)
  roadBlocked(x: number, z: number): boolean {
    return this.inMountain(x, z) || this.inWater(x, z);
  }

  // 建物の接地スパン: top=敷地サンプルの最高点(壁の接地高さ)、bottom=最低点(基礎の下端)。
  // 最高点に接地して基礎で埋めることで、斜面の高い側の地形が壁にめり込まない
  groundSpan(x: number, z: number, sx: number, sz: number, rot = 0): { top: number; bottom: number } {
    const hx = sx / 2, hz = sz / 2;
    let top = -Infinity, bottom = Infinity;
    for (const [ox, oz] of SPAN_OFFS) {
      const p = lotToWorld(x, z, rot, ox * hx, oz * hz);
      const v = this.h(p.x, p.z);
      if (v > top) top = v;
      if (v < bottom) bottom = v;
    }
    return { top, bottom };
  }
}
