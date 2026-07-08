// 川の水面(アニメーションするオーバーレイメッシュ)

import * as THREE from 'three';
import type { CityData } from '../core/cityGen';
import { MAP_HALF } from '../core/config';
import { rngFor, type Rng } from '../core/rng';
import { bandPt, shorePts } from '../core/terrain';
import { makeCanvas } from './canvas2d';
import type { GroundPalette } from './sky';

export interface WaterView { mat: THREE.MeshPhongMaterial; tex: THREE.CanvasTexture }

// タイル可能なさざ波テクスチャ(街の生成物なのでシード付きストリームで再現可能にする)
function makeWaterTexture(rng: Rng): THREE.CanvasTexture {
  const { canvas: c, ctx: x } = makeCanvas(256);
  x.fillStyle = '#c8c8c8'; x.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 220; i++) {
    const cx = rng() * 256, cy = rng() * 256;
    const w = 16 + rng() * 46, h = 2 + rng() * 5;
    const rot = (rng() - 0.5) * 0.5;
    const style = rng() < 0.5
      ? `rgba(255,255,255,${(0.05 + rng() * 0.10).toFixed(3)})`
      : `rgba(60,72,84,${(0.04 + rng() * 0.08).toFixed(3)})`;
    // 3x3で同じ筋を描き、タイル境界を継ぎ目なしにする
    for (const dx of [-256, 0, 256]) for (const dy of [-256, 0, 256]) {
      x.save();
      x.translate(cx + dx, cy + dy);
      x.rotate(rot);
      x.fillStyle = style;
      x.beginPath(); x.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2); x.fill();
      x.restore();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// 水域と同じ岸線から水面メッシュを作り、平坦化された水底(-12)の少し上に浮かべる
export function buildWaterSurface(city: CityData, group: THREE.Group, G: GroundPalette): WaterView | null {
  const feats = city.terrain.feats.filter(f => f.type === 'r');
  if (!feats.length) return null;
  const tex = makeWaterTexture(rngFor(city.seed, 'waterTex'));
  tex.repeat.set(1 / 230, 1 / 230);
  // Phong+バンプで太陽のスペキュラをさざ波に沿ってきらめかせる(バンプはさざ波テクスチャを共用)
  const mat = new THREE.MeshPhongMaterial({
    color: G.waterSurf, map: tex,
    bumpMap: tex, bumpScale: 3,
    specular: new THREE.Color(G.waterSpec), shininess: G.waterShine,
  });
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
  return { mat, tex };
}
