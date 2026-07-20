// updateCameraの移動入力(WASD/矢印/ジョイスティック)の単体テスト

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { MAP_HALF } from '../src/core/config';
import type { Terrain } from '../src/core/terrain';
import type { SunShadow } from '../src/render/sky';
import { updateCamera, type InputState } from '../src/ui/input';

const terrain = { h: () => 0 } as unknown as Terrain;
const sunShadow = { update() { /* noop */ } } as unknown as SunShadow;

function makeInput(keys: Record<string, boolean> = {},
    move = { x: 0, y: 0 }, yaw = 0): InputState {
  return {
    cam: { focus: new THREE.Vector3(0, 0, 0), yaw, pitch: 0.95, dist: 1000 },
    keys, move, dash: false,
    zoomRange: { min: 40, max: 4200 },
  };
}

// 1ステップ進めてfocusのXZ変位を返す
function step(input: InputState, dt = 0.016): { x: number; z: number } {
  updateCamera(input, dt, terrain, new THREE.PerspectiveCamera(), sunShadow, { shake: 0 });
  return { x: input.cam.focus.x, z: input.cam.focus.z };
}

describe('updateCameraの移動入力', () => {
  it('矢印キーはWASDと同じ変位になる', () => {
    const pairs: [string, string][] = [
      ['KeyW', 'ArrowUp'], ['KeyS', 'ArrowDown'], ['KeyA', 'ArrowLeft'], ['KeyD', 'ArrowRight'],
    ];
    for (const [wasd, arrow] of pairs) {
      const a = step(makeInput({ [wasd]: true }));
      const b = step(makeInput({ [arrow]: true }));
      expect(b.x).toBeCloseTo(a.x, 10);
      expect(b.z).toBeCloseTo(a.z, 10);
    }
  });

  it('ジョイスティックのmove(0,1)はKeyWと同じ変位になる', () => {
    const a = step(makeInput({ KeyW: true }));
    const b = step(makeInput({}, { x: 0, y: 1 }));
    expect(b.x).toBeCloseTo(a.x, 10);
    expect(b.z).toBeCloseTo(a.z, 10);
  });

  it('前進はヨー0で-Z方向、ヨーπ/2で-X方向', () => {
    const a = step(makeInput({ KeyW: true }, { x: 0, y: 0 }, 0));
    expect(a.x).toBeCloseTo(0, 10);
    expect(a.z).toBeLessThan(0);
    const b = step(makeInput({ KeyW: true }, { x: 0, y: 0 }, Math.PI / 2));
    expect(b.x).toBeLessThan(0);
    expect(b.z).toBeCloseTo(0, 10);
  });

  it('斜め移動は正規化されて単独キーと等速', () => {
    const solo = step(makeInput({ KeyW: true }));
    const diag = step(makeInput({ KeyW: true, KeyD: true }));
    const soloLen = Math.hypot(solo.x, solo.z);
    expect(Math.hypot(diag.x, diag.z)).toBeCloseTo(soloLen, 10);
  });

  it('長さ1以下のアナログ入力は正規化されない(微小入力=低速)', () => {
    const full = step(makeInput({}, { x: 0, y: 1 }));
    const half = step(makeInput({}, { x: 0, y: 0.5 }));
    expect(Math.hypot(half.x, half.z)).toBeCloseTo(Math.hypot(full.x, full.z) / 2, 10);
  });

  it('Shiftで2.4倍速になる', () => {
    const base = step(makeInput({ KeyW: true }));
    const fast = step(makeInput({ KeyW: true, ShiftLeft: true }));
    expect(Math.hypot(fast.x, fast.z)).toBeCloseTo(Math.hypot(base.x, base.z) * 2.4, 10);
  });

  it('注視点はマップ端にクランプされる', () => {
    const input = makeInput({}, { x: 1, y: 0 });
    for (let i = 0; i < 100; i++) step(input, 0.5);
    expect(input.cam.focus.x).toBeLessThanOrEqual(MAP_HALF);
  });
});
