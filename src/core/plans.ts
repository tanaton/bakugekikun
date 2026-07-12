// 都市プラン生成器: 碁盤目 / 有機的(ワープした碁盤目) / 放射環状。
// 出力は道路・街区ポリゴン・路地・公園の植栽ジョブ・建物ロットの純データ

import { CITY_HALF } from './config';
import { clamp, gridSample } from './math';
import { genRoadLines, resamplePath } from './roads';
import { blockPitch, housePitch, isHouseZone } from './lots';
import { inPond, type Pond } from './ponds';
import type { Rng } from './rng';
import type { AlleyPath, GroundPoly, Lot, RoadPath, Vec2 } from './types';

// 公園の植栽ジョブ(プラン生成 → 木生成への受け渡し)。
// sampleは'trees'ストリームのrngを受けて植栽点を返す(ストリームを混ぜないため引数で渡す)
export interface ParkTreeJob { n: number; sample: (rng: Rng) => Vec2 }

export interface PlanOutput {
  roadPaths: RoadPath[];
  groundPolys: GroundPoly[];
  alleyPaths: AlleyPath[];
  parkPaths: AlleyPath[];   // 公園の園路(路地と同じ形式。色だけ変えて描く)
  ponds: Pond[];
  parkTreeJobs: ParkTreeJob[];
  pendingLots: Lot[];
}

// 園路と池を置く公園の最小辺長(m)。これ未満の公園は芝生と木だけ
const PARK_DECOR_MIN = 100;
const PARK_PATH_W = 3.5;

// 遊歩道の蛇行オフセット。2つの正弦波の重ねで公園ごと・園路ごとに違う曲がり方になる。
// 振幅は傾き予算S(横ずれ/道のり)から決めるので、公園の大きさによらず曲がりの
// きつさが一定で、木の回避判定の誤差(垂直距離≒最短距離)も一定に収まる。
// rngは必ず5回消費する(分岐で消費数が変わると'plan'ストリーム全体がずれる)
export function meanderOffset(rng: Rng, len: number, ampCap: number): (tn: number) => number {
  const k1 = 1 + rng() * 0.75, k2 = 2.5 + rng();          // 周期数(ゆったり + 細かめ)
  const ph1 = rng() * Math.PI * 2, ph2 = rng() * Math.PI * 2;
  const u = 0.65 + rng() * 0.2;                           // 低周波成分の配分
  const S = 0.55;                                         // 傾き予算(最大横ずれ勾配)
  let a1 = u * S * len / (2 * Math.PI * k1), a2 = (1 - u) * S * len / (2 * Math.PI * k2);
  if (a1 + a2 > ampCap) { const s = ampCap / (a1 + a2); a1 *= s; a2 *= s; }
  // 端では0に収束(園路が公園の縁の中央に届く)
  const env = (t: number): number => Math.min(1, t / 0.15, (1 - t) / 0.15);
  return tn => env(tn) * (a1 * Math.sin(2 * Math.PI * k1 * tn + ph1)
                        + a2 * Math.sin(2 * Math.PI * k2 * tn + ph2));
}

// 公園装飾の結果。onPathは局所座標での園路帯の判定(植栽の回避用)。
// pondsは0〜2件(ひょうたん池は重なる2つのPondで表す)
interface ParkDecor { ponds: Pond[]; onPath: (p: number, q: number) => boolean }

// 大きな公園の装飾: 中心を通る2本の蛇行遊歩道と、園路から一番離れた象限に置く池。
// 公園は矩形の局所座標(p0..p1, q0..q1)+ 世界座標への写像mapで扱い、
// 碁盤目(warp)と放射環状の扇形(極座標)を同じコードで装飾する
function decoratePark(out: PlanOutput, rng: Rng,
    p0: number, p1: number, q0: number, q1: number,
    map: (p: number, q: number) => Vec2): ParkDecor | null {
  const w = p1 - p0, d = q1 - q0;
  if (Math.min(w, d) < PARK_DECOR_MIN) return null;
  const pc = (p0 + p1) / 2, qc = (q0 + q1) / 2;
  // 蛇行は公園の縁からは8mのクリアランスだけ確保する(池は後から空きに合わせる)
  const offP = meanderOffset(rng, d, w / 2 - 8);   // q方向に走る道のp方向オフセット
  const offQ = meanderOffset(rng, w, d / 2 - 8);
  const tnQ = (q: number): number => (q - q0 - 4) / (d - 8);
  const tnP = (p: number): number => (p - p0 - 4) / (w - 8);
  const pathP: Vec2[] = [], pathQ: Vec2[] = [];
  for (let q = q0 + 4; q < q1 - 4; q += 12) pathP.push(map(pc + offP(tnQ(q)), q));
  pathP.push(map(pc, q1 - 4));
  for (let p = p0 + 4; p < p1 - 4; p += 12) pathQ.push(map(p, qc + offQ(tnP(p))));
  pathQ.push(map(p1 - 4, qc));
  out.parkPaths.push({ pts: pathP, w: PARK_PATH_W }, { pts: pathQ, w: PARK_PATH_W });
  // 池: 4象限の中心のうち両園路から一番離れた場所に、実際の空きに収まる半径で置く。
  // 距離は写像後のワールド空間で測る(扇形は局所距離が歪むため)
  let best: Vec2 = map(pc, qc), bestD = -Infinity;
  for (const sp of [-1, 1]) for (const sq of [-1, 1]) {
    const c = map(pc + sp * w / 4, qc + sq * d / 4);
    let D = Infinity;
    for (const pt of pathP) D = Math.min(D, Math.hypot(pt.x - c.x, pt.z - c.z));
    for (const pt of pathQ) D = Math.min(D, Math.hypot(pt.x - c.x, pt.z - c.z));
    if (D > bestD) { bestD = D; best = c; }
  }
  // 収まる最大半径。マージン9 = 岸帯5 + 園路半幅1.75 + 余裕
  const fit = Math.min(bestD - 9, Math.min(w, d) / 4 - 7);
  // 形と大きさのパターン(丸 / 細長 / ひょうたん)。どのパターンでも最遠の岸がfitに収まる。
  // rngは池なしでも必ず5回消費する(分岐で消費数が変わると'plan'ストリーム全体がずれる)
  const shape = rng(), size = rng(), extra = rng();
  const rot = rng() * Math.PI, ph = rng() * Math.PI * 2;
  const ponds: Pond[] = [];
  if (fit >= 9) {
    if (shape < 0.4) {           // 丸池(大きさのばらつきを広めに)
      const r = fit * (0.55 + 0.4 * size);
      ponds.push({ x: best.x, z: best.z, r, wig: r * (0.25 + 0.2 * extra), ph });
    } else if (shape < 0.75) {   // 細長い池(向きはシード次第)
      const e = 0.22 + 0.18 * extra;
      const r = fit * (0.6 + 0.35 * size) / (1 + e);
      ponds.push({ x: best.x, z: best.z, r, wig: r * 0.28, ph, e, rot });
    } else {                     // ひょうたん池(大小2つの重なる池。合併して一続きの水面になる)
      const base = fit * (0.55 + 0.3 * size);
      const r1 = base * 0.62, r2 = base * 0.46;
      const gap = (r1 + r2) * 0.78;
      const dx = Math.cos(rot), dz = Math.sin(rot);
      ponds.push(
        { x: best.x - dx * gap / 2, z: best.z - dz * gap / 2, r: r1, wig: r1 * 0.3, ph },
        { x: best.x + dx * gap / 2, z: best.z + dz * gap / 2, r: r2, wig: r2 * 0.3, ph: ph + 2.1 });
    }
    out.ponds.push(...ponds);
  }
  return { ponds, onPath: mkOnPath(pc, qc, offP, offQ, tnQ, tnP) };
}

// 園路帯の判定(蛇行の中心線からの垂直距離で近似。傾き≤0.55の誤差は余白が吸収)
function mkOnPath(pc: number, qc: number,
    offP: (tn: number) => number, offQ: (tn: number) => number,
    tnQ: (q: number) => number, tnP: (p: number) => number): (p: number, q: number) => boolean {
  const avoid = PARK_PATH_W / 2 + 2.5;
  return (p, q) => Math.abs(p - (pc + offP(tnQ(q)))) < avoid
                || Math.abs(q - (qc + offQ(tnP(p)))) < avoid;
}

// 公園の植栽サンプラ: 園路の帯と池を避けて点を打つ(装飾なしの公園は一様サンプル)
function parkSample(p0: number, p1: number, q0: number, q1: number,
    map: (p: number, q: number) => Vec2, decor: ParkDecor | null): (rng: Rng) => Vec2 {
  return rng => {
    let pt = map((p0 + p1) / 2, (q0 + q1) / 2);
    for (let k = 0; k < 8; k++) {
      const p = p0 + 8 + rng() * (p1 - p0 - 16), q = q0 + 8 + rng() * (q1 - q0 - 16);
      pt = map(p, q);
      if (decor?.onPath(p, q)) continue;
      if (decor && inPond(decor.ponds, pt.x, pt.z, 3)) continue;
      break;
    }
    return pt;
  };
}

// ---------- 碁盤目 / 有機的(ワープした碁盤目) ----------
export function genGridPlan(rng: Rng, organic: boolean, cityCore: Vec2, cityHouseTh: number): PlanOutput {
  const out: PlanOutput = { roadPaths: [], groundPolys: [], alleyPaths: [], parkPaths: [], ponds: [], parkTreeJobs: [], pendingLots: [] };
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
        const mapUV = (u: number, v: number): Vec2 => warp(u, v);
        const decor = decoratePark(out, rng, u0, u1, v0, v1, mapUV);
        out.parkTreeJobs.push({ n: clamp(Math.floor((u1 - u0) * (v1 - v0) / 110), 30, 220),
          sample: parkSample(u0, u1, v0, v1, mapUV, decor) });
        continue;
      }
      // ロット分割
      const nx = Math.max(1, house ? Math.floor(w / housePitch(rng)) : Math.min(4, Math.floor(w / blockPitch(rng))));
      const nz = Math.max(1, house ? Math.floor(d / housePitch(rng)) : Math.min(4, Math.floor(d / blockPitch(rng))));
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
  const out: PlanOutput = { roadPaths: [], groundPolys: [], alleyPaths: [], parkPaths: [], ponds: [], parkTreeJobs: [], pendingLots: [] };
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
  // 中央広場は公園。中心の池を環状園路が囲み、各スポークの起点まで放射園路を伸ばす
  out.groundPolys.push({ pts: arcPts(() => rMin - 12, 0, Math.PI * 2, 40, false), kind: 'park' });
  const pondR = rMin * (0.16 + rng() * 0.08);
  out.ponds.push({ x: cx, z: cz, r: pondR, wig: pondR * 0.3, ph: rng() * Math.PI * 2 });
  const ringR = pondR + 7;
  out.parkPaths.push({ pts: arcPts(() => ringR, 0, Math.PI * 2, 32), w: PARK_PATH_W });   // incl=trueで閉じる
  for (const sp of spokes)
    out.parkPaths.push({ pts: [polar(sp.a, ringR), polar(sp.a, rMin * 0.62)], w: PARK_PATH_W });
  out.parkTreeJobs.push({
    n: Math.min(260, Math.floor(Math.PI * (rMin - 25) * (rMin - 25) / 130)),
    sample: r2 => {
      // 池・環状園路の内側と放射園路の帯を避けて植える(最大8回退避)
      let pt: Vec2 = polar(0, ringR + 6);
      for (let k = 0; k < 8; k++) {
        const a = r2() * Math.PI * 2, rr = Math.sqrt(r2()) * (rMin - 25);
        pt = polar(a, rr);
        if (rr < ringR + 5) continue;
        let onPath = false;
        for (const sp of spokes) {
          let da = Math.abs(a - sp.a) % (Math.PI * 2);
          if (da > Math.PI) da = Math.PI * 2 - da;
          if (da * rr < PARK_PATH_W / 2 + 2.5) { onPath = true; break; }
        }
        if (!onPath) break;
      }
      return pt;
    } });
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
          const lotW = houseO ? housePitch(rng) : blockPitch(rng);
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
            const lotD = houseO ? housePitch(rng) : blockPitch(rng);
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
        // 扇形を(弧長, 半径)の局所矩形とみなして碁盤目の公園と同じ装飾を通す
        const arcLen = (aB - aA) * rm;
        const mapFan = (p: number, q: number): Vec2 => polar(aA + p / rm, q);
        const decor = decoratePark(out, rng, 0, arcLen, rIn, rOut, mapFan);
        out.parkTreeJobs.push({ n: clamp(Math.floor((rOut - rIn) * (aB - aA) * rm / 110), 30, 200),
          sample: parkSample(0, arcLen, rIn, rOut, mapFan, decor) });
        continue;
      }
      // ロット分割(半径方向 × 角度方向)
      const nr = Math.max(1, house ? Math.floor(depth / housePitch(rng)) : Math.min(3, Math.floor(depth / blockPitch(rng))));
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
        const nt = Math.max(1, house ? Math.floor(arc / housePitch(rng)) : Math.min(5, Math.floor(arc / blockPitch(rng))));
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
