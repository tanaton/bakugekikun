// 道路パス(任意形状の道路をポリラインで統一的に扱う)

import { MAP_HALF, ROAD_STEP } from './config';
import { clamp } from './math';
import type { Rng } from './rng';
import type { Terrain } from './terrain';
import type { AlleyPath, RoadPath, RoadPt, Vec2 } from './types';

// 粗い点列を等間隔ROAD_STEPに打ち直す(h/hs/dx/dzはbakeRoadHeightsが後で埋める)
export function resamplePath(raw: Vec2[], loop: boolean): RoadPt[] {
  const mk = (x: number, z: number): RoadPt => ({ x, z, h: 0, hs: 0, dx: 0, dz: 0 });
  const pts = [mk(raw[0].x, raw[0].z)];
  const src = loop ? raw.concat([raw[0]]) : raw;
  let prev = src[0], acc = 0;
  for (let i = 1; i < src.length; i++) {
    const cur = src[i];
    let dx = cur.x - prev.x, dz = cur.z - prev.z;
    let segLen = Math.hypot(dx, dz);
    while (segLen > 0 && acc + segLen >= ROAD_STEP) {
      const t = (ROAD_STEP - acc) / segLen;
      prev = { x: prev.x + dx * t, z: prev.z + dz * t };
      pts.push(mk(prev.x, prev.z));
      dx = cur.x - prev.x; dz = cur.z - prev.z;
      segLen = Math.hypot(dx, dz);
      acc = 0;
    }
    acc += segLen;
    prev = cur;
  }
  // ループで終点が始点にちょうど重なった場合は重複点を落とす
  // (閉路の末尾→先頭の区間はcarPoseが補間する)
  if (loop && pts.length > 1) {
    const lastP = pts[pts.length - 1];
    if (Math.hypot(lastP.x - raw[0].x, lastP.z - raw[0].z) < 1e-6) pts.pop();
  }
  return pts;
}

export interface CarPose { x: number; z: number; dx: number; dz: number; h: number; hs: number }
// パス上の距離sにおける位置と進行方向(h/hs/dx/dzはbakeRoadHeightsで事前計算済み)。
// 戻り値は共有スクラッチ(毎フレーム全車で呼ぶためアロケーションしない)。呼び出しをまたいで保持しないこと
const _pose: CarPose = { x: 0, z: 0, dx: 0, dz: 0, h: 0, hs: 0 };
export function carPose(road: RoadPath, s: number): CarPose {
  const n = road.pts.length;
  // 環状路は末尾→先頭の閉路区間(1ステップ扱い)も含めて周回し、
  // 非環状路(行き止まり)は端でクランプして反対端へワープさせない
  if (road.loop) {
    const total = n * ROAD_STEP;
    s = ((s % total) + total) % total;
  } else {
    s = clamp(s, 0, (n - 1) * ROAD_STEP);
  }
  const i = Math.min(n - 1, Math.floor(s / ROAD_STEP));
  const f = s / ROAD_STEP - i;
  const a = road.pts[i], b = road.pts[(i + 1) % n];
  _pose.x = a.x + (b.x - a.x) * f; _pose.z = a.z + (b.z - a.z) * f;
  _pose.dx = a.dx; _pose.dz = a.dz;
  _pose.h = a.h + (b.h - a.h) * f; _pose.hs = a.hs + (b.hs - a.hs) * f;
  return _pose;
}

// 道路点ごとの路面高・横断勾配・進行方向を事前計算(updateCarsの毎フレームterrainH/hypot呼び出しを排除)
export function bakeRoadHeights(roadPaths: RoadPath[], terrain: Terrain): void {
  for (const rp of roadPaths) {
    const n = rp.pts.length, w2 = rp.w / 2;
    for (let i = 0; i < n; i++) {
      const p = rp.pts[i];
      let dx: number, dz: number;
      if (i + 1 < n) { dx = rp.pts[i + 1].x - p.x; dz = rp.pts[i + 1].z - p.z; }
      else if (rp.loop) { dx = rp.pts[0].x - p.x; dz = rp.pts[0].z - p.z; }
      else { dx = p.x - rp.pts[i - 1].x; dz = p.z - rp.pts[i - 1].z; }   // 終端は手前の区間の向きを使う
      const l = Math.hypot(dx, dz) || 1;
      p.dx = dx / l; p.dz = dz / l;
      p.h = terrain.h(p.x, p.z);
      // 進行方向の横(レーンオフセットと同じ向き)に道路半幅ぶん離れた点との高低差
      p.hs = (terrain.h(p.x + p.dz * w2, p.z - p.dx * w2) - p.h) / w2;
    }
  }
}

// 道路上かどうかの粗い判定マスク(並木を交差点上に植えないため)
const MASK_CELL = 20;
export class RoadMask {
  private readonly mask = new Set<number>();
  private cellOf(v: number): number { return Math.round((v + MAP_HALF) / MASK_CELL); }
  private key(cx: number, cz: number): number { return cx * 8192 + cz; }

  constructor(roadPaths: RoadPath[]) {
    for (const rp of roadPaths) {
      const rad = Math.max(0, Math.floor((rp.w / 2 - 6) / MASK_CELL));
      for (const p of rp.pts) {
        const cx = this.cellOf(p.x), cz = this.cellOf(p.z);
        for (let ax = -rad; ax <= rad; ax++)
          for (let az = -rad; az <= rad; az++)
            this.mask.add(this.key(cx + ax, cz + az));
      }
    }
  }

  onRoad(x: number, z: number): boolean {
    return this.mask.has(this.key(this.cellOf(x), this.cellOf(z)));
  }
}

export interface RoadLine { c: number; w: number; major: boolean }
export function genRoadLines(rng: Rng, cityHalf: number): RoadLine[] {
  const lines: RoadLine[] = [{ c: -cityHalf, w: 30, major: true }];
  let c = -cityHalf;
  while (true) {
    c += 130 + rng() * 150;
    if (c > cityHalf - 80) break;
    const major = rng() < 0.22;
    lines.push({ c, w: major ? 32 : 18, major });
  }
  lines.push({ c: cityHalf, w: 30, major: true });
  return lines;
}

// 山・水にかかった道路を刈り取り、通れる区間だけ残す
export function cullMountainRoads(roadPaths: RoadPath[], terrain: Terrain): RoadPath[] {
  const out: RoadPath[] = [];
  for (const rp of roadPaths) {
    let cut = false, run: RoadPt[] = [];
    const runs: RoadPt[][] = [];
    for (const p of rp.pts) {
      if (terrain.roadBlocked(p.x, p.z)) {
        cut = true;
        if (run.length) runs.push(run);
        run = [];
      } else run.push(p);
    }
    if (run.length) runs.push(run);
    if (!cut) { out.push(rp); continue; }
    // 環状道路は始点・終点の区間が地続きなので繋ぎ直す
    if (rp.loop && runs.length >= 2 &&
        !terrain.roadBlocked(rp.pts[0].x, rp.pts[0].z) &&
        !terrain.roadBlocked(rp.pts[rp.pts.length - 1].x, rp.pts[rp.pts.length - 1].z)) {
      runs[0] = runs.pop()!.concat(runs[0]);
    }
    for (const r2 of runs) if (r2.length >= 3) out.push({ pts: r2, w: rp.w, major: rp.major, loop: false });
  }
  return out;
}

// 山・水にかかった路地は丸ごと消す
export function cullMountainAlleys(alleyPaths: AlleyPath[], terrain: Terrain): AlleyPath[] {
  return alleyPaths.filter(al => {
    for (let i = 0; i < al.pts.length - 1; i++) {
      const a = al.pts[i], b = al.pts[i + 1];
      const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 40));
      for (let k = 0; k <= n; k++) {
        if (terrain.roadBlocked(a.x + (b.x - a.x) * k / n, a.z + (b.z - a.z) * k / n)) return false;
      }
    }
    return true;
  });
}
