// 車の走行(道路パスに沿う)

import { ROAD_STEP } from '../core/config';
import { carPose, laneOffset } from '../core/roads';
import { flushRange } from '../render/instanced';
import type { World } from './world';

export function updateCars(world: World, dt: number): void {
  const { city, view } = world;
  // Y軸回転+平行移動のみなので行列要素を直接書く(Euler→行列変換とsetMatrixAtのコピーを回避)。
  // 残りの要素は生成時の単位行列のまま変わらない
  const carMesh = view.carMesh;
  const arr = carMesh.instanceMatrix.array as Float32Array;
  let minAlive = -1, maxAlive = -1;   // 生存する走行車両のインデックス範囲(転送範囲を生存分に絞る)
  for (let ci = 0; ci < city.movingCars; ci++) {   // 先頭movingCars台だけが走行車両(以降は駐車車両で不変)
    const c = city.cars[ci];
    if (c.parked || !c.alive) continue;
    if (minAlive < 0) minAlive = ci;
    maxAlive = ci;
    c.s += c.speed * c.dir * dt;
    const road = city.roadPaths[c.road];
    if (!road.loop) {   // 行き止まりでは反対端へワープせず、折り返して往復する
      const maxS = (road.pts.length - 1) * ROAD_STEP;
      if (c.s >= maxS) { c.s = maxS * 2 - c.s; c.dir = -1; }
      else if (c.s <= 0) { c.s = -c.s; c.dir = 1; }
    }
    const p = carPose(road, c.s);
    const q = laneOffset(p, c.lane);   // 進行方向の横にレーンオフセット
    const px = q.x, pz = q.z;
    c.px = px; c.pz = pz;   // destroyAroundの被弾判定用にキャッシュ(carPoseの再計算を避ける)
    const hx = p.dx * c.dir, hz = p.dz * c.dir;   // 正規化済みの進行方向
    const o = c.i * 16;
    arr[o] = hx;      arr[o + 2] = hz;
    arr[o + 8] = -hz; arr[o + 10] = hx;
    arr[o + 12] = px;
    arr[o + 13] = p.h + p.hs * c.lane + 1.1;   // 事前計算した路面高+横断勾配
    arr[o + 14] = pz;
  }
  // 毎フレーム変わるのは生存している走行車両の範囲だけ。駐車車両と、全滅した範囲の
  // GPU転送を省く(死んだ車の行列はhideCarInstanceが個別に転送予約する。
  // updateRangesはアップロード後に自動クリアされるので毎フレーム指定し直す)
  if (maxAlive >= 0) flushRange(carMesh.instanceMatrix, minAlive, maxAlive, 16);
}
