// 時間帯プリセットと太陽光の影

import * as THREE from 'three';
import './dualShadow';   // 精細マップ範囲外を全域マップへフォールバックさせるシェーダーパッチ
import { MAP_HALF } from '../core/config';

// r155以降ライト強度が物理単位になった(旧実装の内部π倍が廃止)ため、π倍して旧来の明るさを保つ
export const LIGHT_SCALE = Math.PI;

export type TimeMode = 'day' | 'dusk';

export interface GroundPalette {
  base: string; asphalt: string; sidewalk: string; block1: string; block2: string;
  park: string; house: string; lane: string;
  water: string; waterSurf: string; waterSpec: string; waterShine: number;
  bank: string; mtn1: string; mtn2: string; crater: string;
}

export interface TimePreset {
  fog: number; fogNear: number; fogFar: number;
  hemiSky: number; hemiGnd: number; hemiInt: number;
  sunCol: number; sunInt: number; sunPos: [number, number, number];
  emissive: number;
  ground: GroundPalette;
}

export const TIMES: Record<TimeMode, TimePreset> = {
  day: {
    fog: 0x8ec4f0, fogNear: 1600, fogFar: 9000,
    hemiSky: 0xbdd5ee, hemiGnd: 0x8a8578, hemiInt: 1.05,
    sunCol: 0xfff1d6, sunInt: 1.35, sunPos: [-900, 2000, 700], emissive: 0.06,
    ground: { base: '#6e6f68', asphalt: '#54575d', sidewalk: '#83858a', block1: '#72747a', block2: '#7a7c7f',
      park: '#385c3a', house: '#7f7c6d', lane: 'rgba(245,225,150,0.85)',
      water: '#3d6d95', waterSurf: '#487fab', waterSpec: '#a8bccc', waterShine: 120,
      bank: '#83816b', mtn1: '#46603c', mtn2: 'rgba(80,96,72,0)', crater: '#5b5142' },
  },
  dusk: {
    fog: 0x1c2438, fogNear: 1400, fogFar: 7500,
    hemiSky: 0x3a5480, hemiGnd: 0x241a12, hemiInt: 0.95,
    sunCol: 0xff9a5a, sunInt: 0.75, sunPos: [-1600, 700, 900], emissive: 0.85,
    ground: { base: '#1f211d', asphalt: '#191b20', sidewalk: '#33363c', block1: '#26282e', block2: '#2b2c31',
      park: '#22392a', house: '#2a2822', lane: 'rgba(190,175,120,0.5)',
      water: '#14222f', waterSurf: '#1b3044', waterSpec: '#ffb066', waterShine: 45,
      bank: '#26261e', mtn1: '#1a2a1a', mtn2: 'rgba(26,36,24,0)', crater: '#242019' },
  },
};

export interface SunShadowInput { focus: { x: number; y: number; z: number }; dist: number; pitch: number }

// 太陽の影は2枚構成:
//   精細マップ(sun)   … 影カメラを注視点に毎フレーム追従させ、カバー半径はズーム距離と
//                        視線の傾きから連続的に決める。位置と注視先を同じ量だけ動かすので
//                        光の向きは変わらず、シェーダー再コンパイルも起きない
//   全域マップ(sunFar) … 街全体を常にカバーする粗い影。精細マップの範囲外はシェーダー
//                        パッチ(dualShadow)がこちらへフォールバックするため、ズームで
//                        遠景の影が消えない。ライトとしては照明に寄与しない(intensity 0)。
//                        街は静的なので毎フレーム描き直さず、markFarDirtyで再描画を予約する
const SHADOW_MAP_RES = 4096;
const FAR_RES = 2048;                                  // 全域はテクセル約3.9m。粗いが遠景用なので足りる
const FAR_R = Math.hypot(MAP_HALF, MAP_HALF) + 250;    // 地図対角+建物の高さぶんの余白
const FAR_DIST = 5000;                                 // 原点からこの距離に置けば全域がnear/farに収まる
const FAR_BAKE_MS = 150;   // 全域マップ焼き直しの最短間隔。崩壊アニメーション中は毎フレーム
                           // dirtyになるため、全都市の影パスが二重に走り続けないよう間引く

// 影アクネ対策の法線オフセット(基礎値+カバー半径のテクセル約1個ぶん)。この値のぶんだけ
// 背の低い遮蔽物(木の幹など)の影が相殺されて消えるため、縞が出ない最小限に抑える
// (最大の縞の発生源だった地形が影を落とさなくなったので勾配は控えめで足りる)
const texelBias = (r: number, res: number): number => 0.3 + r * 2 / res;

export class SunShadow {
  readonly sunFar: THREE.DirectionalLight;   // 全域マップ用ライト
  private readonly sunOff: THREE.Vector3;    // 注視点から見た太陽の相対位置
  private shadowR = 0;              // 現在のカバー半径
  private farPending = false;       // 全域マップの焼き直し予約
  private farBakedAt = -Infinity;   // 最後に焼いた時刻(間引き用)
  private readonly _dir = new THREE.Vector3();
  private readonly _right = new THREE.Vector3();
  private readonly _up = new THREE.Vector3();
  private readonly _focus = new THREE.Vector3();
  private readonly _worldUp = new THREE.Vector3(0, 1, 0);
  // 前回の入力(変化検出用)
  private readonly _last = { fx: NaN, fy: 0, fz: 0, dist: 0, pitch: 0 };

  constructor(scene: THREE.Scene,
              private readonly sun: THREE.DirectionalLight,
              private readonly camera: THREE.PerspectiveCamera) {
    this.sunOff = new THREE.Vector3().copy(sun.position);
    sun.castShadow = true;
    sun.shadow.mapSize.set(SHADOW_MAP_RES, SHADOW_MAP_RES);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 8000;      // 夕暮れは太陽が低く、影カメラの奥行きが伸びるぶんの余裕
    sun.shadow.bias = -0.00005;   // far=8000mでは深度1単位が大きく、過大な負値は接地面を一様に影へ倒す

    // 全域マップ。intensity 0なので照明には寄与せず、影マップだけを持つ
    const far = this.sunFar = new THREE.DirectionalLight(0xffffff, 0);
    far.castShadow = true;
    far.shadow.mapSize.set(FAR_RES, FAR_RES);
    const fc = far.shadow.camera;
    fc.near = 1; fc.far = FAR_DIST + FAR_R + 100;
    fc.left = -FAR_R; fc.right = FAR_R; fc.top = FAR_R; fc.bottom = -FAR_R;
    fc.updateProjectionMatrix();
    far.shadow.bias = -0.00005;
    far.shadow.normalBias = texelBias(FAR_R, FAR_RES);
    // 街は静的なので毎フレーム描かず、markFarDirtyの予約時だけ焼き直す。動く車や瓦礫も
    // 焼き込まれるが、テクセル約3.9mとnormalBiasに埋もれて写らないため古くなっても見えない
    far.shadow.autoUpdate = false;
    this.placeFar();
    // 平行光源の影の配列順はシーンへの追加順で決まる。0=精細(sun)/1=全域(sunFar)で
    // あることをdualShadowのシェーダーパッチが前提にしているため、ここで順序ごと固定する
    scene.add(sun); scene.add(sun.target);
    scene.add(far); scene.add(far.target);
  }

  // 全域マップの焼き直しを予約する(建物の崩壊・木の消滅・街の再生成・太陽の移動)。
  // 実際の焼き直しはupdateがFAR_BAKE_MS間隔に間引いて行う
  markFarDirty(): void {
    this.farPending = true;
  }

  // 時間帯切り替え: 太陽方向を変え、次のupdateで両方の影マップへ反映させる
  setSunOffset(p: readonly [number, number, number]): void {
    this.sunOff.set(...p);
    this._last.fx = NaN;   // 精細マップの太陽位置を組み直させる
    this.placeFar();
  }

  // 全域ライトを現在の太陽方向へ置き直す(注視点に依存しない原点固定)
  private placeFar(): void {
    this.sunFar.position.copy(this.sunOff).normalize().multiplyScalar(FAR_DIST);
    this.markFarDirty();
  }

  private flushFar(): void {
    if (!this.farPending || performance.now() - this.farBakedAt < FAR_BAKE_MS) return;
    this.farPending = false;
    this.farBakedAt = performance.now();
    this.sunFar.shadow.needsUpdate = true;
  }

  update(cam: SunShadowInput): void {
    this.flushFar();
    const { sun, sunOff, _last } = this;
    // カメラも太陽も動いていないフレームは再計算しない(focus.yは街の再生成で地形ごと変わりうる)
    if (cam.focus.x === _last.fx && cam.focus.y === _last.fy && cam.focus.z === _last.fz &&
        cam.dist === _last.dist && cam.pitch === _last.pitch) return;
    _last.fx = cam.focus.x; _last.fy = cam.focus.y; _last.fz = cam.focus.z;
    _last.dist = cam.dist; _last.pitch = cam.pitch;
    // カバー半径はカメラ距離の1.15倍を基本に、視線が浅く遠くの地面まで画面に映るときは
    // 画面上端の視線が接地する距離まで広げる(解像度低下を抑えるため距離の2.5倍が上限。
    // 上限からあふれた遠景は全域マップが受け持つ)。
    // 段階切り替えではなく連続で変える: 影マップは毎フレーム再描画されるため投影行列の
    // 更新自体に追加コストはなく、ズーム中の影範囲の切り替わりが目立たない。
    // 下限300mまで絞ると最接近時のテクセルは約0.15mになり、車や木の幹の影も判別できる
    const graze = Math.max(cam.pitch - THREE.MathUtils.degToRad(this.camera.fov / 2), 0.16);
    const farHit = cam.dist * (Math.sin(cam.pitch) / Math.tan(graze) - Math.cos(cam.pitch));
    const r = THREE.MathUtils.clamp(
      Math.max(cam.dist * 1.15, Math.min(farHit * 1.05, cam.dist * 2.5)), 300, 4900);
    if (r !== this.shadowR) {
      this.shadowR = r;
      const c = sun.shadow.camera;
      c.left = -r; c.right = r; c.top = r; c.bottom = -r;
      c.updateProjectionMatrix();
      sun.shadow.normalBias = texelBias(r, SHADOW_MAP_RES);
    }
    // 注視点を光に直交する平面上でテクセル単位にスナップし、移動時の影エッジのちらつきを抑える
    const texel = r * 2 / SHADOW_MAP_RES;
    this._dir.copy(sunOff).normalize();
    this._right.crossVectors(this._worldUp, this._dir).normalize();
    this._up.crossVectors(this._dir, this._right);
    this._focus.set(cam.focus.x, cam.focus.y, cam.focus.z);
    this._focus.addScaledVector(this._right,
      Math.round(this._focus.dot(this._right) / texel) * texel - this._focus.dot(this._right));
    this._focus.addScaledVector(this._up,
      Math.round(this._focus.dot(this._up) / texel) * texel - this._focus.dot(this._up));
    sun.position.copy(this._focus).add(sunOff);
    sun.target.position.copy(this._focus);
  }
}
