// 車の走行(道路パスに沿う)

import { carPose } from '../core/roads';
import type { World } from './world';

export function updateCars(world: World, dt: number): void {
  const { city, view } = world;
  // Y軸回転+平行移動のみなので行列要素を直接書く(Euler→行列変換とsetMatrixAtのコピーを回避)。
  // 残りの要素は生成時の単位行列のまま変わらない
  const carMesh = view.carMesh;
  const arr = carMesh.instanceMatrix.array as Float32Array;
  for (let ci = 0; ci < city.movingCars; ci++) {   // 先頭movingCars台だけが走行車両(以降は駐車車両で不変)
    const c = city.cars[ci];
    if (c.parked || !c.alive) continue;
    c.s += c.speed * c.dir * dt;
    const p = carPose(city.roadPaths[c.road], c.s);
    const px = p.x + p.dz * c.lane, pz = p.z - p.dx * c.lane;   // 進行方向の横にレーンオフセット
    c.px = px; c.pz = pz;   // destroyAroundの被弾判定用にキャッシュ(carPoseの再計算を避ける)
    const hx = p.dx * c.dir, hz = p.dz * c.dir;   // 正規化済みの進行方向
    const o = c.i * 16;
    arr[o] = hx;      arr[o + 2] = hz;
    arr[o + 8] = -hz; arr[o + 10] = hx;
    arr[o + 12] = px;
    arr[o + 13] = p.h + p.hs * c.lane + 1.1;   // 事前計算した路面高+横断勾配
    arr[o + 14] = pz;
  }
  // 毎フレーム変わるのは走行車両の領域だけ。駐車車両ぶんのGPU転送を省く
  // (updateRangesはアップロード後に自動クリアされるので毎フレーム指定し直す)
  carMesh.instanceMatrix.addUpdateRange(0, city.movingCars * 16);
  carMesh.instanceMatrix.needsUpdate = true;
}
