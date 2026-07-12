// 2D都市マップオーバーレイ(Mキーまたは地図ボタンで表示、クリック/Escで閉じる)。
// 地面テクスチャのcanvas(爆撃跡が焼き込まれた常に最新の絵)をそのまま縮小表示し、
// カメラ注視点のマーカーを重ねる。ゲームは裏で進み続けるので、開いている間は
// 低頻度で再描画して跡とマーカーを追従させる(2048→1024のdrawImageは1ms未満)

import { GROUND_TEX, worldToTex } from '../core/config';
import { $, isInputTarget } from './hud';

export const MAP_CANVAS_SIZE = 1024;   // 実バッファのpx。表示サイズはCSS側(min(90vw,90vh))
const REDRAW_MS = 200;
const TICKS = [[1, 0], [-1, 0], [0, 1], [0, -1]];   // マーカー十字の四方

// ワールド座標 → マップcanvas座標。地面テクスチャと同じ座標系(worldToTex)の縮尺なので
// マーカーとテクスチャが必ず一致する(純関数。nodeテスト対象)
export function focusToMapPx(x: number, z: number, size: number): { px: number; py: number } {
  return { px: worldToTex(x) * size / GROUND_TEX, py: worldToTex(z) * size / GROUND_TEX };
}

export interface MapDeps {
  // 再生成でworld.viewごと差し替わるため、canvasは描画のたびにgetterで取り直す
  getGroundCanvas: () => HTMLCanvasElement;
  cam: { focus: { x: number; z: number } };
}

export function wireMap(deps: MapDeps): { close: () => void } {
  const overlay = $('mapOverlay');
  const canvas = $('mapCanvas') as HTMLCanvasElement;
  canvas.width = canvas.height = MAP_CANVAS_SIZE;
  const g = canvas.getContext('2d')!;
  let timer = 0;   // 0でないとき=表示中(再描画インターバルのID)

  const draw = (): void => {
    g.drawImage(deps.getGroundCanvas(), 0, 0, GROUND_TEX, GROUND_TEX,
      0, 0, MAP_CANVAS_SIZE, MAP_CANVAS_SIZE);
    // カメラ注視点のマーカー(円+四方の十字ティック)
    const { px, py } = focusToMapPx(deps.cam.focus.x, deps.cam.focus.z, MAP_CANVAS_SIZE);
    g.strokeStyle = '#ffb454';
    g.lineWidth = 2.5;
    g.beginPath(); g.arc(px, py, 10, 0, Math.PI * 2); g.stroke();
    g.beginPath();
    for (const [dx, dy] of TICKS) {
      g.moveTo(px + dx * 6, py + dy * 6);
      g.lineTo(px + dx * 17, py + dy * 17);
    }
    g.stroke();
  };
  const close = (): void => {
    if (!timer) return;
    clearInterval(timer);
    timer = 0;
    overlay.classList.remove('open');
  };
  const open = (): void => {
    if (timer) return;
    overlay.classList.add('open');
    draw();
    timer = window.setInterval(draw, REDRAW_MS);
  };
  const toggle = (): void => { if (timer) close(); else open(); };

  $('mapBtn').textContent = '地図';
  $('mapBtn').addEventListener('click', toggle);
  overlay.addEventListener('click', close);   // オーバーレイのどこをタップしても閉じる
  addEventListener('keydown', e => {
    if (isInputTarget(e)) return;
    if (e.code === 'KeyM') toggle();
    else if (e.code === 'Escape') close();
  });
  return { close };
}
