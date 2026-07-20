// 円と回転矩形の衝突押し出し(逃走モードのプレイヤーと建物の当たり判定)

import { clamp, lotToWorld } from './math';
import type { Vec2 } from './types';

// 建物(Building)のフットプリントと互換の回転矩形
export interface RectObstacle { x: number; z: number; sx: number; sz: number; rot: number }

// 円(中心px,pz 半径r)を矩形の外へ押し出した新しい中心を返す。非接触ならnull。
// 矩形ローカル系(lotToWorldの逆変換)で最近点を求め、法線方向へ半径ぶん離す。
// 円中心が矩形内部に完全に入った場合は貫通の浅い軸の面まで押し出す
export function pushOutOfRect(px: number, pz: number, r: number, b: RectObstacle): Vec2 | null {
  const c = Math.cos(b.rot), s = Math.sin(b.rot);
  const dx = px - b.x, dz = pz - b.z;
  const lx = dx * c - dz * s, lz = dx * s + dz * c;
  const hx = b.sx / 2, hz = b.sz / 2;
  if (Math.abs(lx) >= hx + r || Math.abs(lz) >= hz + r) return null;   // 早期棄却
  const nx = clamp(lx, -hx, hx), nz = clamp(lz, -hz, hz);   // 円中心への最近点
  let ox: number, oz: number;   // ローカル系での押し出し後の円中心
  if (nx === lx && nz === lz) {
    const penX = hx - Math.abs(lx), penZ = hz - Math.abs(lz);
    if (penX <= penZ) { ox = lx >= 0 ? hx + r : -hx - r; oz = lz; }
    else { ox = lx; oz = lz >= 0 ? hz + r : -hz - r; }
  } else {
    const ddx = lx - nx, ddz = lz - nz;
    const d = Math.hypot(ddx, ddz);
    if (d >= r) return null;
    ox = nx + ddx / d * r; oz = nz + ddz / d * r;
  }
  return lotToWorld(b.x, b.z, b.rot, ox, oz);
}
