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
    const fp = gfx.fireP.spawn(s.x + jx, s.gy + 2, s.z + jz, 1, 0.5 + Math.random() * 0.25, 0.12);
    fp.gy = s.gy;
    fp.vx = (Math.random() - 0.5) * 4; fp.vy = 9 + Math.random() * 16; fp.vz = (Math.random() - 0.5) * 4;
    fp.life = 0.5 + Math.random() * 0.5; fp.size = 6 + Math.random() * 9; fp.baseAlpha = 0.85;
    if (Math.random() < 0.45) {
      const sm = gfx.smokeP.spawn(s.x + jx, s.gy + 6, s.z + jz, 0.2, 0.19, 0.185);
      sm.gy = s.gy;
      sm.vx = (Math.random() - 0.5) * 3; sm.vy = 12 + Math.random() * 14; sm.vz = (Math.random() - 0.5) * 3;
      sm.life = 3 + Math.random() * 3; sm.size = 14 + Math.random() * 16;
      sm.growth = 2.4; sm.drag = 0.25; sm.fadeIn = 0.4; sm.baseAlpha = 0.5;
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
    const fp = gfx.fireP.spawn(ex, ey, ez, 1, 0.55 + Math.random() * 0.25, 0.14);
    fp.gy = b.gy;
    fp.vx = (Math.random() - 0.5) * 5; fp.vy = 10 + Math.random() * 18; fp.vz = (Math.random() - 0.5) * 5;
    fp.life = 0.4 + Math.random() * 0.5; fp.size = 7 + Math.random() * 10; fp.baseAlpha = 0.9;
    if (Math.random() < 0.5) {
      const sm = gfx.smokeP.spawn(b.x + (Math.random() - 0.5) * b.sx * 0.5, b.gy + b.h + 3,
        b.z + (Math.random() - 0.5) * b.sz * 0.5, 0.16, 0.15, 0.15);
      sm.gy = b.gy;
      sm.vx = (Math.random() - 0.5) * 4; sm.vy = 14 + Math.random() * 16; sm.vz = (Math.random() - 0.5) * 4;
      sm.life = 2.5 + Math.random() * 2.5; sm.size = 12 + Math.random() * 16;
      sm.growth = 2.6; sm.drag = 0.2; sm.fadeIn = 0.3; sm.baseAlpha = 0.6;
    }
  }
}
