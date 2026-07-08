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
