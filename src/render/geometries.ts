// 建物・木のジオメトリ生成

import * as THREE from 'three';

// 複数ジオメトリを非インデックスで結合し、順にマテリアルグループを振る
function mergeGroups(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [], nor: number[] = [], uv: number[] = [];
  const groups: [number, number, number][] = [];
  let start = 0;
  geos.forEach((g0, gi) => {
    const g = g0.index ? g0.toNonIndexed() : g0;
    const p = g.getAttribute('position').array, n = g.getAttribute('normal').array;
    const u = g.getAttribute('uv');
    const cnt = p.length / 3;
    for (const x of p) pos.push(x);
    for (const x of n) nor.push(x);
    if (u) for (const x of u.array) uv.push(x); else for (let i = 0; i < cnt * 2; i++) uv.push(0);
    groups.push([start, cnt, gi]);
    start += cnt;
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  for (const g of groups) geo.addGroup(g[0], g[1], g[2]);
  return geo;
}

// 非インデックスジオメトリから頂点範囲[from,to)群を抜き出す(pos/normal/uv)
function sliceVerts(geo: THREE.BufferGeometry, ranges: [number, number][]): THREE.BufferGeometry {
  const p = geo.getAttribute('position').array, n = geo.getAttribute('normal').array,
        u = geo.getAttribute('uv').array;
  const pos: number[] = [], nor: number[] = [], uv: number[] = [];
  for (const [from, to] of ranges) for (let i = from; i < to; i++) {
    pos.push(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
    nor.push(n[i * 3], n[i * 3 + 1], n[i * 3 + 2]);
    uv.push(u[i * 2], u[i * 2 + 1]);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return out;
}

// オフィスビル: 塔体 + 屋上ペントハウス(高さ-0.5..0.5に正規化)
export function makeTowerGeometry(): THREE.BufferGeometry {
  const box = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
  // BoxGeometryの面順: +x,-x,+y,-y,+z,-z (各6頂点)
  const sides = sliceVerts(box, [[0, 12], [24, 36]]);   // 側面 +x,-x,+z,-z
  const caps = sliceVerts(box, [[12, 24]]);             // 屋上面 + 底面(倒壊時に見える)
  const pent = new THREE.BoxGeometry(0.42, 0.07, 0.36).translate(0.12, 0.53, 0.08);  // ペントハウス(機械室)
  const unit = new THREE.BoxGeometry(0.2, 0.09, 0.18).translate(-0.22, 0.54, -0.2);  // 空調ユニット
  // group0=ファサード group1=屋上まわり(内側のmergeGroupsのgroupは外側の結合で捨てられる)
  return mergeGroups([sides, mergeGroups([caps, pent, unit])]);
}

// 民家: 壁の箱 + 切妻屋根(高さ-0.5..0.5に正規化、Boxと同じ扱いができる)
export function makeHouseGeometry(): THREE.BufferGeometry {
  const walls = new THREE.BoxGeometry(1, 0.62, 1);
  walls.translate(0, -0.19, 0); // -0.5 .. 0.12
  const e = 0.56, ey = 0.12, ry = 0.5;
  const V: [number, number, number][] = [
    [-e, ey, e], [e, ey, e], [e, ry, 0],  [-e, ey, e], [e, ry, 0], [-e, ry, 0],   // +z屋根面
    [e, ey, -e], [-e, ey, -e], [-e, ry, 0],  [e, ey, -e], [-e, ry, 0], [e, ry, 0], // -z屋根面
    [e, ey, e], [e, ey, -e], [e, ry, 0],                                           // 妻面 +x
    [-e, ey, -e], [-e, ey, e], [-e, ry, 0],                                        // 妻面 -x
  ];
  const NS = [[0, .827, .561], [0, .827, -.561], [1, 0, 0], [-1, 0, 0]];
  const cnts = [6, 6, 3, 3];
  const pos: number[] = [], nor: number[] = [];
  let vi = 0;
  cnts.forEach((c, f) => { for (let k = 0; k < c; k++) { pos.push(...V[vi++]); nor.push(...NS[f]); } });
  const roof = new THREE.BufferGeometry();
  roof.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  roof.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return mergeGroups([walls, roof]); // group0=壁 group1=屋根
}

// 木: 幹 + 樹冠(接地面y=0、高さ~1に正規化)。4種類の樹形。
// 樹冠は低ポリのブロブを複数束ね、頂点を座標ハッシュでわずかに揺らして真球のCG感を消す
// (乱数でなくハッシュなので決定的で、同一座標の頂点は同じ変位になり面が割れない)
export function makeTreeGeometries(): THREE.BufferGeometry[] {
  const wobble = (geo: THREE.BufferGeometry, amp: number): THREE.BufferGeometry => {
    const p = geo.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const n = (k: number): number => {
        const v = Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + k * 53.3) * 43758.5453;
        return v - Math.floor(v) - 0.5;
      };
      p.setXYZ(i, x + n(1) * amp, y + n(2) * amp * 0.7, z + n(3) * amp);
    }
    geo.computeVertexNormals();
    return geo;
  };
  const blob = (r: number, x: number, y: number, z: number, sy = 1): THREE.BufferGeometry => {
    const g = new THREE.IcosahedronGeometry(r, 0);
    g.scale(1, sy, 1);
    g.translate(x, y, z);
    return g;
  };
  const mkTrunk = (rTop: number, rBot: number, h: number): THREE.BufferGeometry => {
    const t = new THREE.CylinderGeometry(rTop, rBot, h, 5);
    t.translate(0, h / 2, 0);
    return t;
  };
  // 樹冠ブロブ群を1ジオメトリに畳んでから幹と結合する(group0=幹 group1=葉)
  const canopy = (amp: number, ...blobs: THREE.BufferGeometry[]): THREE.BufferGeometry =>
    wobble(mergeGroups(blobs), amp);
  const tree = (trunk: THREE.BufferGeometry, leaf: THREE.BufferGeometry): THREE.BufferGeometry =>
    mergeGroups([trunk, leaf]);
  return [
    // 0: 広葉樹(丸い樹冠をブロブ3つで)
    tree(mkTrunk(0.05, 0.09, 0.42), canopy(0.06,
      blob(0.30, 0, 0.62, 0), blob(0.20, 0.20, 0.50, 0.07), blob(0.19, -0.17, 0.55, -0.10))),
    // 1: 針葉樹(円錐の2段重ね)
    tree(mkTrunk(0.035, 0.06, 0.35), canopy(0.035,
      new THREE.ConeGeometry(0.28, 0.50, 6).translate(0, 0.50, 0),
      new THREE.ConeGeometry(0.19, 0.42, 6).translate(0, 0.82, 0))),
    // 2: ポプラ型(縦長の楕円を2つ重ねる)
    tree(mkTrunk(0.04, 0.06, 0.25), canopy(0.05,
      blob(0.22, 0, 0.50, 0, 1.8), blob(0.15, 0, 0.85, 0, 1.5))),
    // 3: ケヤキ型(短い幹から傘状に広がる樹冠)
    tree(mkTrunk(0.05, 0.08, 0.50), canopy(0.06,
      blob(0.34, 0, 0.66, 0, 0.62), blob(0.24, 0.18, 0.58, 0.12, 0.68), blob(0.22, -0.20, 0.60, -0.08, 0.65))),
  ];
}
