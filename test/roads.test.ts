import { describe, expect, it } from 'vitest';
import { ROAD_STEP } from '../src/core/config';
import { bakeRoadHeights, carPose, genRoadLines, resamplePath } from '../src/core/roads';
import { mulberry32 } from '../src/core/rng';
import type { RoadPath, Vec2 } from '../src/core/types';
import { mkTerrain } from './helpers';

describe('resamplePath', () => {
  it('直線では点間隔が正確にROAD_STEP、折れ線でも弦はROAD_STEP以下', () => {
    // 直線: 完全に等間隔
    const line = resamplePath([{ x: 0, z: 0 }, { x: 500, z: 0 }], false);
    for (let i = 1; i < line.length; i++) {
      expect(line[i].x - line[i - 1].x).toBeCloseTo(ROAD_STEP, 9);
    }
    // 折れ線: 経路に沿ってROAD_STEPずつ刻むので、折れ点をまたぐ弦は少し短くなる
    const raw: Vec2[] = [];
    for (let i = 0; i <= 20; i++) raw.push({ x: i * 37, z: Math.sin(i) * 60 });
    const pts = resamplePath(raw, false);
    for (let i = 1; i < pts.length; i++) {
      const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
      expect(d).toBeLessThanOrEqual(ROAD_STEP + 1e-9);
      expect(d).toBeGreaterThan(ROAD_STEP / Math.SQRT2 - 0.01);   // 直角折れでも下限は step/√2
    }
  });

  it('ループ指定で始点に戻る区間も刻む', () => {
    const raw: Vec2[] = [
      { x: 0, z: 0 }, { x: 200, z: 0 }, { x: 200, z: 200 }, { x: 0, z: 200 },
    ];
    const pts = resamplePath(raw, true);
    // 総延長800m → 40点(始点含む)。最後の点から始点までもROAD_STEP以下
    expect(pts.length).toBeGreaterThanOrEqual(40);
    const last = pts[pts.length - 1];
    expect(Math.hypot(last.x - 0, last.z - 0)).toBeLessThanOrEqual(ROAD_STEP + 1e-6);
  });
});

describe('carPose', () => {
  it('区間内を線形補間し、sは総延長でラップする', () => {
    const rp: RoadPath = {
      pts: resamplePath([{ x: 0, z: 0 }, { x: 100, z: 0 }], false),
      w: 18, major: false, loop: false,
    };
    const terrain = mkTerrain('CARPOSE');
    bakeRoadHeights([rp], terrain);
    const maxS = (rp.pts.length - 1) * ROAD_STEP;
    const p1 = carPose(rp, 30);
    expect(p1.x).toBeCloseTo(30, 6);
    expect(p1.z).toBeCloseTo(0, 6);
    const x1 = carPose(rp, 10).x;
    const x2 = carPose(rp, 10 + maxS).x;   // 一周ぶん足しても同じ位置
    expect(x2).toBeCloseTo(x1, 6);
    const xm = carPose(rp, -10).x;          // 負のsもラップ
    expect(xm).toBeCloseTo(maxS - 10, 6);
  });

  it('bakeRoadHeightsが正規化済み進行方向と路面高を埋める', () => {
    const rp: RoadPath = {
      pts: resamplePath([{ x: 0, z: 0 }, { x: 300, z: 400 }], false),
      w: 20, major: true, loop: false,
    };
    const terrain = mkTerrain('BAKE');
    bakeRoadHeights([rp], terrain);
    for (const p of rp.pts) {
      expect(Math.hypot(p.dx, p.dz)).toBeCloseTo(1, 6);
      expect(p.h).toBeCloseTo(terrain.h(p.x, p.z), 6);
      expect(Number.isFinite(p.hs)).toBe(true);
    }
  });
});

describe('genRoadLines', () => {
  it('両端にメジャー道路があり、座標が昇順', () => {
    const lines = genRoadLines(mulberry32(7), 2500);
    expect(lines[0]).toEqual({ c: -2500, w: 30, major: true });
    expect(lines[lines.length - 1]).toEqual({ c: 2500, w: 30, major: true });
    for (let i = 1; i < lines.length; i++) expect(lines[i].c).toBeGreaterThan(lines[i - 1].c);
  });
});
