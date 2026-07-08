// ミサイルの発射・飛翔・分裂・着弾

import * as THREE from 'three';
import { MAP_HALF } from '../core/config';
import { hideHint } from '../ui/hud';
import { playPop, playWhoosh } from '../ui/audio';
import { detonate, detonateNuke } from './explosions';
import { WEAPONS, type Weapon } from './weapons';
import type { Missile } from './simState';
import type { World } from './world';

const raycaster = new THREE.Raycaster();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const _fwd = new THREE.Vector3(0, 0, 1);

// 着弾点マーカーのマテリアル(武器ごとに1つを共有。点滅は全マーカー同位相)。
// 初回発射時に生成し、以後使い回す
const markerMats = new Map<Weapon['id'], THREE.MeshBasicMaterial>();
function markerMatFor(w: Weapon): THREE.MeshBasicMaterial {
  let m = markerMats.get(w.id);
  if (!m) {
    m = new THREE.MeshBasicMaterial({
      color: w.markerColor, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide });
    markerMats.set(w.id, m);
  }
  return m;
}

export function requestStrike(world: World, px: number, py: number): void {
  const { gfx, sim, city, view } = world;
  const w = WEAPONS[world.settings.weaponIdx];
  const ndc = new THREE.Vector2((px / innerWidth) * 2 - 1, -(py / innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, gfx.camera);
  // 起伏のある地面と交差判定。外れたら(空クリック)水平面へフォールバック
  let hit: THREE.Vector3 | null = null;
  const hits = raycaster.intersectObject(view.ground.mesh);
  if (hits.length) hit = hits[0].point.clone();
  if (!hit) {
    hit = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(groundPlane, hit)) return;
  }
  hit.x = THREE.MathUtils.clamp(hit.x, -MAP_HALF, MAP_HALF);
  hit.z = THREE.MathUtils.clamp(hit.z, -MAP_HALF, MAP_HALF);
  hit.y = city.terrain.h(hit.x, hit.z);

  const a = Math.random() * Math.PI * 2;
  const start = new THREE.Vector3(hit.x + Math.cos(a) * 480, hit.y + 1600, hit.z + Math.sin(a) * 480);
  const vel = hit.clone().sub(start).normalize().multiplyScalar(w.speed);
  const mesh = new THREE.Mesh(gfx.fx.missileGeo, gfx.fx.missileMat);
  mesh.scale.setScalar(w.scale);
  mesh.position.copy(start);
  mesh.quaternion.setFromUnitVectors(_fwd, vel.clone().normalize());
  gfx.scene.add(mesh);

  const marker = new THREE.Mesh(gfx.fx.ringGeo, markerMatFor(w));
  marker.rotation.x = -Math.PI / 2;
  marker.position.set(hit.x, hit.y + 2.5, hit.z);
  gfx.scene.add(marker);

  // split: 上空で子弾に分裂 / boom: 'nuke' か通常爆発の半径
  sim.missiles.push({ pos: start, vel, target: hit, mesh, marker, trailT: 0,
    split: w.id === 'cluster', boom: w.id === 'nuke' ? 'nuke' : 105 });
  sim.stats.mCount++;
  playWhoosh();
  hideHint();
}

// ミサイルの後始末(分裂・着弾・街の再生成で共通)。
// マーカーのマテリアルは武器定義で共有しているのでdispose不要
function removeMissile(world: World, m: Missile): void {
  world.gfx.scene.remove(m.mesh);
  if (m.marker) world.gfx.scene.remove(m.marker);
}

export function updateMissiles(world: World, dt: number, now: number): void {
  const { gfx, sim, city } = world;
  const missiles = sim.missiles;
  if (!missiles.length) return;
  // マーカーの点滅は全弾同位相(マテリアル共有)なので、フレームに1回だけ計算・書き込みする
  const mOp = 0.5 + 0.45 * Math.sin(now * 0.02), mSc = 14 + 6 * Math.sin(now * 0.01);
  for (const m of markerMats.values()) m.opacity = mOp;
  for (let i = missiles.length - 1; i >= 0; i--) {
    const m = missiles[i];
    m.pos.addScaledVector(m.vel, dt);
    m.mesh.position.copy(m.pos);
    // 噴射トレイル
    m.trailT += dt;
    while (m.trailT > 0.008) {
      m.trailT -= 0.008;
      gfx.fireP.spawn({ x: m.pos.x + (Math.random() - 0.5) * 3, y: m.pos.y + (Math.random() - 0.5) * 3,
        z: m.pos.z + (Math.random() - 0.5) * 3,
        vx: 0, vy: 0, vz: 0, life: 0.5 + Math.random() * 0.3, size: 9 + Math.random() * 7,
        r: 1, g: 0.62, b: 0.25, baseAlpha: 0.8 });
      gfx.smokeP.spawn({ x: m.pos.x, y: m.pos.y, z: m.pos.z,
        vx: (Math.random() - 0.5) * 4, vy: 2, vz: (Math.random() - 0.5) * 4,
        life: 2.2, size: 14, growth: 2.5, r: 0.32, g: 0.32, b: 0.35, baseAlpha: 0.4 });
    }
    if (m.marker) m.marker.scale.set(mSc, mSc, 1);   // マーカー点滅(不透明度は共有マテリアルで設定済み)
    // クラスター弾: 上空で子弾に分裂(分裂後の親は即座に配列から消える)
    if (m.split && m.pos.y <= m.target.y + 380) {
      removeMissile(world, m);
      for (let j = 0; j < 24; j++) {                       // 分裂の閃光
        const a = Math.random() * Math.PI * 2, sp = 20 + Math.random() * 60;
        gfx.fireP.spawn({ x: m.pos.x, y: m.pos.y, z: m.pos.z,
          vx: Math.cos(a) * sp, vy: (Math.random() - 0.5) * 40, vz: Math.sin(a) * sp,
          life: 0.35 + Math.random() * 0.3, size: 7 + Math.random() * 8,
          r: 1, g: 0.8, b: 0.45 });
      }
      playPop();
      const n = 7 + Math.floor(Math.random() * 3);
      for (let j = 0; j < n; j++) {
        const a = Math.random() * Math.PI * 2, rr = 25 + Math.random() * 150;
        let tx = THREE.MathUtils.clamp(m.target.x + Math.cos(a) * rr, -MAP_HALF, MAP_HALF);
        let tz = THREE.MathUtils.clamp(m.target.z + Math.sin(a) * rr, -MAP_HALF, MAP_HALF);
        let ty = city.terrain.h(tx, tz);
        // 散布先が分裂点より高い(山腹など)と生成直後に着弾条件を満たしてしまうため、
        // 十分低い地点になるまで親目標側へ引き戻す
        for (let k = 0; ty > m.pos.y - 100 && k < 4; k++) {
          tx = (tx + m.target.x) / 2; tz = (tz + m.target.z) / 2;
          ty = city.terrain.h(tx, tz);
        }
        const sm = new THREE.Mesh(gfx.fx.missileGeo, gfx.fx.missileMat);
        sm.scale.set(0.5, 0.5, 0.5);
        const vel = new THREE.Vector3(tx - m.pos.x, ty - m.pos.y, tz - m.pos.z).normalize().multiplyScalar(560);
        sm.position.copy(m.pos);
        sm.quaternion.setFromUnitVectors(_fwd, vel.clone().normalize());
        gfx.scene.add(sm);
        missiles.push({ pos: m.pos.clone(), vel, target: new THREE.Vector3(tx, ty, tz),
          mesh: sm, marker: null, trailT: Math.random() * 0.008, split: false, boom: 55 });
      }
      missiles.splice(i, 1);
      continue;
    }
    if (m.pos.y <= m.target.y + 2) {
      removeMissile(world, m);
      missiles.splice(i, 1);
      const ip = m.target.clone();
      if (m.boom === 'nuke') detonateNuke(world, ip);
      else detonate(world, ip, m.boom);
    }
  }
}
