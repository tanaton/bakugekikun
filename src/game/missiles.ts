// ミサイルの発射・飛翔・分裂・着弾

import * as THREE from 'three';
import { clampToMap, WATER_BED_Y } from '../core/config';
import type { Terrain } from '../core/terrain';
import type { Gfx } from '../render/gfx';
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

// 遅延生成されるマテリアル(fxプリセット・マーカー・ミサイル)を起動時に一度コンパイルしておく。
// 初回の発射・着弾の瞬間にDOUBLE_SIDED等の新プログラムのコンパイルストールが出るのを防ぐ
// (ライトを常設してシェーダー再コンパイルを避けるのと同じ思想)
export function prewarmShaders(gfx: Gfx): void {
  const { scene, camera, renderer, fx } = gfx;
  const fxMeshes = [
    fx.sphereAdd(0xffffff, 1), fx.sphereAddD(0xffffff, 1),
    fx.ringAddD(0xffffff, 1), fx.ringD(0xffffff, 1),
  ];
  const others = [
    new THREE.Mesh(fx.missileGeo, fx.missileMat),
    ...WEAPONS.map(w => new THREE.Mesh(fx.ringGeo, markerMatFor(w))),
  ];
  scene.add(...fxMeshes, ...others);
  renderer.compile(scene, camera);   // fx以外の街のマテリアルもここでまとめてコンパイルされる
  for (const m of fxMeshes) fx.release(m);
  scene.remove(...others);
}

// 地形高さ場とレイの交差点。地面メッシュへのレイキャスト(数万三角形の総当たりで
// 1クリック数msかかる)を避け、解析的なterrain.hを等分マーチ+二分法で詰める
const MAX_TERRAIN_H = 600;   // terrain.hの上界(基礎起伏 + 山の隆起の最大値に余裕を持たせた値)
const _rayPt = new THREE.Vector3();
function rayGroundHit(ray: THREE.Ray, terrain: Terrain): THREE.Vector3 | null {
  if (ray.direction.y >= -1e-4) return null;   // 水平・上向きのレイは地面に届かない
  const below = (t: number): boolean => {
    ray.at(t, _rayPt);
    return _rayPt.y <= terrain.h(_rayPt.x, _rayPt.z);
  };
  // 地形が存在しうる高さ帯[WATER_BED_Y, MAX_TERRAIN_H]だけを刻む(尾根を跨ぎ越さない程度に細かく)
  const t0 = Math.max(0, (ray.origin.y - MAX_TERRAIN_H) / -ray.direction.y);
  const t1 = (ray.origin.y - WATER_BED_Y) / -ray.direction.y;
  let lo = t0, hi = -1;
  for (let i = 1; i <= 200; i++) {
    const t = t0 + (t1 - t0) * i / 200;
    if (below(t)) { hi = t; break; }
    lo = t;
  }
  if (hi < 0) return null;
  for (let i = 0; i < 24; i++) {   // 二分法で交点を詰める
    const mid = (lo + hi) / 2;
    if (below(mid)) hi = mid; else lo = mid;
  }
  return ray.at(hi, new THREE.Vector3());
}

// ミサイル本体メッシュの生成(進行方向へ向けてシーンに追加)。親弾・子弾で共用
const _dir = new THREE.Vector3();
function spawnMissileMesh(gfx: Gfx, pos: THREE.Vector3, vel: THREE.Vector3, scale: number): THREE.Mesh {
  const mesh = new THREE.Mesh(gfx.fx.missileGeo, gfx.fx.missileMat);
  mesh.scale.setScalar(scale);
  mesh.position.copy(pos);
  mesh.quaternion.setFromUnitVectors(_fwd, _dir.copy(vel).normalize());
  gfx.scene.add(mesh);
  return mesh;
}

export function requestStrike(world: World, px: number, py: number): void {
  const { gfx, sim, city } = world;
  const w = WEAPONS[world.settings.weaponIdx];
  const ndc = new THREE.Vector2((px / innerWidth) * 2 - 1, -(py / innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, gfx.camera);
  // 起伏のある地面と交差判定。外れたら(空クリック)水平面へフォールバック
  let hit = rayGroundHit(raycaster.ray, city.terrain);
  if (!hit) {
    hit = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(groundPlane, hit)) return;
  }
  hit.x = clampToMap(hit.x);
  hit.z = clampToMap(hit.z);
  hit.y = city.terrain.h(hit.x, hit.z);

  const a = Math.random() * Math.PI * 2;
  const start = new THREE.Vector3(hit.x + Math.cos(a) * 480, hit.y + 1600, hit.z + Math.sin(a) * 480);
  const vel = hit.clone().sub(start).normalize().multiplyScalar(w.speed);
  const mesh = spawnMissileMesh(gfx, start, vel, w.scale);

  const marker = new THREE.Mesh(gfx.fx.ringGeo, markerMatFor(w));
  marker.rotation.x = -Math.PI / 2;
  marker.position.set(hit.x, hit.y + 2.5, hit.z);
  gfx.scene.add(marker);

  // 分裂・着弾の挙動は武器定義をそのまま持たせる
  sim.missiles.push({ pos: start, vel, target: hit, mesh, marker, trailT: 0,
    split: w.split ?? null, boom: w.boom });
  sim.stats.mCount++;
  playWhoosh();
  hideHint();
}

// ミサイルの後始末(分裂・着弾・街の再生成で共通)。
// マーカーのマテリアルは武器定義で共有しているのでdispose不要
export function removeMissile(world: World, m: Missile): void {
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
    if (m.split && m.pos.y <= m.target.y + m.split.altitude) {
      const sp2 = m.split;
      removeMissile(world, m);
      for (let j = 0; j < 24; j++) {                       // 分裂の閃光
        const a = Math.random() * Math.PI * 2, sp = 20 + Math.random() * 60;
        gfx.fireP.spawn({ x: m.pos.x, y: m.pos.y, z: m.pos.z,
          vx: Math.cos(a) * sp, vy: (Math.random() - 0.5) * 40, vz: Math.sin(a) * sp,
          life: 0.35 + Math.random() * 0.3, size: 7 + Math.random() * 8,
          r: 1, g: 0.8, b: 0.45 });
      }
      playPop();
      const n = sp2.nMin + Math.floor(Math.random() * (sp2.nMax - sp2.nMin + 1));
      for (let j = 0; j < n; j++) {
        const a = Math.random() * Math.PI * 2, rr = sp2.rMin + Math.random() * (sp2.rMax - sp2.rMin);
        const tx = clampToMap(m.target.x + Math.cos(a) * rr);
        const tz = clampToMap(m.target.z + Math.sin(a) * rr);
        const ty = city.terrain.h(tx, tz);
        const vel = new THREE.Vector3(tx - m.pos.x, ty - m.pos.y, tz - m.pos.z)
          .normalize().multiplyScalar(sp2.speed);
        const sm = spawnMissileMesh(gfx, m.pos, vel, sp2.scale);
        missiles.push({ pos: m.pos.clone(), vel, target: new THREE.Vector3(tx, ty, tz),
          mesh: sm, marker: null, trailT: Math.random() * 0.008, split: null, boom: sp2.boom });
      }
      missiles.splice(i, 1);
      continue;
    }
    // 着弾は目標平面の通過で判定する。高度(Y)比較だと撃ち出し点より高い目標
    // (分裂点より上の山腹など)に到達できず、散布先の引き戻しが必要になる
    if (_dir.copy(m.target).sub(m.pos).dot(m.vel) <= 0) {
      removeMissile(world, m);
      missiles.splice(i, 1);
      const ip = m.target.clone();
      if (m.boom === 'nuke') detonateNuke(world, ip);
      else detonate(world, ip, m.boom);
    }
  }
}
