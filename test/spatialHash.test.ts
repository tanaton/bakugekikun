import { describe, expect, it } from 'vitest';
import { GRID_CELL, MAP_HALF } from '../src/core/config';
import { mulberry32 } from '../src/core/rng';
import { SpatialHash } from '../src/core/spatialHash';

interface Pt { x: number; z: number }

describe('SpatialHash', () => {
  it('forEachNearは半径r内の全要素を必ず含む(総当たりと一致)', () => {
    const rng = mulberry32(42);
    const hash = new SpatialHash<Pt>();
    const pts: Pt[] = [];
    for (let i = 0; i < 3000; i++) {
      const p = { x: (rng() * 2 - 1) * MAP_HALF, z: (rng() * 2 - 1) * MAP_HALF };
      pts.push(p);
      hash.insert(p.x, p.z, p);
    }
    // セル境界前後を重点的に(r = GRID_CELL近傍)
    for (const r of [10, GRID_CELL - 1, GRID_CELL, GRID_CELL + 1, GRID_CELL * 2.5]) {
      for (let q = 0; q < 30; q++) {
        const qx = (rng() * 2 - 1) * MAP_HALF, qz = (rng() * 2 - 1) * MAP_HALF;
        const brute = pts.filter(p => Math.hypot(p.x - qx, p.z - qz) <= r);
        const got = new Set<Pt>();
        hash.forEachNear(qx, qz, r, p => got.add(p));
        // ハッシュはセル単位の粗い候補集合なので、真の近傍をすべて含んでいればよい
        for (const p of brute) expect(got.has(p)).toBe(true);
      }
    }
  });

  it('同一セルへの複数登録が全て走査される', () => {
    const hash = new SpatialHash<Pt>();
    const a = { x: 0, z: 0 }, b = { x: 1, z: 1 };
    hash.insert(a.x, a.z, a);
    hash.insert(b.x, b.z, b);
    const got: Pt[] = [];
    hash.forEachNear(0, 0, 5, p => got.push(p));
    expect(got).toContain(a);
    expect(got).toContain(b);
  });
});
