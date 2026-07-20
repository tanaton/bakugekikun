// 難易度カーブ(difficultyAt)の単体テスト

import { describe, expect, it } from 'vitest';
import { difficultyAt } from '../src/game/difficulty';

describe('difficultyAt', () => {
  it('開始時は単弾頭のみ・同時1発', () => {
    const d = difficultyAt(0);
    expect(d.maxConcurrent).toBe(1);
    expect(d.wSingle).toBe(1);
    expect(d.wCluster).toBe(0);
    expect(d.wNuke).toBe(0);
  });

  it('テーブル行の値がそのまま返る', () => {
    const d = difficultyAt(120);
    expect(d.warnT).toBeCloseTo(4.5, 10);
    expect(d.interval).toBeCloseTo(2.5, 10);
    expect(d.maxConcurrent).toBe(3);
    expect(d.wCluster).toBeCloseTo(0.35, 10);
  });

  it('行間は線形補間される', () => {
    const d = difficultyAt(90);   // 60と120の中間
    expect(d.warnT).toBeCloseTo((5.0 + 4.5) / 2, 10);
    expect(d.interval).toBeCloseTo((3.0 + 2.5) / 2, 10);
  });

  it('終盤以降は一定(warnT下限2.5・interval下限0.9)', () => {
    for (const t of [480, 1000, 99999]) {
      const d = difficultyAt(t);
      expect(d.warnT).toBeCloseTo(2.5, 10);
      expect(d.interval).toBeCloseTo(0.9, 10);
      expect(d.maxConcurrent).toBe(6);
      expect(d.wNuke).toBeCloseTo(0.2, 10);
    }
  });

  it('重みの和は常に1', () => {
    for (let t = 0; t <= 600; t += 7) {
      const d = difficultyAt(t);
      expect(d.wSingle + d.wCluster + d.wNuke).toBeCloseTo(1, 10);
    }
  });

  it('時間経過で厳しくなる(warnT/intervalは非増加、同時数は非減少)', () => {
    let prev = difficultyAt(0);
    for (let t = 10; t <= 600; t += 10) {
      const d = difficultyAt(t);
      expect(d.warnT).toBeLessThanOrEqual(prev.warnT);
      expect(d.interval).toBeLessThanOrEqual(prev.interval);
      expect(d.maxConcurrent).toBeGreaterThanOrEqual(prev.maxConcurrent);
      prev = d;
    }
  });
});
