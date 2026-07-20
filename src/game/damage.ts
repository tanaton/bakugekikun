// 逃走モードの被弾ダメージ式(純関数)

export const PLAYER_MAX_HP = 100;

// 即死圏の半径比。通常弾は爆心35%以内、核は50%以内が即死
const CORE_RATIO = 0.35, CORE_RATIO_NUKE = 0.5;
const LETHAL = 250;   // 即死ダメージ(最大HPを大きく超える値)

// 爆発中心からの距離 → ダメージ。即死圏の外は外縁0までべき乗で減衰する。
// 通常弾のピークは0.9R(単弾頭R=105で約95、クラスター子弾R=55で約50)、
// 核は即死圏外なら最大100 → 外縁0(=予告円の外縁側にいれば生き残れる)
export function explosionDamage(dist: number, R: number, nuke: boolean): number {
  if (dist > R) return 0;
  const core = R * (nuke ? CORE_RATIO_NUKE : CORE_RATIO);
  if (dist <= core) return LETHAL;
  const k = (dist - core) / (R - core);
  return nuke ? 100 * Math.pow(1 - k, 1.3) : 0.9 * R * Math.pow(1 - k, 1.6);
}
