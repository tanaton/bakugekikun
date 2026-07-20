// ダッシュのスタミナ制(updateStamina)の単体テスト

import { describe, expect, it } from 'vitest';
import {
  DASH_MULT, DASH_UNLOCK, STAMINA_MAX, updateStamina, type PlayerState,
} from '../src/game/player';

const mkPlayer = (stamina = STAMINA_MAX, exhausted = false): PlayerState => ({
  x: 0, z: 0, y: 0, yaw: 0, vx: 0, vz: 0, hp: 100,
  stamina, exhausted, animT: 0, speed01: 0,
});

// dtを刻んでsecs秒ぶん進める。ダッシュできた時間を返す
function run(p: PlayerState, wantDash: boolean, secs: number, dt = 0.016): number {
  let dashed = 0;
  for (let t = 0; t < secs; t += dt) {
    if (updateStamina(p, wantDash, dt)) dashed += dt;
  }
  return dashed;
}

describe('updateStamina', () => {
  it('ダッシュ倍率は2倍', () => {
    expect(DASH_MULT).toBe(2.0);
  });

  it('満タンからの連続ダッシュは約4秒で尽き、回復までの間は通常速度に戻る', () => {
    const p = mkPlayer();
    const dt = 0.016;
    // 最初の連続ダッシュ時間
    let first = 0;
    while (updateStamina(p, true, dt)) first += dt;
    expect(first).toBeGreaterThan(3.5);
    expect(first).toBeLessThan(4.5);
    expect(p.exhausted).toBe(true);
    // 押しっぱなしでも、DASH_UNLOCKまで回復する約2秒間はダッシュできない
    let gap = 0;
    while (!updateStamina(p, true, dt)) gap += dt;
    expect(gap).toBeGreaterThan(1.5);
    // 回復後は再びダッシュが始まる(押しっぱなしなら周期的なバースト走行になる)
    expect(p.exhausted).toBe(false);
  });

  it('ダッシュしなければ回復し、上限でクランプされる', () => {
    const p = mkPlayer(50);
    run(p, false, 60);
    expect(p.stamina).toBe(STAMINA_MAX);
  });

  it('スタミナ切れ後はDASH_UNLOCKまで回復するまでダッシュ不可(ヒステリシス)', () => {
    const p = mkPlayer(0, true);
    // 回復途中(UNLOCK未満)はダッシュ入力しても不可のまま回復が続く
    while (p.stamina < DASH_UNLOCK - 1) {
      expect(updateStamina(p, true, 0.016)).toBe(false);
    }
    // UNLOCK到達後はダッシュ再開できる
    run(p, false, 0.2);
    expect(p.stamina).toBeGreaterThanOrEqual(DASH_UNLOCK);
    expect(updateStamina(p, true, 0.016)).toBe(true);
    expect(p.exhausted).toBe(false);
  });

  it('切れていなければ途中からでもダッシュでき、消費と回復が対称に働く', () => {
    const p = mkPlayer(50);
    expect(updateStamina(p, true, 0.016)).toBe(true);
    expect(p.stamina).toBeLessThan(50);
    const after = p.stamina;
    updateStamina(p, false, 0.016);
    expect(p.stamina).toBeGreaterThan(after);
  });
});
