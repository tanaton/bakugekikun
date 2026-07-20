// 逃走モードのプレイヤーアバター(箱組みの人型+走りアニメ)。
// 1体だけなので個別Meshでよい(InstancedMesh縛りは大量オブジェクトの話)

import * as THREE from 'three';

export interface PlayerAvatar {
  group: THREE.Group;
  // 位置・向き・走りアニメ(phase=歩行位相, speed01=振り幅0..1)
  setPose(x: number, y: number, z: number, yaw: number, phase: number, speed01: number): void;
  setDead(k: number): void;   // 0→1で前のめりに倒れる
  dispose(scene: THREE.Scene): void;
}

function box(w: number, h: number, d: number, color: number, pivotTop: boolean): THREE.Mesh {
  const geo = new THREE.BoxGeometry(w, h, d);
  if (pivotTop) geo.translate(0, -h / 2, 0);   // 肩・股関節を原点にして振り回転させる
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color }));
  mesh.castShadow = true;
  return mesh;
}

export function createPlayerAvatar(scene: THREE.Scene): PlayerAvatar {
  const group = new THREE.Group();
  const torso = box(0.62, 0.72, 0.34, 0xd8632a, false);   // 上着(視認性の高いオレンジ)
  torso.position.y = 1.16;
  const head = box(0.3, 0.3, 0.3, 0xe8b98a, false);
  head.position.y = 1.72;
  const armL = box(0.16, 0.62, 0.16, 0xd8632a, true);
  const armR = box(0.16, 0.62, 0.16, 0xd8632a, true);
  armL.position.set(-0.42, 1.5, 0); armR.position.set(0.42, 1.5, 0);
  const legL = box(0.2, 0.82, 0.22, 0x2e3a52, true);
  const legR = box(0.2, 0.82, 0.22, 0x2e3a52, true);
  legL.position.set(-0.16, 0.82, 0); legR.position.set(0.16, 0.82, 0);
  group.add(torso, head, armL, armR, legL, legR);
  scene.add(group);

  return {
    group,
    setPose(x, y, z, yaw, phase, speed01) {
      const swing = Math.sin(phase) * 0.9 * speed01;
      armL.rotation.x = swing; armR.rotation.x = -swing;
      legL.rotation.x = -swing; legR.rotation.x = swing;
      group.position.set(x, y + Math.abs(Math.sin(phase)) * 0.08 * speed01, z);
      group.rotation.y = yaw;
    },
    setDead(k) {
      group.rotation.x = k * Math.PI / 2;   // 前のめりに倒れる
    },
    dispose(sc) {
      sc.remove(group);
      for (const m of [torso, head, armL, armR, legL, legR]) {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
    },
  };
}
