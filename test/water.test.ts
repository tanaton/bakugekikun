// 水面(法線マップ生成 + シェーダーパッチ)の検証(node)

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { CityData } from '../src/core/cityGen';
import { rngFor, type Rng } from '../src/core/rng';
import { TIMES } from '../src/render/sky';
import { buildWaterSurface, FOAM_DIFFUSE_LINE, makeWaterNormalData, MAPN_LINE, OUTGOING_LINE,
  patchFoamShader, patchWaterShader, type WaterView } from '../src/render/water';
import { assembleFragment, mkTerrain } from './helpers';

const rng = (): Rng => rngFor('WATER-TEST', 'waterTex');

// RGBA8の1画素を単位法線ベクトルへ戻す
const decode = (d: Uint8Array, p: number): [number, number, number] =>
  [(d[p] - 127.5) / 127.5, (d[p + 1] - 127.5) / 127.5, (d[p + 2] - 127.5) / 127.5];

describe('makeWaterNormalData', () => {
  it('同じシードから同じバイト列(決定性)', () => {
    expect(makeWaterNormalData(rng(), 64)).toEqual(makeWaterNormalData(rng(), 64));
  });

  it('全画素が上向き(B>=128)の単位法線', () => {
    const d = makeWaterNormalData(rng(), 64);
    for (let p = 0; p < d.length; p += 4) {
      expect(d[p + 2]).toBeGreaterThanOrEqual(128);
      expect(d[p + 3]).toBe(255);
      const [x, y, z] = decode(d, p);
      expect(Math.hypot(x, y, z)).toBeCloseTo(1, 1.5);
    }
  });

  it('解像度はサンプリング密度だけを変える(波はサイズ非依存)', () => {
    // size=64の画素(x,y)とsize=128の画素(2x,2y)は同じuv点のサンプルなので一致する
    const d64 = makeWaterNormalData(rng(), 64);
    const d128 = makeWaterNormalData(rng(), 128);
    for (let y = 0; y < 64; y += 7) {
      for (let x = 0; x < 64; x += 7) {
        const p64 = (y * 64 + x) * 4, p128 = (y * 2 * 128 + x * 2) * 4;
        expect(d64.slice(p64, p64 + 4)).toEqual(d128.slice(p128, p128 + 4));
      }
    }
  });

  it('タイル境界が継ぎ目なし(端をまたぐ変化量が内部の変化量と同程度)', () => {
    const size = 64;
    const d = makeWaterNormalData(rng(), size);
    const diff = (x0: number, y0: number, x1: number, y1: number): number => {
      const a = decode(d, (y0 * size + x0) * 4), b = decode(d, (y1 * size + x1) * 4);
      return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    };
    let inner = 0, wrap = 0;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size - 1; x++) {
        inner = Math.max(inner, diff(x, y, x + 1, y));
        inner = Math.max(inner, diff(y, x, y, x + 1));
      }
      wrap = Math.max(wrap, diff(size - 1, y, 0, y));   // 横の継ぎ目
      wrap = Math.max(wrap, diff(y, size - 1, y, 0));   // 縦の継ぎ目
    }
    expect(wrap).toBeLessThanOrEqual(inner * 1.5);
  });
});

describe('patchWaterShader', () => {
  const mkView = (): { time: THREE.IUniform<number>; skyColor: THREE.IUniform<THREE.Color> } =>
    ({ time: { value: 0 }, skyColor: { value: new THREE.Color('#9fc8ee') } });
  const mkShader = (): { uniforms: Record<string, THREE.IUniform>; fragmentShader: string } =>
    ({ uniforms: {}, fragmentShader: THREE.ShaderLib.phong.fragmentShader });

  it('uniformは共有オブジェクトがそのまま登録される(値の後書きが効く)', () => {
    const v = mkView(), sh = mkShader();
    patchWaterShader(sh, v.time, v.skyColor);
    expect(sh.uniforms.uWaterTime).toBe(v.time);
    expect(sh.uniforms.uSkyColor).toBe(v.skyColor);
  });

  it('組み立てた最終シェーダーが2層法線+フレネルになり、影経路も生きている', () => {
    const v = mkView(), sh = mkShader();
    patchWaterShader(sh, v.time, v.skyColor);
    const glsl = assembleFragment(sh.fragmentShader, 2, 2,
      ['USE_SHADOWMAP', 'SHADOWMAP_TYPE_PCF', 'USE_NORMALMAP', 'USE_NORMALMAP_TANGENTSPACE']);
    // 法線マップを2回サンプルし、元の1回サンプル行は消えている
    expect(glsl.match(/texture2D\( normalMap,/g)).toHaveLength(2);
    expect(glsl).not.toContain(MAPN_LINE);
    // 合成後もチャンク末尾のスケール適用とTBN変換は原文のまま生きている
    expect(glsl).toContain('mapN.xy *= normalScale;');
    expect(glsl).toContain('normal = normalize( tbn * mapN );');
    // uniformとフレネル項
    expect(glsl).toContain('uniform float uWaterTime;');
    expect(glsl).toContain('uniform vec3 uSkyColor;');
    expect(glsl).toContain('bkFres');
    expect(glsl).not.toContain(OUTGOING_LINE);
    // dualShadowパッチと共存し、2枚構成の影サンプリングが残る
    expect(glsl).toContain('bkDualShadow(');
  });

  it('threeの更新でシェーダー原文が変わったらthrowで気付く', () => {
    const v = mkView();
    // フラグメント本文のoutgoingLight行が変わった場合
    expect(() => patchWaterShader({ uniforms: {}, fragmentShader: 'void main() {}' },
      v.time, v.skyColor)).toThrow(/想定行がない/);
    // normal_fragment_mapsチャンクが変わった場合
    const orig = THREE.ShaderChunk.normal_fragment_maps;
    (THREE.ShaderChunk as { normal_fragment_maps: string }).normal_fragment_maps =
      orig.replace('mapN', 'renamed');
    try {
      expect(() => patchWaterShader(mkShader(), v.time, v.skyColor)).toThrow(/想定行がない/);
    } finally {
      (THREE.ShaderChunk as { normal_fragment_maps: string }).normal_fragment_maps = orig;
    }
  });
});

describe('patchFoamShader', () => {
  const mkShader = (): { uniforms: Record<string, THREE.IUniform>;
      vertexShader: string; fragmentShader: string } =>
    ({ uniforms: {}, vertexShader: THREE.ShaderLib.basic.vertexShader,
      fragmentShader: THREE.ShaderLib.basic.fragmentShader });

  it('時刻uniformを共有し、foamInfo属性が透明度へ乗る', () => {
    const time = { value: 0 }, sh = mkShader();
    patchFoamShader(sh, time);
    expect(sh.uniforms.uWaterTime).toBe(time);
    const glsl = assembleFragment(sh.fragmentShader, 0, 0, []);
    expect(glsl).toContain(FOAM_DIFFUSE_LINE);   // 原文の直後に乗算を足す(置換でなく追記)
    expect(glsl).toContain('diffuseColor.a *= vFoam.x');
    // 頂点側: 属性の宣言と受け渡し
    expect(sh.vertexShader).toContain('attribute vec2 foamInfo;');
    expect(sh.vertexShader).toContain('vFoam = foamInfo;');
  });

  it('threeの更新でシェーダー原文が変わったらthrowで気付く', () => {
    expect(() => patchFoamShader({ uniforms: {}, vertexShader: '', fragmentShader: 'void main() {}' },
      { value: 0 })).toThrow(/想定行がない/);
  });
});

describe('buildWaterSurface', () => {
  // buildWaterSurfaceはseedとterrain.featsしか使わないので、地形だけの疑似CityDataで足りる
  const mkCity = (seed: string): CityData =>
    ({ seed, terrain: mkTerrain(seed) } as unknown as CityData);

  it('水域のあるシードでWaterViewを返し、水面と泡が水底より上に浮く', () => {
    const group = new THREE.Group();
    const water = buildWaterSurface(mkCity('BAKUGEKI-01'), group, TIMES.day.ground) as WaterView;
    expect(water).not.toBeNull();
    const meshes = group.children as THREE.Mesh[];
    const surf = meshes.filter(m => m.material instanceof THREE.MeshPhongMaterial);
    const foam = meshes.filter(m => m.material instanceof THREE.MeshBasicMaterial);
    expect(surf.length).toBeGreaterThan(0);
    expect(foam.length).toBe(surf.length);   // 河川1枚につき泡リング1本
    for (const m of surf) {
      expect(m.receiveShadow).toBe(true);   // 岸辺の建物・木の影が水面に落ちる
      expect(m.position.y).toBeGreaterThan(-12);
      expect(m.position.y).toBeLessThan(-10);
    }
    for (const m of foam) {
      const mat = m.material as THREE.MeshBasicMaterial;
      expect(mat.transparent).toBe(true);
      expect(mat.depthWrite).toBe(false);
      // 泡は対応する水面のすぐ上(いずれかの水面+0.07)に乗る
      expect(surf.some(s => Math.abs(m.position.y - s.position.y - 0.07) < 1e-9)).toBe(true);
      // ジオメトリ: 外周・内周の2列ストリップで、フェードは0..1
      const info = m.geometry.getAttribute('foamInfo');
      expect(info.itemSize).toBe(2);
      expect(m.geometry.getAttribute('position').count).toBe(info.count);
      for (let i = 0; i < info.count; i++) {
        expect(info.getX(i)).toBeGreaterThanOrEqual(0);
        expect(info.getX(i)).toBeLessThanOrEqual(1);
        if (i % 2 === 1) expect(info.getX(i)).toBe(0);   // 内周(水側)はフェード0
      }
    }
    // 色系はパレット適用で初期化される(水面uniform・泡マテリアルとも)
    expect('#' + water.skyColor.value.getHexString()).toBe(TIMES.day.ground.waterSky);
    expect('#' + water.foamMat.color.getHexString()).toBe(TIMES.day.ground.waterFoam);
    expect(foam.every(m => m.material === water.foamMat)).toBe(true);
    expect(water.time.value).toBe(0);
    expect(water.mat.normalMap).toBeInstanceOf(THREE.DataTexture);
  });
});
