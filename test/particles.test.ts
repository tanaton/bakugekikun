// ParticlePoolのGPU転送範囲(色はspawnしたスロット範囲だけを転送する)

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ParticlePool } from '../src/render/particles';

const spec = (r: number): Parameters<ParticlePool['spawn']>[0] =>
  ({ x: 0, y: 10, z: 0, vx: 0, vy: 0, vz: 0, life: 1, size: 4, r, g: 0.5, b: 0.1 });

describe('ParticlePoolの転送範囲', () => {
  it('spawnした色スロットの範囲だけをcolAttrの転送範囲に積む', () => {
    const pool = new ParticlePool(64, THREE.NormalBlending, new THREE.Scene());
    const col = pool.mesh.geometry.getAttribute('aColor') as THREE.BufferAttribute;
    col.clearUpdateRanges();
    pool.spawn(spec(1));   // slot 0
    pool.spawn(spec(1));   // slot 1
    pool.spawn(spec(1));   // slot 2
    pool.update(0.016);
    expect(col.updateRanges).toEqual([{ start: 0, count: 9 }]);   // slot0..2 × RGB

    // spawnのないフレームでは色の転送範囲を積まない
    col.clearUpdateRanges();
    pool.update(0.016);
    expect(col.updateRanges).toEqual([]);

    // 追加spawnはそのスロットだけ
    pool.spawn(spec(0.5));   // slot 3
    pool.update(0.016);
    expect(col.updateRanges).toEqual([{ start: 9, count: 3 }]);
  });
});
