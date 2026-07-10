// 街の3D表現(InstancedMesh群・地面・水面・発光マテリアル)の構築と破棄

import * as THREE from 'three';
import './colorMode';   // モジュール初期化時のColor構築より先にカラーマネジメントを無効化
import type { CityData } from '../core/cityGen';
import { MAP_HALF } from '../core/config';
import { BUILDING_KINDS, HOUSE_K0, ROOF_COLS } from '../core/lots';
import { rngFor } from '../core/rng';
import type { Building } from '../core/types';
import { makeHouseGeometry, makeTowerGeometry, makeTreeGeometries } from './geometries';
import { GroundView } from './ground';
import { flushRange, forEachMaterial, HIDDEN_MAT, instanceDummy, setInstanceAt } from './instanced';
import { excludeFromFarShadow, TIMES, type TimeMode } from './sky';
import { makeConcreteTexture, makeGlassTexture, makeHouseTexture, type TexPair } from './textures';
import { buildWaterSurface, type WaterView } from './water';

export interface CityView {
  group: THREE.Group;
  bMeshes: THREE.InstancedMesh[];      // [0:コンクリビル, 1:ガラスビル, 2以降:民家(屋根色別)]
  treeChunks: THREE.InstancedMesh[];   // 空間チャンク×樹種ごと(チャンク単位でカリング)
  carMesh: THREE.InstancedMesh;
  ground: GroundView;
  water: WaterView | null;
  emissiveMats: THREE.MeshLambertMaterial[];   // 時間帯で窓明かりの強さを切り替える
  litAttrs: THREE.InstancedBufferAttribute[];  // 建物ごとの窓明かり(1=点灯 0=消灯)。bMeshesと同順
  dispose(): void;
}

// 建物1棟の窓明かりを点灯/消灯する(崩壊した建物は停電させる)
export function setBuildingLit(view: CityView, b: Building, on: boolean): void {
  const a = view.litAttrs[b.k];
  (a.array as Float32Array)[b.mi] = on ? 1 : 0;
  a.needsUpdate = true;
}

// 倒壊した建物の焼け色(このモジュールがcolorModeを先にimportしているので変換されない)
export const FALLEN_COL = new THREE.Color(0x5c564e);

// 建物のインスタンス行列を書く(sy=高さ倍率、tiltX/Z=傾き)
export function setBuildingMatrix(bMeshes: THREE.InstancedMesh[], b: Building,
    sy: number, tiltX: number, tiltZ: number): void {
  setInstanceAt(bMeshes[b.k], b.mi, b.x, b.gy + b.h * sy / 2 - 0.5, b.z,
    tiltX, b.rot, tiltZ, b.sx, Math.max(0.02, b.h * sy), b.sz);
}

// 倒壊: 基部の縁を支点に blast と反対側へ倒れる
const _tv = new THREE.Vector3();
const _tm1 = new THREE.Matrix4(), _tm2 = new THREE.Matrix4();
export function toppleMatrix(bMeshes: THREE.InstancedMesh[], b: Building,
    ang: number, dirx: number, dirz: number): void {
  instanceDummy.position.set(b.x, b.gy + b.h / 2 - 0.5, b.z);
  instanceDummy.rotation.set(0, b.rot, 0);
  instanceDummy.scale.set(b.sx, b.h, b.sz);
  instanceDummy.updateMatrix();
  const ext = (Math.abs(dirx) * b.sx + Math.abs(dirz) * b.sz) / 2;
  const px = b.x + dirx * ext, py = b.gy, pz = b.z + dirz * ext;
  _tv.set(dirz, 0, -dirx).normalize();       // この軸まわりの+回転で頭が dir 方向へ倒れる
  _tm1.makeRotationAxis(_tv, ang);
  _tm2.makeTranslation(-px, -py, -pz);
  _tm1.multiply(_tm2);
  _tm2.makeTranslation(px, py, pz);
  _tm2.multiply(_tm1).multiply(instanceDummy.matrix);
  bMeshes[b.k].setMatrixAt(b.mi, _tm2);
}

// 車1台を画面外へ隠す。updateCarsの毎フレーム転送は生存車両の範囲に絞られているため、
// 走行/駐車を問わずこの行列変更は個別に転送予約する
export function hideCarInstance(view: CityView, i: number): void {
  view.carMesh.setMatrixAt(i, HIDDEN_MAT);
  flushRange(view.carMesh.instanceMatrix, i, i, 16);
}

const _color = new THREE.Color();

// 木を空間チャンク×樹種ごとのInstancedMeshに分ける。街全体で1メッシュだと
// バウンディングスフィアが常に視錐台に入り数万本すべてが毎フレーム描画されるため、
// チャンク単位のフラスタムカリングで画面外の木のGPU負荷を落とす。
// (buildCityViewから関数として分離: 数万要素の作業配列をdisposeクロージャの
//  スコープに置かない=街の生存期間中メモリに残さないため)
// インスタンス色の乗算を外すシェーダーパッチ。
// 個体差・紅葉の色はインスタンス色で葉に掛けるが、同じ色が幹にも掛かって
// 紅葉の幹が赤くなってしまうため、幹のマテリアルはインスタンス色を無視する。
// onBeforeCompile時点のvertexShaderは#include展開前(展開はWebGLProgram内)なので、
// 該当チャンクをここで手動展開してから乗算行を消す。threeの更新で原文が変わると
// replaceが空振りするため、見つからなければthrowで気付く(dualShadowと同じ約束)
const INSTANCE_COLOR_LINE = 'vColor.rgb *= instanceColor.rgb;';
const ignoreInstanceColor = (sh: { vertexShader: string }): void => {
  if (!THREE.ShaderChunk.color_vertex.includes(INSTANCE_COLOR_LINE)) {
    throw new Error('ignoreInstanceColor: color_vertexに想定行がない(threeの更新でシェーダー原文が変わった)');
  }
  sh.vertexShader = sh.vertexShader.replace('#include <color_vertex>',
    THREE.ShaderChunk.color_vertex.replace(INSTANCE_COLOR_LINE, ''));
};

function buildTreeChunks(city: CityData): THREE.InstancedMesh[] {
  const TREE_TYPES = 4;
  // 樹種ごとの幹と葉の色(広葉樹 / 針葉樹 / ポプラ / ケヤキ)
  const trunkMats = [0x6b4f3a, 0x5a4634, 0x7d7060, 0x64503c]
    .map(c => {
      const m = new THREE.MeshLambertMaterial({ color: c });
      m.onBeforeCompile = ignoreInstanceColor;
      return m;
    });
  const leafMats = [0x4c7a36, 0x2f5a33, 0x6b8f3c, 0x3f6d38]
    .map(c => new THREE.MeshLambertMaterial({ color: c }));
  const treeGeos = makeTreeGeometries();
  const TREE_CHUNKS = 6;   // 6x6分割 = 900m角
  const chunkOf = (v: number): number => THREE.MathUtils.clamp(
    Math.floor((v + MAP_HALF) * TREE_CHUNKS / (MAP_HALF * 2)), 0, TREE_CHUNKS - 1);
  const keyOf = (t: CityData['trees'][number]): number =>
    (chunkOf(t.x) * TREE_CHUNKS + chunkOf(t.z)) * TREE_TYPES + t.type;
  // チャンク×樹種ごとの本数を数えてからメッシュを確保する
  const chunkCount = new Map<number, number>();
  for (const t of city.trees) {
    const ck = keyOf(t);
    chunkCount.set(ck, (chunkCount.get(ck) || 0) + 1);
  }
  const meshes: THREE.InstancedMesh[] = [];
  const chunkIndex = new Map<number, number>();   // キー → meshes内のインデックス
  for (const [ck, n] of chunkCount) {
    const ty = ck % TREE_TYPES;
    // 行列は破壊時にしか変わらない(そのときも範囲転送)のでusageは既定のStaticのまま
    const m = new THREE.InstancedMesh(treeGeos[ty], [trunkMats[ty], leafMats[ty]], n);
    chunkIndex.set(ck, meshes.length);
    meshes.push(m);
  }
  const filled = new Array<number>(meshes.length).fill(0);   // メッシュごとの採番カーソル
  for (const t of city.trees) {
    t.ci = chunkIndex.get(keyOf(t))!;
    t.mi = filled[t.ci]++;
    const mesh = meshes[t.ci];
    setInstanceAt(mesh, t.mi, t.x, t.gy - 0.2, t.z, 0, t.rotY, 0, t.s * t.w, t.s, t.s * t.w2);
    mesh.setColorAt(t.mi, _color.setRGB(t.color.r, t.color.g, t.color.b));
  }
  for (const m of meshes) {
    m.instanceColor!.needsUpdate = true;
    m.castShadow = m.receiveShadow = true;
  }
  return meshes;
}

// dispose関数を独立スコープで作る(buildCityViewの構築用ローカル群を捕捉しないため)
function makeDisposer(scene: THREE.Scene, group: THREE.Group): () => void {
  return () => {
    group.traverse(o => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      forEachMaterial(o, m => {
        // スロット名の列挙はしない: マテリアルが持つテクスチャを種類を問わず解放する
        // (map/emissiveMap/normalMap…と増えるたびにここへ足し忘れてリークしないように)
        for (const v of Object.values(m)) if (v instanceof THREE.Texture) v.dispose();
        m.dispose();
      });
    });
    scene.remove(group);
  };
}

export function buildCityView(scene: THREE.Scene, city: CityData, timeMode: TimeMode): CityView {
  const group = new THREE.Group();
  scene.add(group);

  // --- 地面と水面 ---
  const ground = new GroundView(city, rngFor(city.seed, 'groundNoise'));
  group.add(ground.mesh);
  const G = TIMES[timeMode].ground;
  const water = buildWaterSurface(city, group, G);

  // --- 建物(種類別InstancedMesh) ---
  const counts = new Array<number>(BUILDING_KINDS).fill(0);
  for (const b of city.buildings) counts[b.k] = Math.max(counts[b.k], b.mi + 1);

  const emissiveMats: THREE.MeshLambertMaterial[] = [];
  // 窓明かりの消灯用インスタンス属性 'lit' をemissiveに乗算する。
  // emissiveはインスタンス色の影響を受けないため、倒壊した建物の窓が
  // 光りっぱなしにならないよう属性で制御する
  const litEmissive = (sh: { vertexShader: string; fragmentShader: string }): void => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float lit;\nvarying float vLit;')
      .replace('#include <begin_vertex>', 'vLit = lit;\n#include <begin_vertex>');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vLit;')
      .replace('vec3 totalEmissiveRadiance = emissive;',
        'vec3 totalEmissiveRadiance = emissive * vLit;');
  };
  const mkFacade = (t: TexPair, eScale: number, eCol: number): THREE.MeshLambertMaterial => {
    const m = new THREE.MeshLambertMaterial({
      map: t.map, emissive: new THREE.Color(eCol),
      emissiveMap: t.emissiveMap, emissiveIntensity: TIMES[timeMode].emissive * eScale });
    m.onBeforeCompile = litEmissive;
    m.userData.eScale = eScale;
    emissiveMats.push(m);
    return m;
  };
  // 窓明かりの色: コンクリビル=温白、ガラスビル=蛍光灯寄りの涼白、民家=電球色寄りの白
  const texRng = rngFor(city.seed, 'facadeTex');
  const conMat = mkFacade(makeConcreteTexture(texRng), 1, 0xffe9c8);
  const glaMat = mkFacade(makeGlassTexture(texRng), 1.2, 0xe9f0fa);
  const houMat = mkFacade(makeHouseTexture(texRng), 0.8, 0xffdfb4);
  const roofTopMat = new THREE.MeshLambertMaterial({ color: 0x484c53 });
  const towerGeo = makeTowerGeometry();
  const houseGeo = makeHouseGeometry();
  // 頂点属性・インデックス・グループは共有しつつ、インスタンス属性 'lit' だけ
  // メッシュごとに持つジオメトリを作る(litAttrsはbMeshesと同順に積まれる)
  const litAttrs: THREE.InstancedBufferAttribute[] = [];
  const withLit = (src: THREE.BufferGeometry, n: number): THREE.BufferGeometry => {
    const geo = new THREE.BufferGeometry();
    geo.index = src.index;
    for (const name of Object.keys(src.attributes)) geo.setAttribute(name, src.attributes[name]);
    for (const g of src.groups) geo.addGroup(g.start, g.count, g.materialIndex);
    const lit = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, n)).fill(1), 1);
    geo.setAttribute('lit', lit);
    litAttrs.push(lit);
    return geo;
  };
  const bMeshes = [
    new THREE.InstancedMesh(withLit(towerGeo, counts[0]), [conMat, roofTopMat], counts[0]),
    new THREE.InstancedMesh(withLit(towerGeo, counts[1]), [glaMat, roofTopMat], counts[1]),
    ...ROOF_COLS.map((c, ri) => new THREE.InstancedMesh(withLit(houseGeo, counts[HOUSE_K0 + ri]),
      [houMat, new THREE.MeshLambertMaterial({ color: c })], counts[HOUSE_K0 + ri])),
  ];
  for (const m of bMeshes) m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  for (const b of city.buildings) {
    setBuildingMatrix(bMeshes, b, 1, 0, 0);
    bMeshes[b.k].setColorAt(b.mi, _color.setRGB(b.color.r, b.color.g, b.color.b));
  }
  for (let t = 0; t < bMeshes.length; t++) {
    if (counts[t]) bMeshes[t].instanceColor!.needsUpdate = true;
    bMeshes[t].castShadow = bMeshes[t].receiveShadow = true;
    group.add(bMeshes[t]);
  }

  // --- 車 ---
  const carMesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(4.6, 2, 2.2),
    new THREE.MeshLambertMaterial({ color: 0xffffff }), city.cars.length);
  carMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  for (const c of city.cars) {
    carMesh.setColorAt(c.i, _color.setHex(c.color));
    if (c.parked)                        // 停車中の車は行列を一度だけ焼き込む
      setInstanceAt(carMesh, c.i, c.px, c.y, c.pz, 0, c.rot, 0, 1, 1, 1);
  }
  carMesh.instanceColor!.needsUpdate = true;
  carMesh.castShadow = carMesh.receiveShadow = true;
  excludeFromFarShadow(carMesh);   // 全域マップには写らない(テクセルに埋もれる)ので描かない
  group.add(carMesh);

  // --- 木 ---
  const treeChunks = buildTreeChunks(city);
  for (const m of treeChunks) group.add(m);

  // 地面テクスチャを描く(ポケットパーク等の区画装飾はロット生成で決まっている)
  ground.drawGround(G);

  return {
    group, bMeshes, treeChunks, carMesh, ground, water, emissiveMats, litAttrs,
    dispose: makeDisposer(scene, group),
  };
}
