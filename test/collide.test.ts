// 円と回転矩形の押し出し(pushOutOfRect)の単体テスト

import { describe, expect, it } from 'vitest';
import { pushOutOfRect, type RectObstacle } from '../src/core/collide';

const rect = (x: number, z: number, sx: number, sz: number, rot = 0): RectObstacle =>
  ({ x, z, sx, sz, rot });

describe('pushOutOfRect', () => {
  it('離れていればnull', () => {
    expect(pushOutOfRect(100, 0, 1, rect(0, 0, 20, 20))).toBeNull();
    expect(pushOutOfRect(11.01, 0, 1, rect(0, 0, 20, 20))).toBeNull();   // ぎりぎり外
  });

  it('辺への接触は法線方向へ半径ぶん押し出す', () => {
    // 矩形(±10)の右辺に半径1の円が食い込む
    const out = pushOutOfRect(10.5, 0, 1, rect(0, 0, 20, 20))!;
    expect(out.x).toBeCloseTo(11, 10);
    expect(out.z).toBeCloseTo(0, 10);
    // 下辺(+z側)
    const out2 = pushOutOfRect(0, 10.2, 1, rect(0, 0, 20, 20))!;
    expect(out2.x).toBeCloseTo(0, 10);
    expect(out2.z).toBeCloseTo(11, 10);
  });

  it('角は斜め方向へ押し出され、角からの距離が半径になる', () => {
    const out = pushOutOfRect(10.3, 10.3, 1, rect(0, 0, 20, 20))!;
    expect(Math.hypot(out.x - 10, out.z - 10)).toBeCloseTo(1, 10);
    expect(out.x).toBeGreaterThan(10);
    expect(out.z).toBeGreaterThan(10);
  });

  it('矩形内部に完全に入ったら貫通の浅い軸の面から出る', () => {
    // 中心より右に寄っている → +x面へ
    const out = pushOutOfRect(6, 1, 1, rect(0, 0, 20, 20))!;
    expect(out.x).toBeCloseTo(11, 10);
    expect(out.z).toBeCloseTo(1, 10);
    // 中心より下に寄っている → +z面へ
    const out2 = pushOutOfRect(1, -6, 1, rect(0, 0, 20, 20))!;
    expect(out2.x).toBeCloseTo(1, 10);
    expect(out2.z).toBeCloseTo(-11, 10);
  });

  it('回転矩形でも押し出し後は非接触になる', () => {
    for (const rot of [0.3, Math.PI / 4, 1.2, -0.7]) {
      const b = rect(5, -3, 16, 8, rot);
      for (const [px, pz] of [[5, -3], [9, -3], [5, 1], [11, 2]] as const) {
        const out = pushOutOfRect(px, pz, 1.5, b);
        if (out) {
          expect(pushOutOfRect(out.x, out.z, 1.499, b)).toBeNull();
        }
      }
    }
  });

  it('回転90°の矩形は軸入れ替えと一致する', () => {
    // sx=20,sz=6 を90°回すと、世界座標ではx方向に±3
    const out = pushOutOfRect(3.5, 0, 1, rect(0, 0, 20, 6, Math.PI / 2));
    expect(out).not.toBeNull();
    expect(Math.abs(out!.x)).toBeCloseTo(4, 10);
  });
});
