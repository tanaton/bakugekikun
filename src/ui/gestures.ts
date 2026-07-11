// タッチジェスチャー判定(タップ/回転ドラッグ/ピンチ)。DOM非依存の状態機械でnodeテスト可能にする

export const TAP_SLOP = 10;   // px — 押下点からこの距離を超えたらタップ候補を破棄してドラッグ扱い
export const TAP_MS = 300;    // ms — この時間以内に離した場合のみタップ成立

export type Gesture =
  | { kind: 'rotate'; dx: number; dy: number }
  | { kind: 'pinch'; scale: number };       // 直前move時点との2点間距離の比

export interface GestureTracker {
  down(id: number, x: number, y: number, t: number): void;
  move(id: number, x: number, y: number): Gesture | null;
  up(id: number, x: number, y: number, t: number): boolean;   // タップ成立ならtrue
  cancel(id: number): void;
}

export function createGestureTracker(): GestureTracker {
  const pts = new Map<number, { x: number; y: number }>();
  let mode: 'idle' | 'tap' | 'drag' | 'pinch' = 'idle';
  let startX = 0, startY = 0, startT = 0;   // タップ判定の基準(1本目のdown)
  let lastX = 0, lastY = 0;                 // rotateの差分基準
  let pinchDist = 0;                        // 直前move時点の2点間距離
  // moveは毎イベント呼ばれるので戻り値は使い回す(呼び出し側はその場で消費するだけ)
  const rotateG = { kind: 'rotate' as const, dx: 0, dy: 0 };
  const pinchG = { kind: 'pinch' as const, scale: 1 };

  // ピンチはptsの先頭2本(Mapの挿入順)で測る。3本目以降は座標追跡のみ
  const pinchLen = (): number => {
    const [a, b] = pts.values();
    return Math.hypot(a.x - b.x, a.y - b.y);
  };

  // 指が1本離れたときの状態遷移(up/cancel共通)
  function release(id: number): void {
    if (!pts.delete(id)) return;
    if (mode === 'pinch') {
      if (pts.size >= 2) {
        pinchDist = pinchLen();   // ペアが入れ替わるので距離を取り直す
      } else if (pts.size === 1) {
        // 残った指の位置を差分基準に取り直してドラッグへ復帰(カメラ飛び防止)
        const [p] = pts.values();
        mode = 'drag'; lastX = p.x; lastY = p.y;
      } else {
        mode = 'idle';
      }
    } else if (pts.size === 0) {
      mode = 'idle';
    }
  }

  return {
    down(id, x, y, t) {
      pts.set(id, { x, y });
      if (pts.size === 1) {
        mode = 'tap';
        startX = lastX = x; startY = lastY = y; startT = t;
      } else if (pts.size === 2) {
        mode = 'pinch';   // 2本目が触れたらタップ候補は破棄
        pinchDist = pinchLen();
      }
    },
    move(id, x, y) {
      const p = pts.get(id);
      if (!p) return null;   // canvas外で始まったポインタ(ジョイスティック等)は無視
      p.x = x; p.y = y;
      if (mode === 'pinch') {
        const [a, b] = pts.keys();
        if (id !== a && id !== b) return null;
        const d = pinchLen();
        if (pinchDist < 1 || d < 1) return null;   // 距離比が発散する近接は捨てる
        pinchG.scale = d / pinchDist;
        pinchDist = d;
        return pinchG;
      }
      if (mode === 'tap') {
        if (Math.hypot(x - startX, y - startY) <= TAP_SLOP) return null;
        mode = 'drag';
      }
      if (mode === 'drag') {
        rotateG.dx = x - lastX; rotateG.dy = y - lastY;
        lastX = x; lastY = y;
        return rotateG;
      }
      return null;
    },
    up(id, x, y, t) {
      const isTap = mode === 'tap' && pts.has(id)
        && t - startT <= TAP_MS && Math.hypot(x - startX, y - startY) <= TAP_SLOP;
      release(id);
      return isTap;
    },
    cancel(id) { release(id); },
  };
}
