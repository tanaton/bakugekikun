// 回転しながら飛び散る3D瓦礫(常設InstancedMesh + SlotPool)

import * as THREE from 'three';
import '../render/colorMode';   // モジュール初期化時のColor構築より先にカラーマネジメントを無効化
import type { Terrain } from '../core/terrain';
import { pick } from '../core/rng';
import { SlotPool, type Slotted } from '../core/slotPool';
import { HIDDEN_MAT, setInstanceAt } from '../render/instanced';
import { excludeFromFarShadow } from '../render/sky';

const DEBRIS_N = 340;
const DEBRIS_COLS = [0x4a4a4e, 0x6a655c, 0x8a857a, 0x3a3d44, 0x7a5a48].map(c => new THREE.Color(c));

interface Debris extends Slotted {
  x: number; y: number; z: number;
  gx: number; gz: number; gy: number;   // 接地高さは横移動したときだけ再サンプルする
  vx: number; vy: number; vz: number;
  rx: number; ry: number; rz: number;
  rvx: number; rvz: number;
  size: number; life: number; age: number;
}

export class DebrisSystem {
  private readonly mesh: THREE.InstancedMesh;
  private readonly pool = new SlotPool<Debris>(DEBRIS_N);

  constructor(scene: THREE.Scene) {
    this.mesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshLambertMaterial({ color: 0xffffff }), DEBRIS_N);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    excludeFromFarShadow(this.mesh);   // 全域マップには写らない(テクセルに埋もれる)ので描かない
    scene.add(this.mesh);
    this.clear();
  }

  clear(): void {
    this.pool.clear();
    for (let i = 0; i < DEBRIS_N; i++) this.mesh.setMatrixAt(i, HIDDEN_MAT);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  spawn(terrain: Terrain, x: number, y: number, z: number, pow: number): void {
    const a = Math.random() * Math.PI * 2, sp = (0.3 + Math.random() * 0.7) * pow;
    const d = this.pool.spawn({
      slot: 0,
      x, y, z, gx: x, gz: z, gy: terrain.h(x, z),
      vx: Math.cos(a) * sp, vy: pow * (0.5 + Math.random() * 0.9), vz: Math.sin(a) * sp,
      rx: Math.random() * 3, ry: Math.random() * 3, rz: Math.random() * 3,
      rvx: (Math.random() - 0.5) * 12, rvz: (Math.random() - 0.5) * 12,
      size: 0.9 + Math.random() * 3.2, life: 2.2 + Math.random() * 2.4, age: 0,
    });
    this.mesh.setColorAt(d.slot, pick(DEBRIS_COLS, Math.random));
    this.mesh.instanceColor!.needsUpdate = true;   // 色が変わるのはspawn時だけ
  }

  update(dt: number, terrain: Terrain): void {
    if (!this.pool.list.length) return;
    this.pool.sweep(d => {
      d.age += dt;
      if (d.age >= d.life) {
        this.mesh.setMatrixAt(d.slot, HIDDEN_MAT);
        return false;
      }
      d.vy -= 260 * dt;
      d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt;
      // 毎フレームのterrainHを避ける: バウンド後はほぼその場に留まるので5m動いたときだけ再サンプル
      const mx = d.x - d.gx, mz = d.z - d.gz;
      if (mx * mx + mz * mz > 25) { d.gx = d.x; d.gz = d.z; d.gy = terrain.h(d.x, d.z); }
      const gnd = d.gy + d.size / 2;
      if (d.y < gnd && d.vy < 0) {
        d.y = gnd; d.vy *= -0.34;
        d.vx *= 0.6; d.vz *= 0.6; d.rvx *= 0.5; d.rvz *= 0.5;
      }
      d.rx += d.rvx * dt; d.rz += d.rvz * dt;
      const fade = Math.min(1, (d.life - d.age) / 0.4);   // 最後は縮んで消える
      setInstanceAt(this.mesh, d.slot, d.x, d.y, d.z, d.rx, d.ry, d.rz,
        d.size * fade, d.size * fade, d.size * fade);
      return true;
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
