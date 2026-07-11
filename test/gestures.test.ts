// タッチジェスチャー状態機械(タップ/回転/ピンチ)の単体テスト

import { describe, expect, it } from 'vitest';
import { createGestureTracker, TAP_MS, TAP_SLOP } from '../src/ui/gestures';

describe('createGestureTracker', () => {
  it('slop内・時間内に離すとタップが成立する', () => {
    const t = createGestureTracker();
    t.down(1, 100, 100, 0);
    expect(t.move(1, 104, 102)).toBeNull();   // slop内の揺れはジェスチャーなし
    expect(t.up(1, 104, 102, TAP_MS - 1)).toBe(true);
  });

  it('slopを超えたらrotateになり、以後タップは成立しない', () => {
    const t = createGestureTracker();
    t.down(1, 100, 100, 0);
    const g = t.move(1, 100 + TAP_SLOP + 20, 100);
    expect(g).toEqual({ kind: 'rotate', dx: TAP_SLOP + 20, dy: 0 });
    // 押下点付近へ戻して素早く離してもタップにならない
    expect(t.move(1, 101, 100)).toEqual({ kind: 'rotate', dx: -(TAP_SLOP + 19), dy: 0 });
    expect(t.up(1, 101, 100, 50)).toBe(false);
  });

  it('長押しはタップにならない', () => {
    const t = createGestureTracker();
    t.down(1, 100, 100, 0);
    expect(t.up(1, 100, 100, TAP_MS + 1)).toBe(false);
  });

  it('2本指の距離変化がピンチのscaleとして返る', () => {
    const t = createGestureTracker();
    t.down(1, 100, 100, 0);
    t.down(2, 200, 100, 10);        // 距離100
    expect(t.move(1, 50, 100)).toEqual({ kind: 'pinch', scale: 1.5 });   // 距離150
    expect(t.move(2, 350, 100)).toEqual({ kind: 'pinch', scale: 2 });    // 距離300
  });

  it('2本目が触れた時点でタップ候補は破棄される', () => {
    const t = createGestureTracker();
    t.down(1, 100, 100, 0);
    t.down(2, 110, 100, 10);
    expect(t.up(2, 110, 100, 20)).toBe(false);
    expect(t.up(1, 100, 100, 30)).toBe(false);
  });

  it('ピンチから1本離すと残った指の位置を基準にrotateへ復帰する(座標飛びなし)', () => {
    const t = createGestureTracker();
    t.down(1, 100, 100, 0);
    t.down(2, 200, 100, 10);
    t.move(1, 60, 100);
    expect(t.up(2, 200, 100, 500)).toBe(false);
    // 最初のmoveの差分は復帰時点の位置(60,100)から測られる
    expect(t.move(1, 70, 110)).toEqual({ kind: 'rotate', dx: 10, dy: 10 });
  });

  it('cancel後はタップにならず、次のdownから正常に動く', () => {
    const t = createGestureTracker();
    t.down(1, 100, 100, 0);
    t.cancel(1);
    expect(t.move(1, 105, 100)).toBeNull();
    expect(t.up(1, 100, 100, 50)).toBe(false);
    t.down(1, 300, 300, 100);
    expect(t.up(1, 300, 300, 200)).toBe(true);
  });

  it('追跡していないポインタ(canvas外で始まった指)は無視する', () => {
    const t = createGestureTracker();
    t.down(1, 100, 100, 0);
    expect(t.move(99, 500, 500)).toBeNull();
    expect(t.up(99, 500, 500, 50)).toBe(false);
    // 無関係なup/moveの後でも本来のタップは成立する
    expect(t.up(1, 100, 100, 100)).toBe(true);
  });
});
