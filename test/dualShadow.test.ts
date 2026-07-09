// 2枚構成シャドウ(dualShadowパッチ + SunShadowの全域マップ)の検証(node)

import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { MAP_HALF } from '../src/core/config';
import { DIR_LINE } from '../src/render/dualShadow';
import { TIMES } from '../src/render/sky';
import { mkSunRig, type SunRig } from './helpers';

const mkRig = (mode: 'day' | 'dusk' = 'day'): SunRig => mkSunRig(new THREE.Scene(), mode);

// ---------- threeのシェーダー組み立ての再現(WebGLProgram.jsと同じ手順) ----------

const includePattern = /^[ \t]*#include +<([\w\d./]+)>/gm;
function resolveIncludes(s: string): string {
  return s.replace(includePattern, (_m, inc: string) => {
    const c = (THREE.ShaderChunk as unknown as Record<string, string>)[inc];
    if (c === undefined) throw new Error(`unknown chunk: ${inc}`);
    return resolveIncludes(c);
  });
}

function replaceLightNums(s: string, dirLights: number, dirShadows: number): string {
  return s
    .replace(/NUM_DIR_LIGHTS/g, String(dirLights))
    .replace(/NUM_SPOT_LIGHTS/g, '0')
    .replace(/NUM_SPOT_LIGHT_MAPS/g, '0')
    .replace(/NUM_SPOT_LIGHT_COORDS/g, '0')
    .replace(/NUM_RECT_AREA_LIGHTS/g, '0')
    .replace(/NUM_POINT_LIGHTS/g, '0')
    .replace(/NUM_HEMI_LIGHTS/g, '1')
    .replace(/NUM_DIR_LIGHT_SHADOWS/g, String(dirShadows))
    .replace(/NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS/g, '0')
    .replace(/NUM_SPOT_LIGHT_SHADOWS/g, '0')
    .replace(/NUM_POINT_LIGHT_SHADOWS/g, '0');
}

const unrollLoopPattern = /#pragma unroll_loop_start\s+for\s*\(\s*int\s+i\s*=\s*(\d+)\s*;\s*i\s*<\s*(\d+)\s*;\s*i\s*\+\+\s*\)\s*{([\s\S]+?)}\s+#pragma unroll_loop_end/g;
function unrollLoops(s: string): string {
  return s.replace(unrollLoopPattern, (_m, start: string, end: string, snippet: string) => {
    let out = '';
    for (let i = parseInt(start); i < parseInt(end); i++) {
      out += snippet.replace(/\[\s*i\s*\]/g, `[ ${i} ]`).replace(/UNROLLED_LOOP_INDEX/g, String(i));
    }
    return out;
  });
}

// 簡易プリプロセッサ: #if/#ifdef/#elif/#else/#endifを評価して有効枝だけを残す
function preprocess(src: string, initialDefines: string[]): string {
  const defines = new Map<string, string>(initialDefines.map(d => [d, '1']));
  type Frame = { parent: boolean; active: boolean; taken: boolean };
  const stack: Frame[] = [];
  const cur = (): boolean => stack.length === 0 || stack[stack.length - 1].active;
  const evalExpr = (e: string): boolean => {
    const js = e
      .replace(/defined\s*\(\s*(\w+)\s*\)/g, (_m, n: string) => defines.has(n) ? '1' : '0')
      .replace(/[A-Za-z_]\w*/g, (n) => {
        const v = defines.get(n);
        return v !== undefined && /^\d+$/.test(v) ? v : '0';
      });
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    return Boolean(new Function(`return (${js});`)());
  };
  // #ifdef/#ifndefは#if defined()へ正規化して分岐を1本にする
  src = src
    .replace(/^([ \t]*)#ifdef\s+(\w+)/gm, '$1#if defined( $2 )')
    .replace(/^([ \t]*)#ifndef\s+(\w+)/gm, '$1#if ! defined( $2 )');
  const out: string[] = [];
  for (const line of src.split('\n')) {
    const t = line.trim();
    let m: RegExpExecArray | null;
    if ((m = /^#if\s+(.+)/.exec(t))) {
      const p = cur(), a = p && evalExpr(m[1]);
      stack.push({ parent: p, active: a, taken: a });
    } else if ((m = /^#elif\s+(.+)/.exec(t))) {
      const f = stack[stack.length - 1];
      f.active = f.parent && !f.taken && evalExpr(m[1]);
      f.taken = f.taken || f.active;
    } else if (/^#else\b/.test(t)) {
      const f = stack[stack.length - 1];
      f.active = f.parent && !f.taken;
      f.taken = true;
    } else if (/^#endif\b/.test(t)) {
      stack.pop();
    } else if ((m = /^#define\s+(\w+)(?:\s+(.*))?/.exec(t))) {
      if (cur()) { defines.set(m[1], (m[2] ?? '1').trim()); out.push(line); }
    } else if (cur()) {
      out.push(line);
    }
  }
  if (stack.length) throw new Error('#if/#endifが釣り合っていない');
  return out.join('\n');
}

function assembleLambertFragment(dirLights: number, dirShadows: number, defines: string[]): string {
  let frag = THREE.ShaderLib.lambert.fragmentShader;
  frag = resolveIncludes(frag);
  frag = replaceLightNums(frag, dirLights, dirShadows);
  frag = unrollLoops(frag);
  return preprocess(frag, defines);
}

describe('dualShadowシェーダーパッチ', () => {
  it('フォールバック関数と2枚構成の分岐が注入される', () => {
    // sky.tsのimportで適用済み
    expect(THREE.ShaderChunk.shadowmap_pars_fragment).toContain('bkDualShadow');
    expect(THREE.ShaderChunk.lights_fragment_begin).toContain('bkDualShadow');
    // 影が2枚でない構成(影オフなど)向けの原文も#else側に残っている
    expect(THREE.ShaderChunk.lights_fragment_begin).toContain(DIR_LINE);
  });

  it('平行光源2灯で組み立てた最終シェーダーが2枚構成になる', () => {
    const glsl = assembleLambertFragment(2, 2, ['USE_SHADOWMAP', 'SHADOWMAP_TYPE_PCF']);
    // フォールバック関数が1回定義され、0番ライトのループ回から1回だけ呼ばれる
    expect(glsl.match(/float bkDualShadow\(/g)).toHaveLength(1);
    const calls = glsl.match(/bkDualShadow\( vDirectionalShadowCoord\[ 0 \], vDirectionalShadowCoord\[ 1 \] \)/g);
    expect(calls).toHaveLength(1);
    expect(glsl.indexOf('float bkDualShadow(')).toBeLessThan(glsl.lastIndexOf('bkDualShadow( vDirectionalShadowCoord'));
    // 全域ライト(1番)のループ回では影をサンプリングしない。
    // getShadowの直接呼び出しはbkDualShadow内の2回(精細/全域)だけ
    expect(glsl.match(/getShadow\( directionalShadowMap\[/g)).toHaveLength(2);
    // ループ展開の置換漏れと波括弧の対応
    expect(glsl).not.toContain('UNROLLED_LOOP_INDEX');
    expect(glsl.match(/{/g)!.length).toBe(glsl.match(/}/g)!.length);
  });

  it('平行光源1灯(通常構成)では従来どおり単独の影になる', () => {
    const glsl = assembleLambertFragment(1, 1, ['USE_SHADOWMAP', 'SHADOWMAP_TYPE_PCF']);
    expect(glsl).not.toContain('bkDualShadow(');
    expect(glsl.match(/getShadow\( directionalShadowMap\[ 0 \]/g)).toHaveLength(1);
  });

  it('影オフ(USE_SHADOWMAPなし)では影のコードが消える', () => {
    const glsl = assembleLambertFragment(2, 2, []);
    expect(glsl).not.toContain('bkDualShadow');
    expect(glsl).not.toContain('getShadow(');
  });
});

// SunShadow.updateを固定カメラで1フレームぶん回す
const tick = (ss: SunRig['sunShadow'], fx = 0): void =>
  ss.update({ focus: { x: fx, y: 0, z: 0 }, dist: 950, pitch: 0.95 });

describe('SunShadowの全域マップ', () => {
  it('照明に寄与しない(intensity 0)影専用ライトで、初回updateで焼かれる', () => {
    const { sunShadow: ss } = mkRig();
    expect(ss.sunFar.intensity).toBe(0);
    expect(ss.sunFar.castShadow).toBe(true);
    expect(ss.sunFar.shadow.autoUpdate).toBe(false);   // 静的な街を毎フレーム描き直さない
    tick(ss);
    expect(ss.sunFar.shadow.needsUpdate).toBe(true);
  });

  it('sun→sunFarの順でsceneへ追加される(影配列 0=精細/1=全域 の前提)', () => {
    const scene = new THREE.Scene();
    const { sun, sunShadow } = mkSunRig(scene);
    const c = scene.children;
    expect(c.indexOf(sun)).toBeGreaterThanOrEqual(0);
    expect(c.indexOf(sun)).toBeLessThan(c.indexOf(sunShadow.sunFar));
    expect(c).toContain(sun.target);
    expect(c).toContain(sunShadow.sunFar.target);
  });

  it('影カメラが昼・夕暮れとも街全体(±MAP_HALF、高さ200mまで)を覆う', () => {
    for (const mode of ['day', 'dusk'] as const) {
      const ss = mkRig(mode).sunShadow;
      const far = ss.sunFar;
      far.updateMatrixWorld(true);
      far.target.updateMatrixWorld(true);
      far.shadow.updateMatrices(far);
      const cam = far.shadow.camera;
      for (const x of [-MAP_HALF, MAP_HALF]) {
        for (const z of [-MAP_HALF, MAP_HALF]) {
          for (const y of [0, 200]) {
            const p = new THREE.Vector3(x, y, z)
              .applyMatrix4(cam.matrixWorldInverse).applyMatrix4(cam.projectionMatrix);
            expect(Math.abs(p.x), `${mode} (${x},${y},${z})`).toBeLessThanOrEqual(1);
            expect(Math.abs(p.y), `${mode} (${x},${y},${z})`).toBeLessThanOrEqual(1);
            expect(Math.abs(p.z), `${mode} (${x},${y},${z})`).toBeLessThanOrEqual(1);
          }
        }
      }
    }
  });

  it('太陽方向の変化(setSunOffset)で全域ライトが置き直され、次のupdateで焼き直される', () => {
    let now = 0;
    const spy = vi.spyOn(performance, 'now').mockImplementation(() => now);
    try {
      const ss = mkRig().sunShadow;
      tick(ss);   // 初回の焼き付け
      ss.sunFar.shadow.needsUpdate = false;
      // カメラだけ動いても全域マップは焼き直さない
      now += 1000; tick(ss, 100);
      expect(ss.sunFar.shadow.needsUpdate).toBe(false);
      // applyTime相当
      ss.setSunOffset(TIMES.dusk.sunPos);
      now += 1000; tick(ss, 100);
      expect(ss.sunFar.shadow.needsUpdate).toBe(true);
      const dir = new THREE.Vector3(...TIMES.dusk.sunPos).normalize();
      expect(ss.sunFar.position.clone().normalize().distanceTo(dir)).toBeLessThan(1e-6);
    } finally { spy.mockRestore(); }
  });

  it('markFarDirtyの焼き直しは間引かれるが、予約は保持され必ず実行される', () => {
    let now = 0;
    const spy = vi.spyOn(performance, 'now').mockImplementation(() => now);
    try {
      const ss = mkRig().sunShadow;
      tick(ss);   // 初回の焼き付け
      ss.sunFar.shadow.needsUpdate = false;
      ss.markFarDirty();
      now += 16; tick(ss);    // 前回の焼き付け直後は間引かれる(崩壊中の毎フレームdirty対策)
      expect(ss.sunFar.shadow.needsUpdate).toBe(false);
      now += 1000; tick(ss);  // 間隔が空けば焼き直される
      expect(ss.sunFar.shadow.needsUpdate).toBe(true);
    } finally { spy.mockRestore(); }
  });
});
