// 起動配線: gfx初期化 → World生成 → UI配線 → メインループ

import './render/colorMode';   // 必ず最初(モジュール初期化時のColor構築より先)
import './style.css';
import { startLoop } from './game/loop';
import { prewarmShaders, requestStrike } from './game/missiles';
import { WEAPONS } from './game/weapons';
import { applyTime, createWorld, regenerate } from './game/world';
import { applyShadowMode, createGfx, resizeGfx, type ShadowMode } from './render/gfx';
import { isSoundOn, toggleSound } from './ui/audio';
import {
  $, setPlanName, setShadowLabel, setSoundLabel, setTimeLabel, setWeaponLabel, updateHUD,
} from './ui/hud';
import { createInput } from './ui/input';
import { wireJoystick } from './ui/joystick';
import { wireProfilerKey } from './ui/profiler';

const canvas = $('gl') as HTMLCanvasElement;
const seedInput = $('seed') as HTMLInputElement;

const gfx = createGfx(canvas);
addEventListener('resize', () => resizeGfx(gfx));
resizeGfx(gfx);

const world = createWorld(gfx, seedInput.value || 'DEFAULT');
const input = createInput(canvas, (px, py) => requestStrike(world, px, py));
wireJoystick(input);

// タッチ端末の判定はここで一度だけ行い、CSS側の表示切り替えは.touchクラスにぶら下げる
// (JSとCSSで判定基準が食い違わないようにする)
const isTouch = matchMedia('(pointer: coarse)').matches;
document.documentElement.classList.toggle('touch', isTouch);
// 中央ヒントの文言もボタンラベル同様、二重管理を避けてJS側から入れる
$('hint').textContent = isTouch
  ? 'タップ=爆撃 / ドラッグ=視点 / ピンチ=ズーム'
  : '右クリックで爆撃地点を指定せよ';

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
// 影品質はUIとgfxだけの関心事(simは読まない)なのでSettingsに持たずここで所有する。
// 起動時にも一度applyして、createGfxの初期状態(影ON・高解像度)とラベルの一致を保証する
let shadowMode: ShadowMode = 'high';
applyShadowMode(gfx, shadowMode);
$('shadowBtn').addEventListener('click', () => {
  const order: ShadowMode[] = ['high', 'low', 'off'];
  shadowMode = order[(order.indexOf(shadowMode) + 1) % order.length];
  applyShadowMode(gfx, shadowMode);
  setShadowLabel(shadowMode);
});
$('weaponBtn').addEventListener('click', () => {
  world.settings.weaponIdx = (world.settings.weaponIdx + 1) % WEAPONS.length;
  const w = WEAPONS[world.settings.weaponIdx];
  setWeaponLabel(w.label, w.hot);
});
$('soundBtn').addEventListener('click', () => {
  setSoundLabel(toggleSound());
});
$('moreBtn').addEventListener('click', () => $('cmd').classList.toggle('open'));
wireProfilerKey();

// ボタンの初期ラベルはJS側の状態定義から入れる(HTMLとの文言二重管理を避ける)
setTimeLabel(world.settings.timeMode);
setShadowLabel(shadowMode);
setSoundLabel(isSoundOn());
const w0 = WEAPONS[world.settings.weaponIdx];
setWeaponLabel(w0.label, w0.hot);
setPlanName(world.city.plan);
updateHUD(world.sim.stats);

prewarmShaders(gfx);   // 初回爆撃時のシェーダーコンパイルヒッチを起動時に済ませる
startLoop(world, input);
