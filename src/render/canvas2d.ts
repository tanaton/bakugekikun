// canvas 2D生成の共通ヘルパー(テクスチャ描画用)

export interface Canvas2D { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D }

export function makeCanvas(w: number, h = w): Canvas2D {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return { canvas, ctx: canvas.getContext('2d')! };
}
