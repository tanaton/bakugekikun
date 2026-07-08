// ファサードテクスチャ生成(canvas 2D)。シード決定('facadeTex'ストリーム)

import * as THREE from 'three';
import type { Rng } from '../core/rng';
import { makeCanvas } from './canvas2d';

export interface TexPair { map: THREE.CanvasTexture; emissiveMap: THREE.CanvasTexture }

function texPair(w: number, h: number,
    draw: (fc: CanvasRenderingContext2D, ec: CanvasRenderingContext2D, w: number, h: number) => void,
    rx = 1, ry = 1): TexPair {
  const face = makeCanvas(w, h);
  const emis = makeCanvas(w, h);
  draw(face.ctx, emis.ctx, w, h);
  const t1 = new THREE.CanvasTexture(face.canvas), t2 = new THREE.CanvasTexture(emis.canvas);
  for (const t of [t1, t2]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; t.repeat.set(rx, ry); }
  return { map: t1, emissiveMap: t2 };
}

// コンクリート系オフィスビル: 床スラブの影 + 窓抜き + ブラインド
export function makeConcreteTexture(rng: Rng): TexPair {
  return texPair(256, 256, (fc, ec, W, H) => {
    fc.fillStyle = '#a9a49b'; fc.fillRect(0, 0, W, H);
    for (let i = 0; i < 700; i++) {                        // 壁面の汚れ
      fc.fillStyle = `rgba(60,55,50,${(rng() * 0.08).toFixed(3)})`;
      fc.fillRect(rng() * W, rng() * H, 2 + rng() * 5, 2 + rng() * 5);
    }
    ec.fillStyle = '#000'; ec.fillRect(0, 0, W, H);
    const rows = 16, cols = 8, ch = H / rows, cw = W / cols;
    for (let r = 0; r < rows; r++) {
      fc.fillStyle = 'rgba(0,0,0,0.22)';                 // スラブ下の影
      fc.fillRect(0, r * ch, W, 2);
      for (let c = 0; c < cols; c++) {
        const x = c * cw + 3, y = r * ch + 4, w = cw - 6, h = ch - 7;
        const sky = 30 + (1 - r / rows) * 22 + rng() * 14;   // 上階ほど空が映る
        fc.fillStyle = `hsl(212, 18%, ${sky.toFixed(0)}%)`;
        fc.fillRect(x, y, w, h);
        if (rng() < 0.18) { fc.fillStyle = 'rgba(226,220,205,0.85)'; fc.fillRect(x, y, w, h * 0.5); } // ブラインド
        if (rng() < 0.38) {
          ec.fillStyle = `rgba(255,196,128,${(0.45 + rng() * 0.55).toFixed(2)})`;
          ec.fillRect(x, y, w, h);
        }
      }
    }
  }, 1.5, 4);
}

// ガラスカーテンウォール: 細いマリオン + 空の反射グラデーション
export function makeGlassTexture(rng: Rng): TexPair {
  return texPair(256, 256, (fc, ec, W, H) => {
    fc.fillStyle = '#1d2733'; fc.fillRect(0, 0, W, H);   // マリオン
    ec.fillStyle = '#000'; ec.fillRect(0, 0, W, H);
    const rows = 22, cols = 12, ch = H / rows, cw = W / cols;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const x = c * cw + 1, y = r * ch + 1.5, w = cw - 2, h = ch - 3;
      const l = 24 + (1 - r / rows) * 26 + rng() * 16;   // 上ほど明るい空の反射
      fc.fillStyle = `hsl(${(205 + rng() * 14).toFixed(0)}, ${(24 + rng() * 14).toFixed(0)}%, ${l.toFixed(0)}%)`;
      fc.fillRect(x, y, w, h);
      if (rng() < 0.08) { fc.fillStyle = 'rgba(235,240,245,0.9)'; fc.fillRect(x, y, w, h); } // 強い反射
      if (rng() < 0.5) {
        ec.fillStyle = `rgba(255,206,140,${(0.35 + rng() * 0.6).toFixed(2)})`;
        ec.fillRect(x, y, w, h);
      }
    }
  }, 1, 3);
}

// 民家の外壁: 窓 + 玄関 + 軒の影
export function makeHouseTexture(rng: Rng): TexPair {
  return texPair(128, 128, (fc, ec, W, H) => {
    fc.fillStyle = '#efece2'; fc.fillRect(0, 0, W, H);
    for (let i = 0; i < 240; i++) {
      fc.fillStyle = `rgba(120,110,95,${(rng() * 0.07).toFixed(3)})`;
      fc.fillRect(rng() * W, rng() * H, 2, 2 + rng() * 4);
    }
    fc.fillStyle = 'rgba(0,0,0,0.18)'; fc.fillRect(0, 0, W, 6);   // 軒の影
    ec.fillStyle = '#000'; ec.fillRect(0, 0, W, H);
    const win = (x: number, y: number, w: number, h: number): void => {
      fc.fillStyle = '#f7f5ee'; fc.fillRect(x - 2, y - 2, w + 4, h + 4);  // 窓枠
      fc.fillStyle = '#39434e'; fc.fillRect(x, y, w, h);
      if (rng() < 0.5) { ec.fillStyle = `rgba(255,200,130,${(0.5 + rng() * 0.5).toFixed(2)})`; ec.fillRect(x, y, w, h); }
    };
    win(16, 26, 30, 26); win(82, 26, 30, 26);            // 2階の窓
    win(14, 78, 34, 30);                                  // 1階の窓
    fc.fillStyle = '#6e5644'; fc.fillRect(76, 74, 26, 54); // 玄関ドア
    fc.fillStyle = 'rgba(0,0,0,0.25)'; fc.fillRect(76, 124, 26, 4);
  });
}
