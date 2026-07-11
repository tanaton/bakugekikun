import { describe, expect, it } from 'vitest';
import { MAP_HALF } from '../src/core/config';
import { rngFor } from '../src/core/rng';
import { generateFeatures, shorePts, SPAN_OFFS, Terrain, waterPen } from '../src/core/terrain';
import { mkTerrain } from './helpers';

const SEEDS = ['BAKUGEKI-01', 'CITY-00001', 'CITY-12345', 'TOKYO', 'a', 'ながいシード文字列'];

describe('Terrain', () => {
  it('全域でNaN/Infinityが出ない', () => {
    for (const seed of SEEDS) {
      const t = mkTerrain(seed);
      for (let x = -MAP_HALF; x <= MAP_HALF; x += 270) {
        for (let z = -MAP_HALF; z <= MAP_HALF; z += 270) {
          expect(Number.isFinite(t.h(x, z))).toBe(true);
        }
      }
    }
  });

  it('水域では地形が水面レベル(-12)に平坦化される', () => {
    for (const seed of SEEDS) {
      const feats = generateFeatures(rngFor(seed, 'features'));
      const t = new Terrain(feats, rngFor(seed, 'terrain'));
      for (const f of feats.feats) {
        if (f.type !== 'r') continue;
        // 水域の深部(侵入量が十分大きい点)を探して検査
        const center = f.kind === 'disc'
          ? { x: f.x, z: f.z }
          : (f.axis === 'x' ? { x: f.side * 2500, z: 0 } : { x: 0, z: f.side * 2500 });
        if (waterPen(f, center.x, center.z) > 50) {
          expect(t.inWater(center.x, center.z)).toBe(true);
          expect(t.h(center.x, center.z)).toBeCloseTo(-12, 5);
        }
      }
    }
  });

  it('groundSpanは敷地サンプル点の最高点と最低点', () => {
    const t = mkTerrain('GL');
    const g = t.groundSpan(100, 200, 30, 40);
    expect(g.top).toBeGreaterThanOrEqual(g.bottom);
    // すべてのサンプル点がtopとbottomの間に入る
    for (const [ox, oz] of SPAN_OFFS) {
      const h = t.h(100 + ox * 15, 200 + oz * 20);
      expect(g.top).toBeGreaterThanOrEqual(h - 1e-9);
      expect(g.bottom).toBeLessThanOrEqual(h + 1e-9);
    }
  });

  it('groundSpanは敷地の回転に追従する(90度回転=寸法の入れ替え)', () => {
    const t = mkTerrain('GL');
    const a = t.groundSpan(100, 200, 30, 40, Math.PI / 2);
    const b = t.groundSpan(100, 200, 40, 30, 0);
    expect(a.top).toBeCloseTo(b.top, 6);
    expect(a.bottom).toBeCloseTo(b.bottom, 6);
  });

  it('shorePtsのinsetは岸線を陸側へ張り出させる(水面より外)', () => {
    for (const seed of SEEDS) {
      const feats = generateFeatures(rngFor(seed, 'features'));
      for (const f of feats.feats) {
        if (f.type !== 'r') continue;
        const water = shorePts(f, 0);
        const bank = shorePts(f, 14);
        expect(water.length).toBe(bank.length);
        for (let i = 0; i < water.length; i++) {
          // inset付きの点は水面側から見てより陸寄り = waterPenが小さい
          expect(waterPen(f, bank[i].x, bank[i].z)).toBeLessThan(
            waterPen(f, water[i].x, water[i].z) + 1e-9);
        }
      }
    }
  });

  it('山と水のフィーチャは重ならない', () => {
    for (const seed of SEEDS) {
      const { feats } = generateFeatures(rngFor(seed, 'features'));
      const t = new Terrain({ cityCore: { x: 0, z: 0 }, cityHouseTh: 0.6, feats }, rngFor(seed, 'terrain'));
      // 山の内部が同時に水面でないこと(粗いグリッド走査)
      for (let x = -MAP_HALF; x <= MAP_HALF; x += 180) {
        for (let z = -MAP_HALF; z <= MAP_HALF; z += 180) {
          if (t.inMountain(x, z)) expect(t.inWater(x, z)).toBe(false);
        }
      }
    }
  });
});
