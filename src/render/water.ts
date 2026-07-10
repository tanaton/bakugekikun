// 川の水面(アニメーションするオーバーレイメッシュ)
//
// 見た目の構成:
//   ・手続き生成のタンジェント空間法線マップ(整数波数の正弦波の和→解析勾配)
//   ・シェーダーパッチで同じ法線マップを2層(うねり+細波)別方向にスクロールして合成
//   ・フレネル項で視線が浅いほど空色を混ぜる(太陽のスペキュラは減光させない)

import * as THREE from 'three';
import type { CityData } from '../core/cityGen';
import { MAP_HALF } from '../core/config';
import { rngFor, type Rng } from '../core/rng';
import { bandPt, shorePts } from '../core/terrain';
import type { GroundPalette } from './sky';

export interface WaterView {
  mat: THREE.MeshPhongMaterial;
  time: { value: number };            // uniform実体(loopが毎フレーム書く)
  skyColor: { value: THREE.Color };   // uniform実体(時間帯切り替えが書く)
}

// タイル可能な水面法線マップの画素データ(RGBA8)。整数波数ベクトルの正弦波の和を
// 高さ場とし、その解析微分の勾配から法線を作る。波数が整数なのでタイル境界は
// 数学的に継ぎ目なし(旧Canvas実装の3x3重ね描きのような工夫が要らない)
export function makeWaterNormalData(rng: Rng, size = 256): Uint8Array {
  // 波の強さは高さ振幅でなく傾き(勾配の最大値)で持つ。sx/syは勾配の方向係数
  interface Wave { kx: number; ky: number; sx: number; sy: number; phase: number }
  const waves: Wave[] = [];
  const add = (kMin: number, kMax: number): void => {
    const ang = rng() * Math.PI * 2, mag = kMin + rng() * (kMax - kMin);
    // mag>=1なら少なくとも一方の成分が0.5以上なので(0,0)には丸まらない
    const kx = Math.round(mag * Math.cos(ang)), ky = Math.round(mag * Math.sin(ang));
    const len = Math.hypot(kx, ky);
    const slope = (0.7 + 0.6 * rng()) * 0.16 / Math.pow(len, 0.3);   // 高周波ほどやや弱く
    waves.push({ kx, ky, sx: slope * kx / len, sy: slope * ky / len, phase: rng() * Math.PI * 2 });
  };
  for (let i = 0; i < 4; i++) add(1, 3);   // うねり
  for (let i = 0; i < 6; i++) add(4, 9);   // 細波
  const data = new Uint8Array(size * size * 4);
  for (let y = 0, p = 0; y < size; y++) {
    for (let x = 0; x < size; x++, p += 4) {
      const u = x / size, v = y / size;
      let hu = 0, hv = 0;   // 高さ場の勾配(解析微分: cosの和)
      for (const w of waves) {
        const c = Math.cos(2 * Math.PI * (w.kx * u + w.ky * v) + w.phase);
        hu += c * w.sx; hv += c * w.sy;
      }
      const inv = 1 / Math.hypot(hu, hv, 1);   // n = normalize(-hu, -hv, 1)
      data[p] = Math.round(-hu * inv * 127.5 + 127.5);
      data[p + 1] = Math.round(-hv * inv * 127.5 + 127.5);
      data[p + 2] = Math.round(inv * 127.5 + 127.5);
      data[p + 3] = 255;
    }
  }
  return data;
}

// 街の生成物なのでシード付きストリームで再現可能にする
function makeWaterNormalTexture(rng: Rng): THREE.DataTexture {
  const size = 256;
  const tex = new THREE.DataTexture(makeWaterNormalData(rng, size), size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;                // DataTextureの既定はNearest+ミップなし
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

// onBeforeCompileの置換対象原文(three r185)。threeの更新で原文が変わるとreplaceが
// 空振りするため、見つからなければthrowで気付く(dualShadowと同じ約束)
export const MAPN_LINE = 'vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;';
export const OUTGOING_LINE = 'vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + reflectedLight.directSpecular + reflectedLight.indirectSpecular + totalEmissiveRadiance;';

// 法線マップの2層合成(whiteoutブレンド)。1層目=うねり、2層目=別スケール(無理数寄りの
// 倍率で周期の整列を防ぐ)の細波を逆方向へ流す。UVへのuniform加算はスクリーン微分を
// 変えないので、tangent属性なしのTBN導出(getTangentFrame)もミップ選択も壊れない
const DUAL_NORMAL = /* glsl */`
	vec3 mapN1 = texture2D( normalMap, vNormalMapUv + uWaterTime * vec2( 0.011, 0.006 ) ).xyz * 2.0 - 1.0;
	vec3 mapN2 = texture2D( normalMap, vNormalMapUv * 2.63 + uWaterTime * vec2( -0.007, 0.0045 ) ).xyz * 2.0 - 1.0;
	vec3 mapN = normalize( vec3( mapN1.xy + mapN2.xy, mapN1.z * mapN2.z ) );`;

// フレネル: 視線が浅いほど拡散成分を空色へ寄せる。specular(太陽のギラつき)は混ぜずに
// 足すので空色ブレンドで減光しない。波法線のゆらぎがNoVを画素ごとに散らすため、
// 真上からの俯瞰でも空色のちらつきが出る
const FRESNEL = /* glsl */`
	float bkNoV = saturate( dot( geometryViewDir, normal ) );
	float bkFres = 0.08 + 0.6 * pow( 1.0 - bkNoV, 3.0 );
	vec3 outgoingLight = mix( reflectedLight.directDiffuse + reflectedLight.indirectDiffuse, uSkyColor, bkFres )
		+ reflectedLight.directSpecular + reflectedLight.indirectSpecular + totalEmissiveRadiance;`;

// 水面マテリアルのシェーダーパッチ。uniformは共有オブジェクトを渡すので、
// コンパイル前後を問わず time.value / skyColor.value への書き込みが常に効く
export function patchWaterShader(
    sh: { uniforms: Record<string, { value: unknown }>; fragmentShader: string },
    time: { value: number }, skyColor: { value: THREE.Color }): void {
  if (!THREE.ShaderChunk.normal_fragment_maps.includes(MAPN_LINE) ||
      !sh.fragmentShader.includes(OUTGOING_LINE)) {
    throw new Error('patchWaterShader: 想定行がない(threeの更新でシェーダー原文が変わった)');
  }
  sh.uniforms.uWaterTime = time;
  sh.uniforms.uSkyColor = skyColor;
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', '#include <common>\nuniform float uWaterTime;\nuniform vec3 uSkyColor;')
    // onBeforeCompile時点は#include展開前なので、該当チャンクを手動展開してから置換する
    .replace('#include <normal_fragment_maps>',
      THREE.ShaderChunk.normal_fragment_maps.replace(MAPN_LINE, DUAL_NORMAL))
    .replace(OUTGOING_LINE, FRESNEL);
}

// 水域と同じ岸線から水面メッシュを作り、平坦化された水底(-12)の少し上に浮かべる
export function buildWaterSurface(city: CityData, group: THREE.Group, G: GroundPalette): WaterView | null {
  const feats = city.terrain.feats.filter(f => f.type === 'r');
  if (!feats.length) return null;
  const tex = makeWaterNormalTexture(rngFor(city.seed, 'waterTex'));
  tex.repeat.set(1 / 90, 1 / 90);   // 法線マップ1タイル=世界90m
  const time = { value: 0 };
  const skyColor = { value: new THREE.Color(G.waterSky) };
  // Phong+法線マップで太陽のスペキュラをさざ波に沿ってきらめかせる
  const mat = new THREE.MeshPhongMaterial({
    color: G.waterSurf,
    normalMap: tex, normalScale: new THREE.Vector2(0.9, 0.9),
    specular: new THREE.Color(G.waterSpec), shininess: G.waterShine,
  });
  mat.onBeforeCompile = (sh): void => patchWaterShader(sh, time, skyColor);
  const S = MAP_HALF, cl = (v: number): number => THREE.MathUtils.clamp(v, -S, S);
  let li = 0;   // 川同士の重なりでZファイティングしないよう1枚ごとに高さをずらす
  for (const f of feats) {
    const shape = new THREE.Shape();
    // 岸線はdrawGroundと同じshorePtsをたどる(湾は地図の縁でクランプ)
    shorePts(f, 0).forEach((p, i) => {
      const px = f.kind === 'band' ? p.x : cl(p.x), pz = f.kind === 'band' ? p.z : cl(p.z);
      if (i) shape.lineTo(px, -pz); else shape.moveTo(px, -pz);
    });
    if (f.kind === 'band') {
      const p1 = bandPt(f, S, -200), p0 = bandPt(f, -S, -200);
      shape.lineTo(p1.x, -p1.z); shape.lineTo(p0.x, -p0.z);
    }
    const geo = new THREE.ShapeGeometry(shape);
    geo.rotateX(-Math.PI / 2);   // shapeの(x,-z)を世界の(x,z)へ。面は上向きになる
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;   // 岸辺の建物・木の影が水面に落ちる
    mesh.position.y = -11.6 + 0.15 * li++;
    group.add(mesh);
  }
  return { mat, time, skyColor };
}
