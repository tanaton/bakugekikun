import { describe, expect, it } from 'vitest';
import { mulberry32, pick, rngFor, xfnv1a } from '../src/core/rng';

// 既知解テスト: この値が変わる = 実装が変わり全シードの街が変わる。
// 意図的に変更する場合のみ期待値を更新すること
describe('xfnv1a', () => {
  it('既知のハッシュ値を返す', () => {
    expect(xfnv1a('BAKUGEKI-01')).toBe(3404842772);
    expect(xfnv1a('')).toBe(2166136261);
  });
});

describe('mulberry32', () => {
  it('既知の乱数列を返す', () => {
    const r = mulberry32(xfnv1a('BAKUGEKI-01'));
    expect(r()).toBeCloseTo(0.43973140395246446, 15);
    expect(r()).toBeCloseTo(0.14317703410051763, 15);
    expect(r()).toBeCloseTo(0.4947870774194598, 15);
    expect(r()).toBeCloseTo(0.9309040908701718, 15);
    expect(r()).toBeCloseTo(0.12463278556242585, 15);
  });

  it('全出力が[0,1)に収まる', () => {
    const r = mulberry32(12345);
    for (let i = 0; i < 10000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('rngFor', () => {
  it('同じ(シード, ストリーム)で同じ列', () => {
    const a = rngFor('SEED', 'plan'), b = rngFor('SEED', 'plan');
    for (let i = 0; i < 100; i++) expect(a()).toBe(b());
  });

  it('ストリームが違えば別の列', () => {
    const a = rngFor('SEED', 'plan'), b = rngFor('SEED', 'trees');
    const av = Array.from({ length: 10 }, () => a());
    const bv = Array.from({ length: 10 }, () => b());
    expect(av).not.toEqual(bv);
  });
});

describe('pick', () => {
  it('rngの値に応じた要素を返す', () => {
    const arr = ['a', 'b', 'c', 'd'];
    expect(pick(arr, () => 0)).toBe('a');
    expect(pick(arr, () => 0.999999)).toBe('d');
    expect(pick(arr, () => 0.5)).toBe('c');
  });
});
