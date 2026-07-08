// シミュレーション状態(街の再生成でリセットされる可変状態)の型と初期化

import type * as THREE from 'three';
import type { Building } from '../core/types';
import type { FxMesh } from '../render/fxPool';
import type { HudStats } from '../ui/hud';

export interface Missile {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  target: THREE.Vector3;
  mesh: THREE.Mesh;
  marker: THREE.Mesh | null;
  trailT: number;
  split: boolean;              // クラスター弾: 上空で子弾に分裂
  boom: number | 'nuke';       // 'nuke' か通常爆発の半径
}

export interface ActiveFx {
  mesh: FxMesh;
  life: number;
  age: number;
  update: (mesh: FxMesh, k: number) => void;
}

// 崩壊中の建物(倒壊't' or 圧壊'c')。delayで崩壊ウェーブを表現し、
// dustedは着火時の粉塵を一度だけ出すためのフラグ
export type Collapse =
  | { mode: 't'; b: Building; t: number; dur: number; delay: number; dusted: boolean;
      amax: number; dirx: number; dirz: number }
  | { mode: 'c'; b: Building; t: number; dur: number; delay: number; dusted: boolean;
      ax: number; az: number };

export interface DelayedBoom { t: number; x: number; z: number }
export interface BurnSite { x: number; z: number; gy: number; until: number; next: number }
export interface BurningBldg { b: Building; collapseAt: number; next: number }
export interface NukeEmitter { x: number; z: number; gy: number; t: number; dur: number }

export interface SimState {
  simT: number;                // シミュレーション経過時間
  missiles: Missile[];
  fx: ActiveFx[];
  collapsing: Collapse[];
  delayedBooms: DelayedBoom[];   // 二次爆発の予約
  burnSites: BurnSite[];         // 跡地の延焼地点
  burningBldgs: BurningBldg[];   // 炎上中(時間差で崩壊する)建物
  nukeEmitters: NukeEmitter[];   // キノコ雲を数秒かけて生成し続ける
  stats: HudStats;
  shake: number;
}

export function createSimState(): SimState {
  return {
    simT: 0,
    missiles: [], fx: [], collapsing: [],
    delayedBooms: [], burnSites: [], burningBldgs: [], nukeEmitters: [],
    stats: { bDead: 0, bTotal: 0, cDead: 0, cTotal: 0, tDead: 0, tTotal: 0, mCount: 0, damage: 0, shown: 0 },
    shake: 0,
  };
}
