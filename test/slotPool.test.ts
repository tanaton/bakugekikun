import { describe, expect, it } from 'vitest';
import { SlotPool, type Slotted } from '../src/core/slotPool';

interface Item extends Slotted { id: number }
const item = (id: number): Item => ({ id, slot: -1 });

describe('SlotPool', () => {
  it('spawnはスロットをリング順に採番する', () => {
    const pool = new SlotPool<Item>(3);
    expect(pool.spawn(item(0)).slot).toBe(0);
    expect(pool.spawn(item(1)).slot).toBe(1);
    expect(pool.spawn(item(2)).slot).toBe(2);
    expect(pool.spawn(item(3)).slot).toBe(0);   // 一周して最古を奪う
  });

  it('飽和時にスロットを奪われた個体はsweepでfnを呼ばれずに除去される', () => {
    const pool = new SlotPool<Item>(2);
    const a = pool.spawn(item(0));
    const b = pool.spawn(item(1));
    const c = pool.spawn(item(2));   // aのslot 0を奪う
    const seen: number[] = [];
    pool.sweep(p => { seen.push(p.id); return true; });
    expect(seen.sort()).toEqual([1, 2]);          // aはfnを呼ばれない
    expect(pool.list).toContain(b);
    expect(pool.list).toContain(c);
    expect(pool.list).not.toContain(a);
  });

  it('sweepでfalseを返した個体は除去され、スロットが解放される', () => {
    const pool = new SlotPool<Item>(4);
    for (let i = 0; i < 4; i++) pool.spawn(item(i));
    pool.sweep(p => p.id % 2 === 0);   // 奇数を除去
    expect(pool.list.map(p => p.id).sort()).toEqual([0, 2]);
    pool.sweep(() => true);
    expect(pool.list.length).toBe(2);
  });

  it('swap-removeしても生存個体は失われない', () => {
    const pool = new SlotPool<Item>(100);
    for (let i = 0; i < 100; i++) pool.spawn(item(i));
    pool.sweep(p => p.id >= 50);
    expect(pool.list.length).toBe(50);
    expect(new Set(pool.list.map(p => p.id)).size).toBe(50);
    for (const p of pool.list) expect(p.id).toBeGreaterThanOrEqual(50);
  });

  it('clearで全個体とスロット所有権が消える', () => {
    const pool = new SlotPool<Item>(3);
    pool.spawn(item(0));
    pool.clear();
    expect(pool.list.length).toBe(0);
    const seen: number[] = [];
    pool.sweep(p => { seen.push(p.id); return true; });
    expect(seen).toEqual([]);
  });
});
