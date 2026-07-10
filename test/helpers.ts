// テスト共通ヘルパー

import * as THREE from 'three';
import { rngFor } from '../src/core/rng';
import { generateFeatures, Terrain } from '../src/core/terrain';
import { SunShadow, TIMES, type TimeMode } from '../src/render/sky';

// ---------- threeのシェーダー組み立ての再現(WebGLProgram.jsと同じ手順) ----------
// シェーダーパッチ(dualShadow / patchWaterShader)の最終GLSLをnodeで検証するために使う

const includePattern = /^[ \t]*#include +<([\w\d./]+)>/gm;
export function resolveIncludes(s: string): string {
  return s.replace(includePattern, (_m, inc: string) => {
    const c = (THREE.ShaderChunk as unknown as Record<string, string>)[inc];
    if (c === undefined) throw new Error(`unknown chunk: ${inc}`);
    return resolveIncludes(c);
  });
}

export function replaceLightNums(s: string, dirLights: number, dirShadows: number): string {
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
export function unrollLoops(s: string): string {
  return s.replace(unrollLoopPattern, (_m, start: string, end: string, snippet: string) => {
    let out = '';
    for (let i = parseInt(start); i < parseInt(end); i++) {
      out += snippet.replace(/\[\s*i\s*\]/g, `[ ${i} ]`).replace(/UNROLLED_LOOP_INDEX/g, String(i));
    }
    return out;
  });
}

// 簡易プリプロセッサ: #if/#ifdef/#elif/#else/#endifを評価して有効枝だけを残す
export function preprocess(src: string, initialDefines: string[]): string {
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

// フラグメントシェーダー原文(パッチ適用後でもよい)を最終GLSLへ組み立てる
export function assembleFragment(frag: string, dirLights: number, dirShadows: number,
    defines: string[]): string {
  frag = resolveIncludes(frag);
  frag = replaceLightNums(frag, dirLights, dirShadows);
  frag = unrollLoops(frag);
  return preprocess(frag, defines);
}

// 本体(cityGen)と同じストリーム割り当てで地形だけを生成する
export const mkTerrain = (seed: string): Terrain =>
  new Terrain(generateFeatures(rngFor(seed, 'features')), rngFor(seed, 'terrain'));

export interface SunRig { sun: THREE.DirectionalLight; camera: THREE.PerspectiveCamera; sunShadow: SunShadow }

// 本体(createGfx)と同じ構成の太陽+影のリグ。ライトのscene追加はSunShadowが行う
export function mkSunRig(scene: THREE.Scene, mode: TimeMode = 'day'): SunRig {
  const sun = new THREE.DirectionalLight(0xfff1d6, 1);
  sun.position.set(...TIMES[mode].sunPos);
  const camera = new THREE.PerspectiveCamera(55, 16 / 9, 2, 14000);
  return { sun, camera, sunShadow: new SunShadow(scene, sun, camera) };
}
