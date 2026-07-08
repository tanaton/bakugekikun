// リングカーソルでスロットを割り当てる固定長プール(パーティクルと瓦礫で共用)。
// あふれたら最古のスロットを奪う。奪われた個体はsweep時に持ち主不一致で除去される

export interface Slotted { slot: number }

export class SlotPool<T extends Slotted> {
  readonly max: number;
  readonly list: T[] = [];
  private cursor = 0;
  private readonly owner: (T | null)[];   // slot → 現在の持ち主(プール飽和時の奪い合い検出)

  constructor(max: number) {
    this.max = max;
    this.owner = new Array<T | null>(max).fill(null);
  }

  spawn(item: T): T {
    item.slot = this.cursor;
    this.owner[item.slot] = item;
    this.cursor = (this.cursor + 1) % this.max;
    this.list.push(item);
    return item;
  }

  // 全個体にfnを呼び、falseを返した個体は除去する(順序はslotが持つのでswap-remove)。
  // スロットを奪われた個体はfnを呼ばず除去だけする(スロットは新しい持ち主の管理)
  sweep(fn: (item: T) => boolean): void {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      const owned = this.owner[p.slot] === p;
      if (owned && fn(p)) continue;
      if (owned) this.owner[p.slot] = null;
      this.list[i] = this.list[this.list.length - 1];
      this.list.pop();
    }
  }

  clear(): void {
    this.list.length = 0;
    this.owner.fill(null);
  }
}
