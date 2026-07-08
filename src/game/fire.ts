// 延焼: 跡地の残り火と、炎上して時間差で崩れる建物

import { B } from '../core/types';
import { playPop } from '../ui/audio';
import { startCollapse } from './destruction';
import type { World } from './world';

// 破壊された建物の跡地がしばらく燃え続ける
export function updateBurning(world: World): void {
  const { sim, gfx } = world;
  for (let i = sim.burnSites.length - 1; i >= 0; i--) {
    const s = sim.burnSites[i];
    if (sim.simT > s.until) { sim.burnSites.splice(i, 1); continue; }
    if (sim.simT < s.next) continue;
    s.next = sim.simT + 0.07 + Math.random() * 0.16;
    const jx = (Math.random() - 0.5) * 14, jz = (Math.random() - 0.5) * 14;
    gfx.fireP.spawn({ x: s.x + jx, y: s.gy + 2, z: s.z + jz, gy: s.gy,
      vx: (Math.random() - 0.5) * 4, vy: 9 + Math.random() * 16, vz: (Math.random() - 0.5) * 4,
      life: 0.5 + Math.random() * 0.5, size: 6 + Math.random() * 9,
      r: 1, g: 0.5 + Math.random() * 0.25, b: 0.12, baseAlpha: 0.85 });
    if (Math.random() < 0.45) {
      gfx.smokeP.spawn({ x: s.x + jx, y: s.gy + 6, z: s.z + jz, gy: s.gy,
        vx: (Math.random() - 0.5) * 3, vy: 12 + Math.random() * 14, vz: (Math.random() - 0.5) * 3,
        life: 3 + Math.random() * 3, size: 14 + Math.random() * 16, growth: 2.4, drag: 0.25, fadeIn: 0.4,
        r: 0.2, g: 0.19, b: 0.185, baseAlpha: 0.5 });
    }
  }
}

// 炎上中の建物: 燃えながら、時間が来たら崩れ落ちる
export function updateBurningBldgs(world: World): void {
  const { sim, gfx } = world;
  for (let i = sim.burningBldgs.length - 1; i >= 0; i--) {
    const s = sim.burningBldgs[i], b = s.b;
    if (b.state !== B.Burning) { sim.burningBldgs.splice(i, 1); continue; }  // 先に別の爆撃で破壊された
    if (sim.simT >= s.collapseAt) {
      sim.burningBldgs.splice(i, 1);
      const a = Math.random() * Math.PI * 2;
      startCollapse(world, b, Math.cos(a), Math.sin(a), true);   // ランダムな方向に倒壊
      playPop();
      continue;
    }
    if (sim.simT < s.next) continue;
    s.next = sim.simT + 0.09 + Math.random() * 0.18;
    // 壁面のあちこちから火の手
    const ex = b.x + (Math.random() - 0.5) * b.sx * 1.05;
    const ez = b.z + (Math.random() - 0.5) * b.sz * 1.05;
    const ey = b.gy + b.h * (0.25 + Math.random() * 0.75);
    gfx.fireP.spawn({ x: ex, y: ey, z: ez, gy: b.gy,
      vx: (Math.random() - 0.5) * 5, vy: 10 + Math.random() * 18, vz: (Math.random() - 0.5) * 5,
      life: 0.4 + Math.random() * 0.5, size: 7 + Math.random() * 10,
      r: 1, g: 0.55 + Math.random() * 0.25, b: 0.14, baseAlpha: 0.9 });
    if (Math.random() < 0.5) {
      gfx.smokeP.spawn({ x: b.x + (Math.random() - 0.5) * b.sx * 0.5, y: b.gy + b.h + 3,
        z: b.z + (Math.random() - 0.5) * b.sz * 0.5, gy: b.gy,
        vx: (Math.random() - 0.5) * 4, vy: 14 + Math.random() * 16, vz: (Math.random() - 0.5) * 4,
        life: 2.5 + Math.random() * 2.5, size: 12 + Math.random() * 16, growth: 2.6, drag: 0.2, fadeIn: 0.3,
        r: 0.16, g: 0.15, b: 0.15, baseAlpha: 0.6 });
    }
  }
}
