// 地面テクスチャ(街区の塗り分け・道路・地形フィーチャ)と破壊跡の焼き込み。
//
// 破壊の跡(基礎跡・クレーター・焦げ跡)はすべて、起伏に完全に沿う地面テクスチャへ
// 直接描き込む。3Dデカールは頂点間の直線補間が地面メッシュの起伏とずれて浮き・埋まりが
// 出るため使わない。跡はリストに溜め直さず、透明な累積レイヤー(overlay)と地肌マスク
// (dirtMask)へ焼き込んで捨てる。時間帯の塗り直しはベース再描画+レイヤー合成だけで済み、
// 跡が何千件溜まってもコストが一定(全スタンプの再生をしない)

import * as THREE from 'three';
import type { CityData } from '../core/cityGen';
import { GROUND_SCALE, GROUND_TEX, GROUND_WORLD, MAP_HALF, worldToTex } from '../core/config';
import { inPond, POND_BANK_INSET, pondPts } from '../core/ponds';
import { mulberry32, type Rng } from '../core/rng';
import { BANK_INSET, bandPt, shorePts } from '../core/terrain';
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
// flushの部分転送(copyTextureToTexture)用にgCanvas全体を包むソーステクスチャ。
// レンダラーで描画しない=GPUに載らないため、コピーはtexSubImage2Dのcanvas経路になり
// UNPACK_SKIP_*でダーティ矩形だけがアップロードされる
let gSrcTex: THREE.CanvasTexture | null = null;
// 地肌の露出済み領域マスク。地肌は不透明で塗るが「先に露出した領域には上書きしない」
// ことで、露出済みの上に溜まった焦げ跡を後発の爆発が塗り潰さないようにする。
// 画素は現在のパレットの地肌色で塗られており、時間帯切替では全体を再着色して
// そのままベースへ合成する(αが露出領域、色が見た目を兼ねる)
let dirtMask: HTMLCanvasElement | null = null;
let dirtMaskCtx: CanvasRenderingContext2D | null = null;
let dirtScratch: HTMLCanvasElement | null = null;   // 1クレーター分の作業用
let dirtScratchCtx: CanvasRenderingContext2D | null = null;
// 破壊跡の累積レイヤー(透明)。地肌以外の跡(焦げ・穴・基礎跡)を時系列順のまま溜め、
// クレーターの地肌露出時には新規露出画素の古い跡を打ち抜く。時間帯の塗り直しは
// ベース+dirtMask+このレイヤーの合成だけで再現できる
let overlay: HTMLCanvasElement | null = null;
let overlayCtx: CanvasRenderingContext2D | null = null;

function ensureCanvases(): void {
  if (gCanvas) return;
  ({ canvas: gCanvas, ctx: gCtx } = makeCanvas(GROUND_TEX));
  ({ canvas: dirtMask, ctx: dirtMaskCtx } = makeCanvas(GROUND_TEX));
  ({ canvas: overlay, ctx: overlayCtx } = makeCanvas(GROUND_TEX));
  ({ canvas: dirtScratch, ctx: dirtScratchCtx } = makeCanvas(320));
  gSrcTex = new THREE.CanvasTexture(gCanvas);
}

// スタンプが描き込む範囲の半径(テクスチャpx)。部分転送のダーティ矩形計算用
const stampRadiusPx = (st: Stamp): number => 2 + GROUND_SCALE * (
  st.kind === 'lot' ? Math.hypot(st.sx, st.sz) / 2
  : st.kind === 'crater' ? st.r * 1.15   // blobの半径揺らぎ(最大1.12倍)ぶんの余白
  : st.r);

// ダーティ矩形がテクスチャ面積のこの割合を超えたら全量転送の方が安い(テストと共有)
export const FLUSH_FULL_RATIO = 0.35;

// 最後の部分転送からこの秒数だけ静かならGPUテクスチャを作り直す(テストと共有)
export const RESPEC_DELAY = 3;

const _box = new THREE.Box2();
const _dstPos = new THREE.Vector2();

export class GroundView {
  readonly mesh: THREE.Mesh;
  readonly tex: THREE.CanvasTexture;
  private readonly noiseCanvas: HTMLCanvasElement;
  private readonly pending: Stamp[] = [];   // 未描画の跡(描き込んだらoverlay/dirtMaskに残して捨てる)
  private readonly craters: Extract<Stamp, { kind: 'crater' }>[] = [];   // pushLotの穴判定用(数値のみの全履歴)
  private flushAt = 0;    // GPU転送の間引き用(連続爆撃で毎フレーム転送しない)
  private respecAt = 0;   // 部分転送後のGPUテクスチャ作り直し予約時刻(0=予約なし)
  private palette!: GroundPalette;   // 現在の時間帯パレット(drawGroundで確定。flushの差分描きが使う)

  constructor(private readonly city: CityData, noiseRng: Rng) {
    ensureCanvases();
    // 破壊跡の累積レイヤーと地肌マスクはモジュール常設なので、新しい街ではまっさらに戻す
    overlayCtx!.clearRect(0, 0, GROUND_TEX, GROUND_TEX);
    dirtMaskCtx!.clearRect(0, 0, GROUND_TEX, GROUND_TEX);
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
    // 部分転送(flush)でY反転とサブ矩形選択の相互作用に踏み込まないよう、テクスチャは
    // 無反転で持ち、UVのV軸を反転して同じ見た目にする(canvas座標=テクスチャ座標になる)
    this.tex.flipY = false;
    // 分割数は岸の描画品質で決めている: 水域内の地形は岸線で水底(WATER_BED_Y)へ沈む
    // (terrain.h)が、頂点間隔が粗いと補間で水面(WATER_SURFACE_Y)より上に浮き、
    // 水色に塗った地面が岸沿いに露出する。水域のない街は粗い分割で足りる
    const segs = city.terrain.feats.some(f => f.type === 'r') ? 144 : 96;
    const geo = new THREE.PlaneGeometry(GROUND_WORLD, GROUND_WORLD, segs, segs);
    geo.rotateX(-Math.PI / 2);
    const gp = geo.getAttribute('position');
    for (let i = 0; i < gp.count; i++) gp.setY(i, city.terrain.h(gp.getX(i), gp.getZ(i)));
    geo.computeVertexNormals();
    const uv = geo.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
    this.mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: this.tex }));
    // 影は受けるだけで落とさない。地形に影を落とさせると影テクセルが粗い遠景で
    // 山肌が自己影により一様に暗くなり、木の影だけ出ている山肌と食い違って不自然
    this.mesh.receiveShadow = true;
  }

  // クレーターを登録する(scorch/nuke等の他の跡はpushStampでよい)。
  // 水面は跡が残らない、はスタンプ機構側のルール(呼び出し側は無条件に登録してよい)。
  // 戻り値は「跡を描いたか」。falseなら呼び出し側は基礎の消失(destroyAround)も
  // 行わないこと(クレーターの見た目と基礎が消える範囲を常に一致させる)
  pushCrater(x: number, z: number, r: number): boolean {
    if (this.city.terrain.inWater(x, z) || inPond(this.city.ponds, x, z)) return false;
    const st = { kind: 'crater' as const, x, z, r, seed: (Math.random() * 2 ** 31) | 0 };
    this.pending.push(st);
    this.craters.push(st);
    return true;
  }

  pushStamp(st: Stamp): void {
    if (this.city.terrain.inWater(st.x, st.z) || inPond(this.city.ponds, st.x, st.z)) return;
    this.pending.push(st);
  }

  // 基礎跡を登録する。ただしクレーター中心の深い穴(半径の内側50%)に入る場合は描かない。
  // 穴の中まで基礎が見えると「吹き飛んだ穴」感が消えるため。穴の外の地肌露出部や
  // 焦げ跡の下では基礎跡を残す(どちらも半透明なので基礎が透けて自然に見える)
  pushLot(b: Building): void {
    for (const st of this.craters) {
      const dx = b.x - st.x, dz = b.z - st.z, rr = st.r * 0.5;
      if (dx * dx + dz * dz < rr * rr) return;
    }
    this.pending.push({ kind: 'lot', x: b.x, z: b.z, sx: b.sx, sz: b.sz, rot: b.rot });
  }

  // スタンプ1件をgCanvas(g)へ描き込み、同時に累積レイヤーへ焼き込む。
  // 地肌はdirtMask(色付き)、それ以外の半透明の跡はoverlayに残るので、
  // 時間帯の塗り直しはスタンプを再生せずレイヤー合成だけで再現できる
  private drawStamp(g: CanvasRenderingContext2D, G: GroundPalette, st: Stamp): void {
    const o = overlayCtx!;
    const s = GROUND_SCALE, w2c = worldToTex;
    const px = w2c(st.x), pz = w2c(st.z);
    if (st.kind === 'lot') {             // 圧壊した建物の基礎跡
      for (const c of [g, o]) {
        c.save();
        c.translate(px, pz);
        c.rotate(-st.rot);
        c.fillStyle = FOUNDATION_STYLE;
        c.fillRect(-st.sx / 2 * s, -st.sz / 2 * s, st.sx * s, st.sz * s);
        c.restore();
      }
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
      // 新規露出した画素の上に溜まっていた古い跡は消し飛ぶ(時系列の上書きを累積レイヤーでも再現)
      o.save();
      o.globalCompositeOperation = 'destination-out';
      o.drawImage(dirtScratch!, px - half, pz - half);
      o.restore();
      // 今回の露出領域をマスクへ追加(現在のパレットの地肌色で。時間帯切替時に全体を再着色する)
      dirtMaskCtx!.save();
      dirtMaskCtx!.fillStyle = G.crater;
      dirtMaskCtx!.translate(px, pz);
      dirtMaskCtx!.fill(outer);
      dirtMaskCtx!.restore();
      // 中心の深い穴は最後の爆発が上書きしてよい
      for (const c of [g, o]) {
        c.save();
        c.translate(px, pz);
        c.fillStyle = 'rgba(10,9,8,0.55)';
        c.fill(hole);
        c.restore();
      }
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
      for (const c of [g, o]) {
        c.fillStyle = grd;
        c.beginPath(); c.arc(px, pz, r, 0, Math.PI * 2); c.fill();
      }
    }
  }

  // 新しく増えた跡だけをテクスチャへ差分追記する(drawGroundの全再描画は重い)。
  // GPUへも跡のダーティ矩形だけを部分転送し、毎回の全量(2048²≈16.8MB)アップロードを避ける。
  // rendererなし(nodeテスト)や、離れた複数の跡で矩形が肥大したときは全量転送にフォールバック
  flush(renderer: THREE.WebGLRenderer | null, simT: number): void {
    if (!this.pending.length) {
      // 爆撃が一段落したら一度だけGPUテクスチャを作り直す。部分転送(texSubImage2D +
      // generateMipmap)を受けたテクスチャは、モバイルGPUドライバの圧縮レイアウト最適化が
      // 外れたまま残り、全画面を覆う地面のサンプリングが恒常的に重くなる(エフェクトが
      // 消えてもfpsが落ちたままになる)。破棄→全量再アップロードで最適化の効いた状態に戻す
      if (this.respecAt && simT >= this.respecAt) {
        this.respecAt = 0;
        this.tex.dispose();
        this.tex.needsUpdate = true;
      }
      return;
    }
    if (simT < this.flushAt) return;
    this.flushAt = simT + 0.15;
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const st of this.pending) {
      this.drawStamp(gCtx!, this.palette, st);
      const px = worldToTex(st.x), pz = worldToTex(st.z), r = stampRadiusPx(st);
      x0 = Math.min(x0, px - r); z0 = Math.min(z0, pz - r);
      x1 = Math.max(x1, px + r); z1 = Math.max(z1, pz + r);
    }
    this.pending.length = 0;
    x0 = Math.max(0, Math.floor(x0)); z0 = Math.max(0, Math.floor(z0));
    x1 = Math.min(GROUND_TEX, Math.ceil(x1)); z1 = Math.min(GROUND_TEX, Math.ceil(z1));
    this.respecAt = simT + RESPEC_DELAY;   // 新しい跡が続く間は作り直しを先送りする
    if (!renderer || x1 <= x0 || z1 <= z0 ||
        (x1 - x0) * (z1 - z0) > GROUND_TEX * GROUND_TEX * FLUSH_FULL_RATIO) {
      this.tex.needsUpdate = true;   // 全量転送でも既存GLテクスチャへの上書きなので作り直しは行う
      return;
    }
    _box.min.set(x0, z0); _box.max.set(x1, z1);
    renderer.copyTextureToTexture(gSrcTex!, this.tex, _box, _dstPos.set(x0, z0));
  }

  // 地面テクスチャの描画(時間帯トグルで呼び直す)
  drawGround(G: GroundPalette): void {
    this.palette = G;
    // 未描画の跡を先に累積レイヤーへ焼き込んでおく(gCanvasはこの後まるごと描き直す)
    for (const st of this.pending) this.drawStamp(gCtx!, G, st);
    this.pending.length = 0;
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
    for (const pp of city.parkPaths) strokeRoad(pp.pts, false, pp.w, G.parkPath);   // 公園の園路
    // 公園の池(テクスチャのみの水域)。全池の岸の帯 → 全池の水面の順に園路の上へ重ねる
    // (ひょうたん池は2つのPondが重なるため、後描きの岸が先描きの水面を横切らないように)
    g.fillStyle = G.bank;
    for (const pd of city.ponds) { trace(pondPts(pd, POND_BANK_INSET), true); g.fill(); }
    g.fillStyle = G.water;
    for (const pd of city.ponds) { trace(pondPts(pd, 0), true); g.fill(); }
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
          bankFills.push(() => fillBand(BANK_INSET, G.bank));
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
        bankFills.push(() => fillBlob(BANK_INSET, G.bank));
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
    // 破壊の跡: 露出済みの地肌(dirtMask)を現在のパレットの地肌色に着色し直してから、
    // 破壊跡の累積レイヤー(overlay)ごと重ねる。スタンプを1件ずつ再生しないので、
    // 跡が何千件溜まっても時間帯切替のコストは一定
    dirtMaskCtx!.save();
    dirtMaskCtx!.globalCompositeOperation = 'source-in';
    dirtMaskCtx!.fillStyle = G.crater;
    dirtMaskCtx!.fillRect(0, 0, TEX, TEX);
    dirtMaskCtx!.restore();
    g.drawImage(dirtMask!, 0, 0);
    g.drawImage(overlay!, 0, 0);
    this.tex.needsUpdate = true;
  }
}
