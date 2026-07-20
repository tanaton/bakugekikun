// 爆撃AIの目標選定・武器抽選・方位名の単体テスト(randを注入して決定的に検証)

import { describe, expect, it } from 'vitest';
import { MAP_HALF } from '../src/core/config';
import { dangerRadius, dirName, pickTarget, pickWeapon } from '../src/game/bomberAi';
import { difficultyAt } from '../src/game/difficulty';
import { WEAPONS } from '../src/game/weapons';

// 指定した値を順に返す乱数(尽きたら0.5)
const seq = (...vals: number[]): (() => number) => {
  let i = 0;
  return () => (i < vals.length ? vals[i++] : 0.5);
};

describe('dangerRadius', () => {
  it('単弾頭=爆発半径、クラスター=散布+子弾半径、核=420', () => {
    expect(dangerRadius(WEAPONS[0])).toBe(105);
    expect(dangerRadius(WEAPONS[1])).toBe(175 + 55);
    expect(dangerRadius(WEAPONS[2])).toBe(420);
  });
});

describe('pickTarget', () => {
  it('偏差射撃は移動先の予測点を狙う(散布0なら vel*warnT*lead ぴったり)', () => {
    // rand: [分岐<0.6, 散布量0, 散布角]。t=0なのでlead=0.5
    const t = pickTarget(100, 200, 10, -6, 5, 0, false, seq(0, 0, 0));
    expect(t.x).toBeCloseTo(100 + 10 * 5 * 0.5, 10);
    expect(t.z).toBeCloseTo(200 - 6 * 5 * 0.5, 10);
  });

  it('難易度が進むと予測が鋭くなる(t=480でlead=0.9)', () => {
    const t = pickTarget(0, 0, 10, 0, 4, 480, false, seq(0, 0, 0));
    expect(t.x).toBeCloseTo(10 * 4 * 0.9, 10);
  });

  it('偏差射撃の散布は上限半径内(t=0で150m)', () => {
    for (let i = 0; i < 200; i++) {
      const t = pickTarget(0, 0, 0, 0, 5, 0, false, seq(0, Math.random(), Math.random()));
      expect(Math.hypot(t.x, t.z)).toBeLessThanOrEqual(150 + 1e-9);
    }
  });

  it('退路潰しはプレイヤー周囲60〜300m', () => {
    for (let i = 0; i < 200; i++) {
      const t = pickTarget(500, -500, 0, 0, 5, 0, false, seq(0.99, Math.random(), Math.random()));
      const d = Math.hypot(t.x - 500, t.z + 500);
      expect(d).toBeGreaterThanOrEqual(60 - 1e-9);
      expect(d).toBeLessThanOrEqual(300 + 1e-9);
    }
  });

  it('核は予測点から必ず240m以上ずれる(静止時=プレイヤーから240m以上)', () => {
    for (let i = 0; i < 200; i++) {
      const t = pickTarget(0, 0, 0, 0, 10, 300, true, seq(Math.random(), Math.random()));
      const d = Math.hypot(t.x, t.z);
      expect(d).toBeGreaterThanOrEqual(240 - 1e-9);
      expect(d).toBeLessThanOrEqual(400 + 1e-9);
    }
  });

  it('目標は必ずマップ内にクランプされる', () => {
    for (let i = 0; i < 100; i++) {
      const t = pickTarget(MAP_HALF, MAP_HALF, 200, 200, 6, 480, i % 2 === 0);
      expect(Math.abs(t.x)).toBeLessThanOrEqual(MAP_HALF);
      expect(Math.abs(t.z)).toBeLessThanOrEqual(MAP_HALF);
    }
  });
});

describe('pickWeapon', () => {
  const late = difficultyAt(9999);   // single .45 / cluster .35 / nuke .20

  it('抽選重みどおりに選ばれる(核許可時)', () => {
    expect(pickWeapon(late, true, seq(0.1)).id).toBe('nuke');
    expect(pickWeapon(late, true, seq(0.19)).id).toBe('nuke');
    expect(pickWeapon(late, true, seq(0.3)).id).toBe('cluster');
    expect(pickWeapon(late, true, seq(0.9)).id).toBe('single');
  });

  it('核クールダウン中は核が絶対に出ない', () => {
    for (let i = 0; i < 100; i++) {
      expect(pickWeapon(late, false).id).not.toBe('nuke');
    }
  });

  it('序盤は単弾頭のみ', () => {
    const early = difficultyAt(0);
    for (let i = 0; i < 50; i++) expect(pickWeapon(early, true).id).toBe('single');
  });
});

describe('dirName', () => {
  it('8方位が正しい(マップ座標系: +x=東, -z=北)', () => {
    expect(dirName(0, -1)).toBe('北');
    expect(dirName(1, -1)).toBe('北東');
    expect(dirName(1, 0)).toBe('東');
    expect(dirName(1, 1)).toBe('南東');
    expect(dirName(0, 1)).toBe('南');
    expect(dirName(-1, 1)).toBe('南西');
    expect(dirName(-1, 0)).toBe('西');
    expect(dirName(-1, -1)).toBe('北西');
  });
});
