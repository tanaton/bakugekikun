// 空間ハッシュ。登録側・検索側で必ず同じセル座標系を使う。
// 静的な対象(建物・木・駐車車両)の近傍走査用(距離判定は呼び出し側で行う)

import { GRID_CELL, MAP_HALF } from './config';

// セル座標→Map/Setキーの共有パッキング(SpatialHashとRoadMaskで同じ約束を使う)。
// 8192 > 世界の最大セル数(最小セル幅20mでも 2*MAP_HALF/20 = 270)なので衝突しない
export const packCellKey = (cx: number, cz: number): number => cx * 8192 + cz;

export class SpatialHash<T> {
  private readonly map = new Map<number, T[]>();

  constructor(
    private readonly cell: number = GRID_CELL,
    private readonly origin: number = MAP_HALF,
  ) {}

  private cellOf(v: number): number { return Math.floor((v + this.origin) / this.cell); }
  private key(cx: number, cz: number): number { return packCellKey(cx, cz); }

  insert(x: number, z: number, item: T): void {
    const k = this.key(this.cellOf(x), this.cellOf(z));
    const list = this.map.get(k);
    if (list) list.push(item);
    else this.map.set(k, [item]);
  }

  // (x,z)を中心に半径rのセル範囲を走査し、各要素にfnを呼ぶ(距離判定はfn側で行う)
  forEachNear(x: number, z: number, r: number, fn: (item: T) => void): void {
    const c0x = this.cellOf(x - r), c1x = this.cellOf(x + r);
    const c0z = this.cellOf(z - r), c1z = this.cellOf(z + r);
    for (let cx = c0x; cx <= c1x; cx++) for (let cz = c0z; cz <= c1z; cz++) {
      const cell = this.map.get(this.key(cx, cz));
      if (cell) for (const o of cell) fn(o);
    }
  }
}
