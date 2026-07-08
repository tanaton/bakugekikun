// 起動配線: gfx初期化 → World生成 → UI配線 → メインループ

import './render/colorMode';   // 必ず最初(モジュール初期化時のColor構築より先)
import './style.css';
import { startLoop } from './game/loop';
import { requestStrike } from './game/missiles';
import { WEAPONS } from './game/weapons';
import { applyTime, createWorld, regenerate } from './game/world';
import { createGfx, resizeGfx, setShadowsEnabled } from './render/gfx';
import { isSoundOn, toggleSound } from './ui/audio';
import {
  $, setPlanName, setShadowLabel, setSoundLabel, setTimeLabel, setWeaponLabel, updateHUD,
} from './ui/hud';
import { createInput } from './ui/input';
import { wireProfilerKey } from './ui/profiler';

const canvas = $('gl') as HTMLCanvasElement;
const seedInput = $('seed') as HTMLInputElement;

const gfx = createGfx(canvas);
addEventListener('resize', () => resizeGfx(gfx));
resizeGfx(gfx);

const world = createWorld(gfx, seedInput.value || 'DEFAULT');
const input = createInput(canvas, (px, py) => requestStrike(world, px, py));

// --- UI配線 ---
function regen(seed: string): void {
  regenerate(world, seed);
  setPlanName(world.city.plan);
  updateHUD(world.sim.stats);
}
$('regen').addEventListener('click', () => regen(seedInput.value || 'DEFAULT'));
$('rand').addEventListener('click', () => {
  const s = 'CITY-' + Math.floor(Math.random() * 99999).toString().padStart(5, '0');
  seedInput.value = s;
  regen(s);
});
seedInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') regen(seedInput.value || 'DEFAULT');
});
$('timeBtn').addEventListener('click', () => {
  const mode = world.settings.timeMode === 'day' ? 'dusk' : 'day';
  applyTime(world, mode);
  setTimeLabel(mode);
});
$('shadowBtn').addEventListener('click', () => {
  setShadowsEnabled(gfx, !gfx.renderer.shadowMap.enabled);
  setShadowLabel(gfx.renderer.shadowMap.enabled);
});
$('weaponBtn').addEventListener('click', () => {
  world.settings.weaponIdx = (world.settings.weaponIdx + 1) % WEAPONS.length;
  const w = WEAPONS[world.settings.weaponIdx];
  setWeaponLabel(w.label, w.id === 'nuke');
});
$('soundBtn').addEventListener('click', () => {
  setSoundLabel(toggleSound());
});
wireProfilerKey();

// ボタンの初期ラベルはJS側の状態定義から入れる(HTMLとの文言二重管理を避ける)
setTimeLabel(world.settings.timeMode);
setShadowLabel(gfx.renderer.shadowMap.enabled);
setSoundLabel(isSoundOn());
const w0 = WEAPONS[world.settings.weaponIdx];
setWeaponLabel(w0.label, w0.id === 'nuke');
setPlanName(world.city.plan);
updateHUD(world.sim.stats);

startLoop(world, input);
