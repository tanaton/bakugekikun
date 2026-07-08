// 都市プラン生成器: 碁盤目 / 有機的(ワープした碁盤目) / 放射環状。
// 出力は道路・街区ポリゴン・路地・公園の植栽ジョブ・建物ロットの純データ

import { CITY_HALF } from './config';
import { clamp, gridSample } from './math';
import { genRoadLines, resamplePath } from './roads';
import { isHouseZone } from './lots';
import type { Rng } from './rng';
import type { AlleyPath, GroundPoly, Lot, RoadPath, Vec2 } from './types';

// 公園の植栽ジョブ(プラン生成 → 木生成への受け渡し)。
// sampleは'trees'ストリームのrngを受けて植栽点を返す(ストリームを混ぜないため引数で渡す)
export interface ParkTreeJob { n: number; sample: (rng: Rng) => Vec2 }

export interface PlanOutput {
  roadPaths: RoadPath[];
  groundPolys: GroundPoly[];
  alleyPaths: AlleyPath[];
  parkTreeJobs: ParkTreeJob[];
  pendingLots: Lot[];
}

// ---------- 碁盤目 / 有機的(ワープした碁盤目) ----------
export function genGridPlan(rng: Rng, organic: boolean, cityCore: Vec2, cityHouseTh: number): PlanOutput {
  const out: PlanOutput = { roadPaths: [], groundPolys: [], alleyPaths: [], parkTreeJobs: [], pendingLots: [] };
  // なめらかな変位場で格子全体を歪ませると、曲がった道路と不定形の街区になる
  const WN = 9;
  const wgx = new Float32Array(WN * WN), wgz = new Float32Array(WN * WN);
  for (let i = 0; i < WN * WN; i++) { wgx[i] = rng(); wgz[i] = rng(); }
  const amp = organic ? 110 + rng() * 130 : 0;
  const warp = (u: number, v: number): Vec2 => {
    if (!amp) return { x: u, z: v };
    const fade = clamp(1 - (Math.max(Math.abs(u), Math.abs(v)) - 2200) / 300, 0, 1);
    const gu = (u + 3200) / 6400 * (WN - 1), gv = (v + 3200) / 6400 * (WN - 1);
    return { x: u + (gridSample(wgx, WN, gu, gv) - 0.5) * 2 * amp * fade,
             z: v + (gridSample(wgz, WN, gu, gv) - 0.5) * 2 * amp * fade };
  };
  const linesU = genRoadLines(rng, CITY_HALF), linesV = genRoadLines(rng, CITY_HALF);
  for (const l of linesU) {
    const raw: Vec2[] = [];
    for (let v = -CITY_HALF; v <= CITY_HALF + 1; v += 50) raw.push(warp(l.c, v));
    out.roadPaths.push({ pts: resamplePath(raw, false), w: l.w, major: l.major, loop: false });
  }
  for (const l of linesV) {
    const raw: Vec2[] = [];
    for (let u = -CITY_HALF; u <= CITY_HALF + 1; u += 50) raw.push(warp(u, l.c));
    out.roadPaths.push({ pts: resamplePath(raw, false), w: l.w, major: l.major, loop: false });
  }
  // 街区
  for (let i = 0; i < linesU.length - 1; i++) {
    for (let j = 0; j < linesV.length - 1; j++) {
      const u0 = linesU[i].c + linesU[i].w / 2, u1 = linesU[i + 1].c - linesU[i + 1].w / 2;
      const v0 = linesV[j].c + linesV[j].w / 2, v1 = linesV[j + 1].c - linesV[j + 1].w / 2;
      if (u1 - u0 < 24 || v1 - v0 < 24) continue;
      const wc = warp((u0 + u1) / 2, (v0 + v1) / 2);
      const distC = Math.hypot(wc.x - cityCore.x, wc.z - cityCore.z) / CITY_HALF;
      const park = rng() < 0.03;
      const house = !park && isHouseZone(cityHouseTh, distC, rng);
      const w = u1 - u0 - 10, d = v1 - v0 - 10;
      // 塗り用ポリゴン(縁を分割してからワープすると曲線に沿う)
      const poly: Vec2[] = [], step = 45;
      for (let u = u0; u < u1; u += step) poly.push(warp(u, v0));
      for (let v = v0; v < v1; v += step) poly.push(warp(u1, v));
      for (let u = u1; u > u0; u -= step) poly.push(warp(u, v1));
      for (let v = v1; v > v0; v -= step) poly.push(warp(u0, v));
      out.groundPolys.push({ pts: poly, kind: park ? 'park' : house ? 'house' : 'block', v: rng() < 0.5 });
      if (park) {
        out.parkTreeJobs.push({ n: clamp(Math.floor((u1 - u0) * (v1 - v0) / 110), 30, 220),
          sample: r => warp(u0 + 8 + r() * (u1 - u0 - 16), v0 + 8 + r() * (v1 - v0 - 16)) });
        continue;
      }
      // ロット分割
      const nx = Math.max(1, house ? Math.floor(w / (15 + rng() * 6)) : Math.min(4, Math.floor(w / (26 + rng() * 26))));
      const nz = Math.max(1, house ? Math.floor(d / (15 + rng() * 6)) : Math.min(4, Math.floor(d / (26 + rng() * 26))));
      const cw = w / nx, cd = d / nz;
      // ロット境界に沿った街区内の路地(isU=trueは固定座標がu軸側)
      const alley = (c: number, lo: number, hi: number, isU: boolean): void => {
        const raw: Vec2[] = [];
        for (let t = lo + 4; t <= hi - 4; t += 40) raw.push(isU ? warp(c, t) : warp(t, c));
        raw.push(isU ? warp(c, hi - 4) : warp(hi - 4, c));
        out.alleyPaths.push({ pts: raw, w: house ? 4 : 5.5 });
      };
      for (let ix = 1; ix < nx; ix++) alley(u0 + 5 + cw * ix, v0, v1, true);
      for (let iz = 1; iz < nz; iz++) alley(v0 + 5 + cd * iz, u0, u1, false);
      for (let ix = 0; ix < nx; ix++) for (let iz = 0; iz < nz; iz++) {
        const cu = u0 + 5 + cw * ix + cw / 2, cv = v0 + 5 + cd * iz + cd / 2;
        const wp = warp(cu, cv);
        const we = warp(cu + 8, cv);
        const rot = Math.atan2(-(we.z - wp.z), we.x - wp.x);  // 局所的な格子の向きに沿わせる
        out.pendingLots.push({ x: wp.x, z: wp.z, rot, availW: cw, availD: cd, distC, house });
      }
    }
  }
  return out;
}

// ---------- 放射環状(環状道路 + 放射道路) ----------
export function genRadialPlan(rng: Rng, cityCore: Vec2, cityHouseTh: number): PlanOutput {
  const out: PlanOutput = { roadPaths: [], groundPolys: [], alleyPaths: [], parkTreeJobs: [], pendingLots: [] };
  // 中心は都心位置に追従(街が地図からはみ出さない範囲で)
  const cx = clamp(cityCore.x, -450, 450);
  const cz = clamp(cityCore.z, -450, 450);
  // プラン中心からの極座標 → 世界座標
  const polar = (a: number, r: number): Vec2 => ({ x: cx + Math.cos(a) * r, z: cz + Math.sin(a) * r });
  // ロットをリング(接線)方向に向ける回転
  const tangentRot = (a: number): number => Math.atan2(-Math.cos(a), -Math.sin(a));
  // 角度a0→a1をn分割した弧の点列(中心はプランの中心)。rFnは角度→半径。inclで終端を含む
  const arcPts = (rFn: (a: number) => number, a0: number, a1: number, n: number, incl = true): Vec2[] => {
    const pts: Vec2[] = [];
    for (let k = 0; k < n + (incl ? 1 : 0); k++) {
      const a = a0 + (a1 - a0) * k / n;
      pts.push(polar(a, rFn(a)));
    }
    return pts;
  };
  // 扇形街区のポリゴン(外周の弧 + 内周の弧の逆順)
  const fanPoly = (rOutFn: (a: number) => number, rIn: number, aA: number, aB: number, n: number): Vec2[] =>
    arcPts(rOutFn, aA, aB, n).concat(arcPts(() => rIn, aA, aB, n).reverse());
  const rEdge = CITY_HALF - Math.hypot(cx, cz);
  const rings: { r: number; w: number; major: boolean }[] = [];
  let r = 150 + rng() * 80;
  while (r < rEdge - 60) {
    rings.push({ r, w: rng() < 0.3 ? 30 : 18, major: rng() < 0.35 || rings.length === 0 });
    r += 150 + rng() * 170;
  }
  const nSp = 10 + Math.floor(rng() * 8);
  const spokes: { a: number; w: number; major: boolean }[] = [];
  const a0 = rng() * Math.PI * 2;
  for (let k = 0; k < nSp; k++) {
    spokes.push({ a: a0 + (k / nSp) * Math.PI * 2 + (rng() - 0.5) * 0.16,
      w: rng() < 0.3 ? 30 : 18, major: rng() < 0.35 });
  }
  spokes.sort((p, q) => p.a - q.a);
  for (const g of rings) {
    const n = Math.max(24, Math.round(g.r * 2 * Math.PI / 45));
    const raw = arcPts(() => g.r, 0, Math.PI * 2, n, false);
    out.roadPaths.push({ pts: resamplePath(raw, true), w: g.w, major: g.major, loop: true });
  }
  // 中心から角度aの方向に、地図の四角い縁(少し内側)までの距離
  const EDGE = CITY_HALF - 20;
  const edgeDist = (a: number): number => {
    const ca = Math.cos(a), sa = Math.sin(a);
    let d = Infinity;
    if (ca > 1e-6) d = Math.min(d, (EDGE - cx) / ca);
    if (ca < -1e-6) d = Math.min(d, (-EDGE - cx) / ca);
    if (sa > 1e-6) d = Math.min(d, (EDGE - cz) / sa);
    if (sa < -1e-6) d = Math.min(d, (-EDGE - cz) / sa);
    return d;
  };
  const rMin = rings[0].r;
  for (const sp of spokes) {
    const raw = [polar(sp.a, rMin * 0.55), polar(sp.a, edgeDist(sp.a) - 20)];
    out.roadPaths.push({ pts: resamplePath(raw, false), w: sp.w, major: sp.major, loop: false });
  }
  // 中央広場は公園
  out.groundPolys.push({ pts: arcPts(() => rMin - 12, 0, Math.PI * 2, 40, false), kind: 'park' });
  out.parkTreeJobs.push({
    n: Math.min(260, Math.floor(Math.PI * (rMin - 25) * (rMin - 25) / 130)),
    sample: r2 => polar(r2() * Math.PI * 2, Math.sqrt(r2()) * (rMin - 25)) });
  // 街区: リング帯 × スポーク区間の扇形。最外帯は地図の縁まで埋める
  for (let ri = 0; ri < rings.length; ri++) {
    const outer = ri === rings.length - 1;
    const rIn = rings[ri].r + rings[ri].w / 2 + 5;
    const rOutBand = outer ? 0 : rings[ri + 1].r - rings[ri + 1].w / 2 - 5;
    if (!outer && rOutBand - rIn < 26) continue;
    const rm = outer ? rIn + 150 : (rIn + rOutBand) / 2;
    for (let si = 0; si < spokes.length; si++) {
      const s0 = spokes[si], s1 = spokes[(si + 1) % spokes.length];
      const gap = (si === spokes.length - 1 ? s1.a + Math.PI * 2 : s1.a) - s0.a;
      const aA = s0.a + (s0.w / 2 + 5) / rm;
      const aB = s0.a + gap - (s1.w / 2 + 5) / rm;
      if (aB - aA < 24 / rm) continue;

      if (outer) {
        // --- 最外帯: 角度列ごとに地図の縁までロットを敷き詰める ---
        const rO = (a: number): number => edgeDist(a) - 14;
        const rOutMid = rO((aA + aB) / 2);
        if (rOutMid - rIn < 26) continue;
        const rmO = (rIn + rOutMid) / 2;
        const houseO = isHouseZone(cityHouseTh, rmO / CITY_HALF, rng);
        const nA = Math.max(4, Math.round((aB - aA) * rOutMid / 40));
        out.groundPolys.push({ pts: fanPoly(rO, rIn, aA, aB, nA), kind: houseO ? 'house' : 'block', v: rng() < 0.5 });
        // 半径方向に帯を刻み、帯ごとに角度列を切り直す(外周ほど区画が広がりすぎないように)
        let r0 = rIn;
        while (rOutMid - r0 >= 26) {
          const r1 = Math.min(rOutMid, r0 + (houseO ? 110 + rng() * 70 : 150 + rng() * 100));
          const last = rOutMid - r1 < 26;               // 端数は最後の帯に吸収
          const rB = last ? rOutMid : r1;
          if (r0 > rIn) {                                // 帯境界の弧の路地(地図の縁は超えない)
            const nA2 = Math.max(4, Math.round((aB - aA) * r0 / 30));
            out.alleyPaths.push({ pts: arcPts(a => Math.min(r0, rO(a) - 3), aA, aB, nA2), w: 5 });
          }
          const lotW = houseO ? 16 + rng() * 5 : 30 + rng() * 20;
          const nt = Math.max(1, Math.floor((aB - aA) * ((r0 + rB) / 2) / lotW));
          for (let it = 0; it < nt; it++) {
            const ac = aA + (aB - aA) * ((it + 0.5) / nt);
            if (it > 0) {                                // 列境界の路地
              const ab = aA + (aB - aA) * it / nt;
              const rt = Math.min(rB, rO(ab)) - 3;
              if (rt - r0 > 8) out.alleyPaths.push({ pts: [polar(ab, r0 + 3), polar(ab, rt)], w: 5 });
            }
            const rTop = last ? rO(ac) - 6 : Math.min(rB - 3, rO(ac) - 6);
            const depth = rTop - r0 - 3;
            if (depth < 16) continue;
            const lotD = houseO ? 16 + rng() * 5 : 30 + rng() * 20;
            const nrL = Math.max(1, Math.floor(depth / lotD));
            const cdl = depth / nrL;
            for (let jr = 0; jr < nrL; jr++) {
              const rc = r0 + 3 + cdl * jr + cdl / 2;
              out.pendingLots.push({ ...polar(ac, rc), rot: tangentRot(ac),
                availW: (aB - aA) * rc / nt, availD: cdl,
                distC: rc / CITY_HALF, house: houseO });
            }
          }
          if (last) break;
          r0 = r1;
        }
        continue;
      }

      const rOut = rOutBand;
      const distC = rm / CITY_HALF;
      const park = rng() < 0.025;
      const house = !park && isHouseZone(cityHouseTh, distC, rng);
      const depth = rOut - rIn - 8;
      const nA = Math.max(4, Math.round((aB - aA) * rOut / 40));
      out.groundPolys.push({ pts: fanPoly(() => rOut, rIn, aA, aB, nA),
        kind: park ? 'park' : house ? 'house' : 'block', v: rng() < 0.5 });
      if (park) {
        out.parkTreeJobs.push({ n: clamp(Math.floor((rOut - rIn) * (aB - aA) * rm / 110), 30, 200),
          sample: r2 => polar(aA + r2() * (aB - aA), rIn + 8 + r2() * (rOut - rIn - 16)) });
        continue;
      }
      // ロット分割(半径方向 × 角度方向)
      const nr = Math.max(1, house ? Math.floor(depth / (15 + rng() * 6)) : Math.min(3, Math.floor(depth / (28 + rng() * 22))));
      const cd = depth / nr;
      // 街区内の路地(同心円の弧 + 放射方向)
      for (let jr = 1; jr < nr; jr++) {
        const rb = rIn + 4 + cd * jr;
        const nA2 = Math.max(4, Math.round((aB - aA) * rb / 30));
        out.alleyPaths.push({ pts: arcPts(() => rb, aA, aB, nA2), w: 5 });
      }
      const ntAl = Math.max(1, Math.floor((aB - aA) * rm / 30));
      for (let it = 1; it < ntAl; it++) {
        const ab = aA + (aB - aA) * it / ntAl;
        out.alleyPaths.push({ pts: [polar(ab, rIn + 3), polar(ab, rOut - 3)], w: 5 });
      }
      for (let jr = 0; jr < nr; jr++) {
        const rc = rIn + 4 + cd * jr + cd / 2;
        const arc = (aB - aA) * rc;
        const nt = Math.max(1, house ? Math.floor(arc / (15 + rng() * 6)) : Math.min(5, Math.floor(arc / (26 + rng() * 26))));
        const cwA = arc / nt;
        for (let it = 0; it < nt; it++) {
          const ac = aA + (aB - aA) * ((it + 0.5) / nt);
          out.pendingLots.push({ ...polar(ac, rc), rot: tangentRot(ac), availW: cwA, availD: cd, distC, house });
        }
      }
    }
  }
  return out;
}
