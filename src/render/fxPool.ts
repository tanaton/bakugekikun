// 爆発エフェクトのメッシュ+マテリアルのプール。毎爆発のnew/disposeによるGC負荷を避ける。
// blending/sideは描画状態が変わるためプリセット別にプールを分け、マテリアルは再設定だけで使い回す

import * as THREE from 'three';

export type FxMesh = THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;

export class FxPools {
  readonly missileGeo: THREE.ConeGeometry;
  readonly missileMat: THREE.MeshBasicMaterial;
  readonly ringGeo: THREE.RingGeometry;
  readonly flashGeo: THREE.SphereGeometry;
  private readonly free = new Map<string, FxMesh[]>();   // プリセット名 → 待機中メッシュの配列

  constructor(private readonly scene: THREE.Scene) {
    this.missileGeo = new THREE.ConeGeometry(2.2, 16, 8);
    this.missileGeo.rotateX(Math.PI / 2); // +Z向き
    this.missileMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0 });
    this.ringGeo = new THREE.RingGeometry(0.85, 1, 48);
    this.flashGeo = new THREE.SphereGeometry(1, 16, 12);
  }

  private acquire(key: string, geo: THREE.BufferGeometry, blending: THREE.Blending,
      side: THREE.Side, color: number, opacity: number): FxMesh {
    let list = this.free.get(key);
    if (!list) this.free.set(key, list = []);
    let mesh = list.pop();
    if (!mesh) {
      mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial(
        { transparent: true, depthWrite: false, blending, side }));
      mesh.userData.fxKey = key;
    }
    mesh.material.color.set(color);
    mesh.material.opacity = opacity;
    mesh.rotation.set(0, 0, 0);
    mesh.scale.set(1, 1, 1);
    return mesh;
  }

  sphereAdd(c: number, o: number): FxMesh {
    return this.acquire('sA', this.flashGeo, THREE.AdditiveBlending, THREE.FrontSide, c, o);
  }
  sphereAddD(c: number, o: number): FxMesh {
    return this.acquire('sAD', this.flashGeo, THREE.AdditiveBlending, THREE.DoubleSide, c, o);
  }
  ringAddD(c: number, o: number): FxMesh {
    return this.acquire('rAD', this.ringGeo, THREE.AdditiveBlending, THREE.DoubleSide, c, o);
  }
  ringD(c: number, o: number): FxMesh {
    return this.acquire('rD', this.ringGeo, THREE.NormalBlending, THREE.DoubleSide, c, o);
  }

  // fxメッシュは必ずacquire経由なのでfxKeyを持つ
  release(mesh: FxMesh): void {
    this.scene.remove(mesh);
    this.free.get(mesh.userData.fxKey as string)!.push(mesh);
  }
}
