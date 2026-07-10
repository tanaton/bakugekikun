// ParticlePoolのGPU転送範囲(色はspawnしたスロット範囲だけを転送する)とレコード再利用

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ParticlePool } from '../src/render/particles';

const spawn = (pool: ParticlePool, r: number): void => {
  const p = pool.spawn(0, 10, 0, r, 0.5, 0.1);
  p.life = 1; p.size = 4;
};

describe('ParticlePoolの転送範囲', () => {
  it('spawnした色スロットの範囲だけをcolAttrの転送範囲に積む', () => {
    const pool = new ParticlePool(64, THREE.NormalBlending, new THREE.Scene());
    const col = pool.mesh.geometry.getAttribute('aColor') as THREE.BufferAttribute;
    col.clearUpdateRanges();
    spawn(pool, 1);   // slot 0
    spawn(pool, 1);   // slot 1
    spawn(pool, 1);   // slot 2
    pool.update(0.016);
    expect(col.updateRanges).toEqual([{ start: 0, count: 9 }]);   // slot0..2 × RGB

    // spawnのないフレームでは色の転送範囲を積まない
    col.clearUpdateRanges();
    pool.update(0.016);
    expect(col.updateRanges).toEqual([]);

    // 追加spawnはそのスロットだけ
    spawn(pool, 0.5);   // slot 3
    pool.update(0.016);
    expect(col.updateRanges).toEqual([{ start: 9, count: 3 }]);
  });
});

describe('ParticlePoolのレコード再利用', () => {
  it('死んだ粒子のレコードを次のspawnが使い回し、フィールドはリセットされる', () => {
    const pool = new ParticlePool(8, THREE.NormalBlending, new THREE.Scene());
    const p1 = pool.spawn(0, 10, 0, 1, 1, 1);
    p1.life = 0.1; p1.size = 5; p1.grav = 100; p1.drag = 2; p1.baseAlpha = 0.5;
    pool.update(0.2);            // 寿命切れで死ぬ → レコードが回収される
    const p2 = pool.spawn(3, 4, 5, 1, 1, 1);
    expect(p2).toBe(p1);         // 同一レコード(spawnごとの新規確保なし)
    expect(p2.x).toBe(3);
    expect(p2.y).toBe(4);
    expect(p2.age).toBe(0);
    expect(p2.grav).toBe(0);     // 前の個体の値が残らない
    expect(p2.drag).toBe(0);
    expect(p2.baseAlpha).toBe(1);
  });
});
