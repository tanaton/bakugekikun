// リングカーソルでスロットを割り当てる固定長プール(パーティクルと瓦礫で共用)。
// あふれたら最古のスロットを奪う。奪われた個体はsweep時に持ち主不一致で除去される。
// 除去された個体のレコードはfreeへ回収し、take()で使い回す
// (spawnがホットパスなので、粒子ごとのオブジェクト確保を定常状態でゼロにする)

export interface Slotted { slot: number }

export class SlotPool<T extends Slotted> {
  readonly max: number;
  readonly list: T[] = [];
  private cursor = 0;
  private readonly owner: (T | null)[];   // slot → 現在の持ち主(プール飽和時の奪い合い検出)
  private readonly free: T[] = [];        // 除去済み個体のレコード置き場(次のspawnで再利用)

  constructor(max: number) {
    this.max = max;
    this.owner = new Array<T | null>(max).fill(null);
  }

  // 再利用できるレコードを取り出す(なければundefined。呼び出し側が新規に確保する)。
  // 中身は死んだ個体の値のままなので、全フィールドを書き直してからspawnに渡すこと
  take(): T | undefined {
    return this.free.pop();
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
      this.free.push(p);
      this.list[i] = this.list[this.list.length - 1];
      this.list.pop();
    }
  }

  clear(): void {
    for (const p of this.list) this.free.push(p);   // レコードは再生成後も使い回す
    this.list.length = 0;
    this.owner.fill(null);
  }
}
