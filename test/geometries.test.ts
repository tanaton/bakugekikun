// 建物ジオメトリの検証(node)

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { makeHouseGeometry } from '../src/render/geometries';
import { TIMES } from '../src/render/sky';

// three.jsの影パスはデフォルトで裏面(BackSide)描画。屋根が上面だけの開いた
// シェルだと、太陽を向いた面が影マップに写らず、軒の張り出しぶんだけ
// 「屋根の影」と「壁の影」が地面で分離する(過去に起きた不具合)。
// ここでは影パスを再現し、影のシルエットが一続きであることを確かめる。

type Tri = [number, number][];

// 影マップに描かれる三角形(光から見て裏面)を集め、地面(y=-0.5)へ光線方向で投影する
function shadowSilhouette(geo: THREE.BufferGeometry, light: THREE.Vector3,
    scale: [number, number, number]): Tri[] {
  const p = geo.getAttribute('position').array;
  const L = light.clone().normalize();
  const tris: Tri[] = [];
  const v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  for (let i = 0; i < p.length; i += 9) {
    for (let k = 0; k < 3; k++)
      v[k].set(p[i + k * 3] * scale[0], p[i + k * 3 + 1] * scale[1], p[i + k * 3 + 2] * scale[2]);
    e1.subVectors(v[1], v[0]); e2.subVectors(v[2], v[0]);
    // 光を向いた面は影パスで描かれない(どのマテリアルもshadowSide未指定=
    // BackSide描画である前提。shadowSideを設定したらこのテストの前提も見直すこと)
    if (e1.cross(e2).dot(L) <= 0) continue;
    tris.push(v.map(w => {
      const t = (-0.5 * scale[1] - w.y) / L.y;
      return [w.x + L.x * t, w.z + L.z * t] as [number, number];
    }) as Tri);
  }
  return tris;
}

const inTri = (x: number, y: number, [[ax, ay], [bx, by], [cx, cy]]: Tri): boolean => {
  const s1 = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
  const s2 = (cx - bx) * (y - by) - (cy - by) * (x - bx);
  const s3 = (ax - cx) * (y - cy) - (ay - cy) * (x - cx);
  const eps = 1e-9;
  return (s1 >= -eps && s2 >= -eps && s3 >= -eps) || (s1 <= eps && s2 <= eps && s3 <= eps);
};

describe('民家ジオメトリの影シルエット', () => {
  const geo = makeHouseGeometry();

  it('壁の影と屋根の影が分離しない(全時間帯・全方位・実寸スケール)', () => {
    for (const mode of ['day', 'dusk'] as const) {
      const sunPos = new THREE.Vector3(...TIMES[mode].sunPos);
      const elev = sunPos.y / Math.hypot(sunPos.x, sunPos.z);
      for (let az = 0; az < 360; az += 22.5) {
        const a = THREE.MathUtils.degToRad(az);
        // 光線の進行方向(水平成分は単位長・下向き)。方位一周=建物の向きの全パターン
        const L = new THREE.Vector3(Math.cos(a), -elev, Math.sin(a));
        const dir = [L.x, L.z];
        for (const scale of [[1, 1, 1], [12, 5, 9]] as [number, number, number][]) {
          const tris = shadowSilhouette(geo, L, scale);
          // 影の中心(足元)から光の方位へ地面を走査。家の影は凸集合2つ
          // (壁の箱・屋根の三角柱)の重なる影なので、一続きの区間になるはず。
          // 影→非影→影と切り替わったら分離している
          // 走査距離 = 全高(正規化1)の影の伸び + 底面対角。軒の隙間(0.06×幅)より
          // 十分細かい歩幅で刻む
          const reach = scale[1] / elev + Math.hypot(scale[0], scale[2]);
          const step = reach / 400;
          let left = false;
          for (let t = 0; t <= reach; t += step) {
            const s = tris.some(tri => inTri(dir[0] * t, dir[1] * t, tri));
            if (!s) { left = true; continue; }
            expect(left, `${mode} az=${az} scale=${scale} t=${t.toFixed(3)}で影が再開(分離)`)
              .toBe(false);
          }
        }
      }
    }
  });

  it('屋根に軒裏(下向きの面)がある', () => {
    const p = geo.getAttribute('position').array;
    const n = geo.getAttribute('normal').array;
    const roof = geo.groups[1];
    let found = false;
    for (let i = roof.start; i < roof.start + roof.count && !found; i++)
      found = n[i * 3 + 1] === -1 && Math.abs(p[i * 3]) > 0.5;   // 壁より外まで張り出す
    expect(found).toBe(true);
  });
});
