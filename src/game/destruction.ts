// 破壊判定と崩壊(倒壊・圧壊)・炎上の進行

import type * as THREE from 'three';
import { CAR_VALUE } from '../core/config';
import { B, type Building, type Car } from '../core/types';
import { FALLEN_COL, hideCarInstance, setBuildingLit, setBuildingMatrix, toppleMatrix } from '../render/cityMeshes';
import { HIDDEN_MAT } from '../render/instanced';
import { playPop } from '../ui/audio';
import type { World } from './world';

// 建物を破壊状態にして崩壊(倒壊 or 圧壊)を開始する。delayで崩壊ウェーブを表現
export function startCollapse(world: World, b: Building,
    dirx: number, dirz: number, canTopple: boolean, delay = 0): void {
  const { sim } = world;
  b.state = B.Falling;
  setBuildingLit(world.view, b, false);   // 崩壊する建物は停電(倒壊後も窓が光り続けない)
  sim.stats.bDead++;
  sim.stats.damage += b.value;
  const base = { b, t: 0, delay, dusted: false };
  if (canTopple && b.h > 32 && Math.random() < 0.6) {
    sim.collapsing.push({ ...base, mode: 't', dur: 0.9 + Math.random() * 0.7,
      dirx, dirz, amax: Math.PI / 2 * (0.85 + Math.random() * 0.12) });
  } else {
    sim.collapsing.push({ ...base, mode: 'c', dur: 0.7 + Math.random() * 0.5,
      ax: (Math.random() - 0.5) * 0.3, az: (Math.random() - 0.5) * 0.3 });
  }
  if (sim.burnSites.length < 140 && Math.random() < 0.55) {   // 跡地がしばらく燃え続ける
    sim.burnSites.push({ x: b.x, z: b.z, gy: b.gy,
      until: sim.simT + delay + 5 + Math.random() * 7,
      next: sim.simT + delay + Math.random() * 0.4 });
  }
}

const _treeHit = new Set<THREE.InstancedMesh>();   // 行列を書き換えたチャンクメッシュだけGPUへ再アップロード
export function destroyAround(world: World, p: { x: number; z: number }, R: number,
    depth = 0, wave = 0): void {
  const { sim, index, view, city } = world;
  // 建物(空間ハッシュで近傍のみ走査。距離は二乗で比較し、命中時だけsqrtを取る)
  const R2 = R * 1.55, Rsq = R * R, R2sq = R2 * R2, REsq = R2sq * 1.35 * 1.35;
  // クエリ半径は最大の判定半径(延焼チェックの外縁R2*1.35)に合わせる。
  // 巻き添え崩壊(depth>0)は延焼しないのでR2まででよい
  index.buildings.forEachNear(p.x, p.z, depth === 0 ? R2 * 1.35 : R2, b => {
    if (b.state !== B.Intact && b.state !== B.Burning) return;   // 延焼中は直撃なら壊せる
    const dx = b.x - p.x, dz = b.z - p.z, d2 = dx * dx + dz * dz;
    if (d2 <= Rsq || (d2 <= R2sq && Math.random() < 0.45)) {
      const dd = Math.sqrt(d2) || 1;
      // 爆心から遠い高層ビルは反対側へ倒れ込む(巻き添え倒壊は倒れない)
      startCollapse(world, b, dx / dd, dz / dd,
        depth === 0 && dd > R * 0.3, wave ? dd / wave : 0);
    } else if (b.state === B.Intact && depth === 0 && d2 <= REsq &&
               Math.random() < 0.4 && sim.burningBldgs.length < 70) {
      // 爆風の外縁: 炎上して時間差で崩れる
      b.state = B.Burning;
      sim.burningBldgs.push({ b, collapseAt: sim.simT + 2 + Math.random() * 5, next: sim.simT });
    }
  });
  // 車。走行車両は全数走査(位置キャッシュはcore生成時とupdateCarsが常に維持)、
  // 駐車車両は静的な空間ハッシュで近傍のみ走査する
  const CR = R * 1.25, CRsq = CR * CR;
  const hitCar = (c: Car): void => {
    if (!c.alive) return;
    const dx = c.px - p.x, dz = c.pz - p.z;
    if (dx > CR || dx < -CR || dz > CR || dz < -CR) return;   // 軸別の早期棄却
    if (dx * dx + dz * dz > CRsq) return;
    c.alive = false;
    hideCarInstance(view, city.movingCars, c.i);
    sim.stats.cDead++;
    sim.stats.damage += CAR_VALUE;
  };
  for (let ci = 0; ci < city.movingCars; ci++) hitCar(city.cars[ci]);
  index.parked.forEachNear(p.x, p.z, CR, hitCar);
  // 木(空間ハッシュで近傍セルのみ走査)
  const TR = R * 1.2, TRsq = TR * TR;
  _treeHit.clear();
  index.trees.forEachNear(p.x, p.z, TR, t => {
    if (!t.alive) return;
    const dx = t.x - p.x, dz = t.z - p.z;
    if (dx * dx + dz * dz <= TRsq) {
      t.alive = false;
      const mesh = view.treeChunks[t.ci];
      mesh.setMatrixAt(t.mi, HIDDEN_MAT);
      _treeHit.add(mesh);
      sim.stats.tDead++;
    }
  });
  for (const m of _treeHit) m.instanceMatrix.needsUpdate = true;
  if (_treeHit.size) world.gfx.sunShadow.markFarDirty();   // 消えた木を全域シャドウマップにも反映
}

const touched = new Set<number>();   // 行列を書き換えたメッシュ種別だけGPUへ再アップロード
export function updateCollapses(world: World, dt: number): void {
  const { sim, view, city, debris, gfx } = world;
  const collapsing = sim.collapsing;
  if (!collapsing.length) return;
  touched.clear();
  for (let i = collapsing.length - 1; i >= 0; i--) {
    const c = collapsing[i];
    const b = c.b;
    if (!c.dusted) {                              // 崩壊ウェーブ: 到達するまで待ち、着火時に粉塵
      c.delay -= dt;
      if (c.delay > 0) continue;
      c.dusted = true;
      collapseDust(world, b);
    }
    touched.add(b.k);
    c.t += dt / c.dur;
    if (c.mode === 't') {
      // 倒壊: 基部を支点に加速しながら傾く
      if (c.t >= 1) {
        toppleMatrix(view.bMeshes, b, c.amax, c.dirx, c.dirz);
        b.state = B.Dead;
        const mesh = view.bMeshes[b.k];
        mesh.setColorAt(b.mi, FALLEN_COL);
        mesh.instanceColor!.needsUpdate = true;
        view.ground.pushLot(b);   // 根本の基礎跡(焦げ跡の中では省略される)
        // 着地の粉塵が倒れた方向に走る
        for (let j = 0; j < 16; j++) {
          const dd = b.h * (0.15 + Math.random() * 0.85);
          const px = b.x + c.dirx * dd + (Math.random() - 0.5) * b.sx * 1.5;
          const pz = b.z + c.dirz * dd + (Math.random() - 0.5) * b.sz * 1.5;
          const py = city.terrain.h(px, pz);
          gfx.smokeP.spawn({ x: px, y: py + 2, z: pz, gy: py,
            vx: (Math.random() - 0.5) * 30, vy: 10 + Math.random() * 24, vz: (Math.random() - 0.5) * 30,
            life: 2.5 + Math.random() * 2, size: 18 + Math.random() * 20, growth: 2.4, drag: 0.6, fadeIn: 0.15,
            r: 0.42, g: 0.38, b: 0.32, baseAlpha: 0.6 });
        }
        const ix = b.x + c.dirx * b.h * 0.55, iz = b.z + c.dirz * b.h * 0.55;
        const iy = city.terrain.h(ix, iz);
        for (let j = 0; j < 10; j++)
          debris.spawn(city.terrain, ix + (Math.random() - 0.5) * 20, iy + 3,
            iz + (Math.random() - 0.5) * 20, 50 + Math.random() * 60);
        sim.shake += Math.min(4, b.h * 0.02);
        if (Math.random() < 0.2) playPop();     // 大量倒壊時に音が飽和しないよう間引く
        destroyAround(world, { x: ix, z: iz }, Math.min(45, b.h * 0.35), 1);  // 倒れ込んだ先を巻き添え
        collapsing.splice(i, 1);
        continue;
      }
      toppleMatrix(view.bMeshes, b, c.amax * c.t * c.t, c.dirx, c.dirz);
    } else {
      // 圧壊: その場に沈み、沈みきったら本体を隠して基礎跡だけを地面に残す
      if (c.t >= 1) {
        b.state = B.Dead;
        view.bMeshes[b.k].setMatrixAt(b.mi, HIDDEN_MAT);
        view.ground.pushLot(b);
        collapsing.splice(i, 1);
        continue;
      }
      const k = c.t * c.t;                      // 加速しながら崩れる
      const jitter = Math.sin(c.t * 40) * 0.02 * (1 - c.t);
      setBuildingMatrix(view.bMeshes, b, Math.max(0.045, 1 - k * 0.96), c.ax * k + jitter, c.az * k + jitter);
    }
  }
  for (const k of touched) view.bMeshes[k].instanceMatrix.needsUpdate = true;
  if (touched.size) gfx.sunShadow.markFarDirty();   // 崩壊中の建物を全域シャドウマップにも反映
}

// 崩壊開始時の粉塵
function collapseDust(world: World, b: Building): void {
  for (let i = 0; i < 6; i++) {
    world.gfx.smokeP.spawn({
      x: b.x + (Math.random() - 0.5) * b.sx, y: b.gy + 3, z: b.z + (Math.random() - 0.5) * b.sz, gy: b.gy,
      vx: (Math.random() - 0.5) * 26, vy: 8 + Math.random() * 18, vz: (Math.random() - 0.5) * 26,
      life: 2.4 + Math.random() * 2, size: 16 + Math.random() * 14, growth: 2,
      drag: 0.5, fadeIn: 0.3, r: 0.34, g: 0.31, b: 0.28, baseAlpha: 0.5 });
  }
}
