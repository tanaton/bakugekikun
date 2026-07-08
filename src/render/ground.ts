// 地面テクスチャ(街区の塗り分け・道路・地形フィーチャ)と破壊跡の焼き込み。
//
// 破壊の跡(基礎跡・クレーター・焦げ跡)はすべて、起伏に完全に沿う地面テクスチャへ
// 直接描き込む。3Dデカールは頂点間の直線補間が地面メッシュの起伏とずれて浮き・埋まりが
// 出るため使わない。リストは時系列順に保持し、時間帯の塗り直しでも同順・同形で再現する

import * as THREE from 'three';
import type { CityData } from '../core/cityGen';
import { GROUND_SCALE, GROUND_TEX, GROUND_WORLD, MAP_HALF, worldToTex } from '../core/config';
import { mulberry32, type Rng } from '../core/rng';
import { bandPt, shorePts } from '../core/terrain';
import type { Building, Vec2 } from '../core/types';
import { makeCanvas } from './canvas2d';
import type { GroundPalette } from './sky';

export type Stamp =
  | { kind: 'lot'; x: number; z: number; sx: number; sz: number; rot: number }
  | { kind: 'crater'; x: number; z: number; r: number; seed: number }
  | { kind: 'scorch' | 'nuke'; x: number; z: number; r: number };

const FOUNDATION_STYLE = 'rgba(24,22,19,0.85)';

// canvasは生成のたびに作り直さず使い回す(モジュールレベルで常設)
let gCanvas: HTMLCanvasElement | null = null;
let gCtx: CanvasRenderingContext2D | null = null;
// 地肌の露出済み領域マスク。地肌は不透明で塗るが「先に露出した領域には上書きしない」
// ことで、露出済みの上に溜まった焦げ跡を後発の爆発が塗り潰さないようにする。
// drawGroundの全再描画時はクリアして時系列順に作り直す
let dirtMask: HTMLCanvasElement | null = null;
let dirtMaskCtx: CanvasRenderingContext2D | null = null;
let dirtScratch: HTMLCanvasElement | null = null;   // 1クレーター分の作業用
let dirtScratchCtx: CanvasRenderingContext2D | null = null;

function ensureCanvases(): void {
  if (gCanvas) return;
  ({ canvas: gCanvas, ctx: gCtx } = makeCanvas(GROUND_TEX));
  ({ canvas: dirtMask, ctx: dirtMaskCtx } = makeCanvas(GROUND_TEX));
  ({ canvas: dirtScratch, ctx: dirtScratchCtx } = makeCanvas(320));
}

export class GroundView {
  readonly mesh: THREE.Mesh;
  readonly tex: THREE.CanvasTexture;
  private readonly noiseCanvas: HTMLCanvasElement;
  private readonly stamps: Stamp[] = [];
  private readonly craters: Extract<Stamp, { kind: 'crater' }>[] = [];   // pushLotの走査用の別引き
  private drawn = 0;      // gCanvasへ描き込み済みの件数
  private flushAt = 0;    // GPU転送の間引き用(連続爆撃で毎フレーム転送しない)

  constructor(private readonly city: CityData, noiseRng: Rng) {
    ensureCanvases();
    // 地面の質感ノイズ(シード決定)
    const noise = makeCanvas(512);
    this.noiseCanvas = noise.canvas;
    const nc = noise.ctx;
    for (let i = 0; i < 9000; i++) {
      nc.fillStyle = noiseRng() < 0.55
        ? `rgba(0,0,0,${(0.04 + noiseRng() * 0.1).toFixed(3)})`
        : `rgba(255,255,255,${(0.03 + noiseRng() * 0.05).toFixed(3)})`;
      nc.fillRect(noiseRng() * 512, noiseRng() * 512, 1 + noiseRng() * 2.5, 1 + noiseRng() * 2.5);
    }

    this.tex = new THREE.CanvasTexture(gCanvas!);
    this.tex.anisotropy = 8;
    const geo = new THREE.PlaneGeometry(GROUND_WORLD, GROUND_WORLD, 96, 96);
    geo.rotateX(-Math.PI / 2);
    const gp = geo.getAttribute('position');
    for (let i = 0; i < gp.count; i++) gp.setY(i, city.terrain.h(gp.getX(i), gp.getZ(i)));
    geo.computeVertexNormals();
    this.mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: this.tex }));
    // 影は受けるだけで落とさない。地形に影を落とさせると影テクセルが粗い遠景で
    // 山肌が自己影により一様に暗くなり、木の影だけ出ている山肌と食い違って不自然
    this.mesh.receiveShadow = true;
  }

  // クレーターを登録する(scorch/nuke等の他の跡はpushStampでよい)
  pushCrater(x: number, z: number, r: number): void {
    const st = { kind: 'crater' as const, x, z, r, seed: (Math.random() * 2 ** 31) | 0 };
    this.stamps.push(st);
    this.craters.push(st);
  }

  pushStamp(st: Stamp): void {
    this.stamps.push(st);
  }

  // 基礎跡を登録する。ただしクレーター中心の深い穴(半径の内側50%)に入る場合は描かない。
  // 穴の中まで基礎が見えると「吹き飛んだ穴」感が消えるため。穴の外の地肌露出部や
  // 焦げ跡の下では基礎跡を残す(どちらも半透明なので基礎が透けて自然に見える)
  pushLot(b: Building): void {
    for (const st of this.craters) {
      const dx = b.x - st.x, dz = b.z - st.z, rr = st.r * 0.5;
      if (dx * dx + dz * dz < rr * rr) return;
    }
    this.stamps.push({ kind: 'lot', x: b.x, z: b.z, sx: b.sx, sz: b.sz, rot: b.rot });
  }

  private drawStamp(g: CanvasRenderingContext2D, G: GroundPalette, st: Stamp): void {
    const s = GROUND_SCALE, w2c = worldToTex;
    const px = w2c(st.x), pz = w2c(st.z);
    if (st.kind === 'lot') {             // 圧壊した建物の基礎跡
      g.save();
      g.translate(px, pz);
      g.rotate(-st.rot);
      g.fillStyle = FOUNDATION_STYLE;
      g.fillRect(-st.sx / 2 * s, -st.sz / 2 * s, st.sx * s, st.sz * s);
      g.restore();
    } else if (st.kind === 'crater') {   // 舗装が割れて地肌がのぞくクレーター + 中心の深い穴
      const r = st.r * s;
      const rand = mulberry32(st.seed);
      // 半径の揺らぎを小さく・頂点を多めにして、星型ではなく丸みのある不整形の多角形にする
      const blob = (rr: number): Path2D => {
        const p = new Path2D();
        const n = 12 + (rand() * 4 | 0), a0 = rand() * Math.PI * 2;
        for (let i = 0; i < n; i++) {
          const a = a0 + i / n * Math.PI * 2 + (rand() - 0.5) * 0.25;
          const rj = rr * (0.88 + rand() * 0.24);
          if (i) p.lineTo(Math.cos(a) * rj, Math.sin(a) * rj);
          else p.moveTo(Math.cos(a) * rj, Math.sin(a) * rj);
        }
        p.closePath();
        return p;
      };
      const outer = blob(r), hole = blob(r * 0.45);
      // 地肌: スクラッチに不透明で描き、露出済みマスク分を打ち抜いてから本体へ転写する
      // (未露出の画素だけが塗られ、露出済み領域の上の焦げ跡はそのまま残る)
      const sc = dirtScratchCtx!, half = dirtScratch!.width / 2;
      sc.save();
      sc.clearRect(0, 0, dirtScratch!.width, dirtScratch!.height);
      sc.translate(half, half);
      sc.fillStyle = G.crater;
      sc.fill(outer);
      sc.setTransform(1, 0, 0, 1, 0, 0);
      sc.globalCompositeOperation = 'destination-out';
      sc.drawImage(dirtMask!, px - half, pz - half, dirtScratch!.width, dirtScratch!.height,
        0, 0, dirtScratch!.width, dirtScratch!.height);
      sc.restore();
      g.drawImage(dirtScratch!, px - half, pz - half);
      // 今回の露出領域をマスクへ追加
      dirtMaskCtx!.save();
      dirtMaskCtx!.translate(px, pz);
      dirtMaskCtx!.fill(outer);
      dirtMaskCtx!.restore();
      // 中心の深い穴は最後の爆発が上書きしてよい
      g.save();
      g.translate(px, pz);
      g.fillStyle = 'rgba(10,9,8,0.55)';
      g.fill(hole);
      g.restore();
    } else {                           // 焦げ跡(scorch=通常 / nuke=核)の放射状グラデーション
      const r = st.r * s;
      const grd = g.createRadialGradient(px, pz, r * (st.kind === 'nuke' ? 0.09 : 0.06), px, pz, r);
      if (st.kind === 'nuke') {
        grd.addColorStop(0, 'rgba(8,8,8,0.92)'); grd.addColorStop(0.55, 'rgba(14,12,10,0.75)');
        grd.addColorStop(1, 'rgba(20,16,12,0)');
      } else {
        grd.addColorStop(0, 'rgba(8,8,8,0.9)'); grd.addColorStop(0.45, 'rgba(12,11,9,0.78)');
        grd.addColorStop(0.75, 'rgba(16,13,11,0.4)'); grd.addColorStop(1, 'rgba(20,16,12,0)');
      }
      g.fillStyle = grd;
      g.beginPath(); g.arc(px, pz, r, 0, Math.PI * 2); g.fill();
    }
  }

  // 新しく増えた跡だけをテクスチャへ差分追記する(drawGroundの全再描画は重い)
  flush(simT: number, G: GroundPalette): void {
    if (this.drawn >= this.stamps.length || simT < this.flushAt) return;
    this.flushAt = simT + 0.15;
    for (; this.drawn < this.stamps.length; this.drawn++)
      this.drawStamp(gCtx!, G, this.stamps[this.drawn]);
    this.tex.needsUpdate = true;
  }

  // 地面テクスチャの描画(時間帯トグルで呼び直す)
  drawGround(G: GroundPalette): void {
    const TEX = GROUND_TEX, s = GROUND_SCALE, w2c = worldToTex;
    const g = gCtx!;
    const city = this.city;
    // ポリラインをcanvasパスに起こす(塗り・道路・センターラインで共用)
    const trace = (pts: readonly Vec2[], close: boolean): void => {
      g.beginPath();
      pts.forEach((p, i) => i ? g.lineTo(w2c(p.x), w2c(p.z)) : g.moveTo(w2c(p.x), w2c(p.z)));
      if (close) g.closePath();
    };
    g.setLineDash([]);
    g.fillStyle = G.base; g.fillRect(0, 0, TEX, TEX);
    // 街区の塗り分け
    for (const poly of city.groundPolys) {
      trace(poly.pts, true);
      g.fillStyle = poly.kind === 'park' ? G.park : poly.kind === 'house' ? G.house : (poly.v ? G.block1 : G.block2);
      g.fill();
    }
    // 質感ノイズを全体に重ねる
    g.drawImage(this.noiseCanvas, 0, 0, TEX, TEX);
    // 空き区画の装飾(駐車場 / ポケットパーク)
    for (const dcl of city.lotDecals) {
      g.save();
      g.translate(w2c(dcl.x), w2c(dcl.z));
      g.rotate(-dcl.rot);
      g.fillStyle = dcl.kind === 'park' ? G.park : G.asphalt;
      g.fillRect(-dcl.w / 2 * s, -dcl.d / 2 * s, dcl.w * s, dcl.d * s);
      g.restore();
    }
    // 道路: 歩道の帯 → アスファルト → センターライン の順に重ねる
    const strokeRoad = (pts: readonly Vec2[], loop: boolean, width: number, style: string): void => {
      g.strokeStyle = style; g.lineWidth = Math.max(1, width * s);
      g.lineJoin = 'round'; g.lineCap = 'round';
      trace(pts, loop);
      g.stroke();
    };
    for (const al of city.alleyPaths) strokeRoad(al.pts, false, al.w, G.asphalt);   // 街区内の路地
    // 地形フィーチャ(山の緑 / 湾・水辺)。道路より先に描く
    // 川は全フィーチャの岸を先に、全フィーチャの水を後にまとめて描く。
    // 川同士が重なるとき、後描きの岸の帯が先描きの水面を横切って残らないようにするため
    const bankFills: (() => void)[] = [], waterFills: (() => void)[] = [];
    for (const f of city.terrain.feats) {
      if (f.kind === 'band') {
        if (f.type === 'm') {
          // 1辺全体の山脈: 縁側は不透明、内側の裾でフェード
          const pe = bandPt(f, 0, -100), pi = bandPt(f, 0, f.depth);
          const grd = g.createLinearGradient(w2c(pe.x), w2c(pe.z), w2c(pi.x), w2c(pi.z));
          grd.addColorStop(0, G.mtn1);
          grd.addColorStop(0.78, G.mtn1);
          grd.addColorStop(1, G.mtn2);
          g.fillStyle = grd;
          const c0 = bandPt(f, -MAP_HALF, f.depth), c1 = bandPt(f, MAP_HALF, -200);
          g.fillRect(Math.min(w2c(c0.x), w2c(c1.x)), Math.min(w2c(c0.z), w2c(c1.z)),
            Math.abs(w2c(c1.x) - w2c(c0.x)), Math.abs(w2c(c1.z) - w2c(c0.z)));
        } else {
          // 1辺全体の水辺: 岸線は揺らぎ、縁側は全て水(対岸なし)
          const fillBand = (inset: number, color: string): void => {
            const pts = shorePts(f, inset);
            pts.push(bandPt(f, MAP_HALF, -300), bandPt(f, -MAP_HALF, -300));
            trace(pts, true);
            g.fillStyle = color; g.fill();
          };
          bankFills.push(() => fillBand(14, G.bank));
          waterFills.push(() => fillBand(0, G.water));
        }
        continue;
      }
      const px = w2c(f.x), pz = w2c(f.z);
      if (f.type === 'm') {
        // 道路を削った跡が透けないよう、8割の半径までは完全不透明で塗る
        const grd = g.createRadialGradient(px, pz, f.r * 0.1 * s, px, pz, f.r * s);
        grd.addColorStop(0, G.mtn1);
        grd.addColorStop(0.78, G.mtn1);
        grd.addColorStop(1, G.mtn2);
        g.fillStyle = grd;
        g.beginPath(); g.arc(px, pz, f.r * s, 0, Math.PI * 2); g.fill();
      } else {
        // 湾: 揺らぐ岸線の内側が全て水(対岸なし)
        const fillBlob = (inset: number, color: string): void => {
          trace(shorePts(f, inset), true);
          g.fillStyle = color; g.fill();
        };
        bankFills.push(() => fillBlob(14, G.bank));
        waterFills.push(() => fillBlob(0, G.water));
      }
    }
    for (const d of bankFills) d();
    for (const d of waterFills) d();
    for (const rp of city.roadPaths) strokeRoad(rp.pts, rp.loop, rp.w + 11, G.sidewalk);
    for (const rp of city.roadPaths) strokeRoad(rp.pts, rp.loop, rp.w, G.asphalt);
    g.setLineDash([6, 8]);
    for (const rp of city.roadPaths) if (rp.major) strokeRoad(rp.pts, rp.loop, 1 / s, G.lane);   // センターライン(1px)
    g.setLineDash([]);
    // 破壊の跡(基礎跡・クレーター・焦げ跡)を時系列順に描き直す(地肌マスクも作り直す)
    dirtMaskCtx!.clearRect(0, 0, dirtMask!.width, dirtMask!.height);
    for (const st of this.stamps) this.drawStamp(g, G, st);
    this.drawn = this.stamps.length;
    this.tex.needsUpdate = true;
  }
}
