// GPUパーティクル(火・煙)。固定長SlotPool + Float32Arrayの部分転送

import * as THREE from 'three';
import { SlotPool, type Slotted } from '../core/slotPool';

const P_VERT = `
  attribute float aSize; attribute float aAlpha; attribute vec3 aColor;
  varying float vA; varying vec3 vC;
  void main(){
    vA = aAlpha; vC = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * (760.0 / max(1.0, -mv.z));
    gl_Position = projectionMatrix * mv;
  }`;
const P_FRAG = `
  varying float vA; varying vec3 vC;
  void main(){
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.06, d) * vA;
    if(a < 0.012) discard;
    gl_FragColor = vec4(vC, a);
  }`;

// spawn時に渡すパラメータ(省略時はデフォルト)
export interface ParticleSpec {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number; size: number;
  r: number; g: number; b: number;
  grav?: number; drag?: number; fadeIn?: number; growth?: number;
  baseAlpha?: number; gy?: number;
}

// spawnで全フィールドを必須化した内部表現(ParticleSpecのオブジェクトを補完して使い回す)
interface Particle extends Slotted, ParticleSpec {
  age: number;
  grav: number; drag: number; fadeIn: number; growth: number;
  baseAlpha: number; gy: number;
}

export class ParticlePool {
  readonly max: number;
  private readonly pool: SlotPool<Particle>;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly size: Float32Array;
  private readonly alpha: Float32Array;
  private readonly posAttr: THREE.BufferAttribute;
  private readonly colAttr: THREE.BufferAttribute;
  private readonly sizeAttr: THREE.BufferAttribute;
  private readonly alphaAttr: THREE.BufferAttribute;
  readonly mesh: THREE.Points;
  private colDirty = false;

  constructor(max: number, blending: THREE.Blending, scene: THREE.Scene) {
    this.max = max;
    this.pool = new SlotPool<Particle>(max);
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage) as THREE.BufferAttribute;
    this.colAttr = new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage) as THREE.BufferAttribute;
    this.sizeAttr = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage) as THREE.BufferAttribute;
    this.alphaAttr = new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage) as THREE.BufferAttribute;
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('aColor', this.colAttr);
    geo.setAttribute('aSize', this.sizeAttr);
    geo.setAttribute('aAlpha', this.alphaAttr);
    this.mesh = new THREE.Points(geo, new THREE.ShaderMaterial({
      vertexShader: P_VERT, fragmentShader: P_FRAG,
      blending, transparent: true, depthWrite: false }));
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.clear();
  }

  clear(): void {
    this.pool.clear();
    this.alpha.fill(0);
    this.alphaAttr.needsUpdate = true;
  }

  spawn(s: ParticleSpec): void {
    // 呼び出し側のリテラルをそのまま粒子として使う(spawnはホットパスなので確保は増やさない)。
    // 省略可能フィールドはここでデフォルトを埋めて必須化する
    const p = s as Particle;
    p.age = 0;
    p.grav = s.grav ?? 0; p.drag = s.drag ?? 0; p.fadeIn = s.fadeIn ?? 0; p.growth = s.growth ?? 0;
    p.baseAlpha = s.baseAlpha ?? 1; p.gy = s.gy ?? 0;
    this.pool.spawn(p);
    // 色は寿命を通じて不変なのでspawn時に1回だけ書く(毎フレームのバッファ転送を省く)
    this.col[p.slot * 3] = s.r; this.col[p.slot * 3 + 1] = s.g; this.col[p.slot * 3 + 2] = s.b;
    this.colDirty = true;
  }

  update(dt: number): void {
    if (!this.pool.list.length) return;   // 空のときはGPU転送も省く
    let lo = this.max, hi = -1;           // 今フレームに書いたスロット範囲(GPU転送の範囲指定用)
    this.pool.sweep(p => {
      const s = p.slot;
      if (s < lo) lo = s;
      if (s > hi) hi = s;
      p.age += dt;
      if (p.age >= p.life) { this.alpha[s] = 0; return false; }
      p.vy -= p.grav * dt;
      const dr = p.drag ? Math.exp(-p.drag * dt) : 1;
      p.vx *= dr; p.vy *= dr; p.vz *= dr;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      const gnd = p.gy + 1;
      if (p.y < gnd && p.vy < 0) { p.y = gnd; p.vy *= -0.3; p.vx *= 0.6; p.vz *= 0.6; }
      const k = p.age / p.life;
      const fade = p.fadeIn ? Math.min(1, p.age / p.fadeIn) : 1;
      this.pos[s * 3] = p.x; this.pos[s * 3 + 1] = p.y; this.pos[s * 3 + 2] = p.z;
      this.size[s] = p.size * (p.growth ? (1 + k * p.growth) : 1);
      this.alpha[s] = (1 - k) * fade * p.baseAlpha;
      return true;
    });
    if (hi >= lo) {   // 書き換えたスロット範囲だけGPUへ転送する
      this.posAttr.addUpdateRange(lo * 3, (hi - lo + 1) * 3);
      this.sizeAttr.addUpdateRange(lo, hi - lo + 1);
      this.alphaAttr.addUpdateRange(lo, hi - lo + 1);
      this.posAttr.needsUpdate = this.sizeAttr.needsUpdate = this.alphaAttr.needsUpdate = true;
    }
    if (this.colDirty) { this.colAttr.needsUpdate = true; this.colDirty = false; }
  }
}
