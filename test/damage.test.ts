// 被弾ダメージ式(explosionDamage)の単体テスト

import { describe, expect, it } from 'vitest';
import { explosionDamage, PLAYER_MAX_HP } from '../src/game/damage';

describe('explosionDamage', () => {
  it('半径の外は0', () => {
    expect(explosionDamage(106, 105, false)).toBe(0);
    expect(explosionDamage(421, 420, true)).toBe(0);
    expect(explosionDamage(1e6, 105, false)).toBe(0);
  });

  it('即死圏(通常0.35R・核0.5R)は最大HPを超えるダメージ', () => {
    expect(explosionDamage(0, 105, false)).toBeGreaterThan(PLAYER_MAX_HP);
    expect(explosionDamage(105 * 0.35, 105, false)).toBeGreaterThan(PLAYER_MAX_HP);
    expect(explosionDamage(420 * 0.5, 420, true)).toBeGreaterThan(PLAYER_MAX_HP);
  });

  it('即死圏の外では距離に対して単調減少', () => {
    for (const [R, nuke] of [[105, false], [55, false], [420, true]] as const) {
      let prev = Infinity;
      const core = R * (nuke ? 0.5 : 0.35);
      for (let d = core + 0.1; d <= R; d += (R - core) / 50) {
        const v = explosionDamage(d, R, nuke);
        expect(v).toBeLessThanOrEqual(prev);
        prev = v;
      }
    }
  });

  it('外縁でほぼ0(かすり傷)', () => {
    expect(explosionDamage(104.9, 105, false)).toBeLessThan(1);
    expect(explosionDamage(54.9, 55, false)).toBeLessThan(1);
    expect(explosionDamage(419.9, 420, true)).toBeLessThan(1);
  });

  it('クラスター子弾(R=55)は直撃でも一撃死しない', () => {
    const worst = explosionDamage(55 * 0.35 + 0.01, 55, false);
    expect(worst).toBeLessThan(PLAYER_MAX_HP);
    expect(worst).toBeGreaterThan(30);   // それでも痛い
  });

  it('核は即死圏の外なら一撃死しない(予告円の外縁側へ逃げれば生存可能)', () => {
    const worst = explosionDamage(420 * 0.5 + 0.01, 420, true);
    expect(worst).toBeLessThanOrEqual(PLAYER_MAX_HP);
  });
});
