// InstancedMesh行列書き込みの共有ユーティリティ

import * as THREE from 'three';

const dummy = new THREE.Object3D();

// 共有dummy経由でインスタンス行列を書く(位置・回転・スケールを毎回すべて設定する)
export function setInstanceAt(mesh: THREE.InstancedMesh, i: number,
    x: number, y: number, z: number,
    rx: number, ry: number, rz: number,
    sx: number, sy: number, sz: number): void {
  dummy.position.set(x, y, z);
  dummy.rotation.set(rx, ry, rz);
  dummy.scale.set(sx, sy, sz);
  dummy.updateMatrix();
  mesh.setMatrixAt(i, dummy.matrix);
}

// 破壊済みインスタンスを画面外へ隠す共用行列(瓦礫・車・木)
export const HIDDEN_MAT = new THREE.Matrix4().makeScale(0.001, 0.001, 0.001).setPosition(0, -100, 0);

// dummyは倒壊行列の計算でも使う(toppleMatrix)
export const instanceDummy = dummy;

// オブジェクトのマテリアル(単体でも配列でも)全てにfnを呼ぶ
export function forEachMaterial(o: THREE.Object3D, fn: (m: THREE.Material) => void): void {
  const mat = (o as THREE.Mesh).material;
  if (!mat) return;
  for (const m of Array.isArray(mat) ? mat : [mat]) fn(m);
}

// 書き換えたインデックス範囲[lo,hi]だけを属性の転送範囲に予約する
// (strideは1インデックスあたりのfloat数: 行列16 / 色3 / スカラー1)
export function flushRange(attr: THREE.BufferAttribute, lo: number, hi: number, stride: number): void {
  attr.addUpdateRange(lo * stride, (hi - lo + 1) * stride);
  attr.needsUpdate = true;
}

// キー(メッシュ配列の番号)ごとに書き換えたインデックス範囲を積み、flushでまとめて
// 転送予約する。破壊処理のホットパスで使うためアロケーションしない
export class DirtyRanges {
  private readonly keys = new Set<number>();
  private readonly lo: number[] = [];
  private readonly hi: number[] = [];
  get size(): number { return this.keys.size; }
  add(k: number, i: number): void {
    if (!this.keys.has(k)) { this.keys.add(k); this.lo[k] = i; this.hi[k] = i; }
    else { if (i < this.lo[k]) this.lo[k] = i; if (i > this.hi[k]) this.hi[k] = i; }
  }
  flush(attrOf: (k: number) => THREE.BufferAttribute, stride: number): void {
    for (const k of this.keys) flushRange(attrOf(k), this.lo[k], this.hi[k], stride);
    this.keys.clear();
  }
}
