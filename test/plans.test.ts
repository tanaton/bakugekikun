import { describe, expect, it } from 'vitest';
import { meanderOffset } from '../src/core/plans';
import { mulberry32 } from '../src/core/rng';

describe('meanderOffset(遊歩道の蛇行)', () => {
  it('端で0に収束し、振幅上限と傾き上限を守り、同シードで決定的', () => {
    for (let s = 0; s < 20; s++) {
      const len = 100 + s * 37, cap = 8 + (s % 5) * 6;
      const off = meanderOffset(mulberry32(s * 1013 + 1), len, cap);
      const off2 = meanderOffset(mulberry32(s * 1013 + 1), len, cap);
      expect(off(0)).toBeCloseTo(0, 12);   // env(0)=0(×負のsinで-0になりうる)
      expect(off(1)).toBeCloseTo(0, 10);
      let prev = 0;
      for (let i = 1; i <= 400; i++) {
        const t = i / 400;
        const v = off(t);
        expect(Math.abs(v)).toBeLessThanOrEqual(cap + 1e-9);
        // 傾き上限 = 正弦波の傾き予算0.55 + 端のエンベロープ立ち上がり分(≈0.58)
        expect(Math.abs(v - prev) / (len / 400)).toBeLessThanOrEqual(1.2);
        expect(off2(t)).toBe(v);   // 決定性
        prev = v;
      }
    }
  });

  it('シードが違えば違う形になる', () => {
    const a = meanderOffset(mulberry32(1), 200, 30);
    const b = meanderOffset(mulberry32(2), 200, 30);
    let differs = false;
    for (let i = 1; i < 10; i++) if (Math.abs(a(i / 10) - b(i / 10)) > 0.5) differs = true;
    expect(differs).toBe(true);
  });
});
