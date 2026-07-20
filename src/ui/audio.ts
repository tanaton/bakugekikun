// サウンド(WebAudioで手続き合成)

let actx: AudioContext | null = null;
let soundOn = true;

export const isSoundOn = (): boolean => soundOn;
export function toggleSound(): boolean {
  soundOn = !soundOn;
  initAudio();
  return soundOn;
}

export function initAudio(): void {
  if (!actx) {
    try {
      const Ctor = window.AudioContext
        ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctor) actx = new Ctor();
    } catch { /* 音は必須ではない */ }
  }
  // iOSは非標準の'interrupted'状態にもなるため、running以外は一律resumeを試みる
  if (actx && actx.state !== 'running' && actx.state !== 'closed') {
    actx.resume().catch(() => { /* ジェスチャー外だと拒否されるが次の機会に再試行される */ });
  }
}

// 減衰つきノイズバースト → ローパス(f0→f1) → ゲイン減衰(全爆発音の基本要素)
function noiseBurst(t: number, start: number, dur: number, f0: number, f1: number,
    g0: number, decayPow: number): void {
  const ctx = actx!;
  const len = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decayPow);
  const src = ctx.createBufferSource(); src.buffer = buf;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
  lp.frequency.setValueAtTime(f0, t + start);
  lp.frequency.exponentialRampToValueAtTime(f1, t + start + dur * 0.9);
  const gn = ctx.createGain(); gn.gain.setValueAtTime(g0, t + start);
  gn.gain.exponentialRampToValueAtTime(0.001, t + start + dur);
  src.connect(lp).connect(gn).connect(ctx.destination);
  src.start(t + start);
}

// 低音のドン(サイン波のピッチと音量を落としていく)
function subBass(t: number, f0: number, f1: number, fDur: number, g0: number, gDur: number): void {
  const ctx = actx!;
  const osc = ctx.createOscillator(); osc.type = 'sine';
  osc.frequency.setValueAtTime(f0, t);
  osc.frequency.exponentialRampToValueAtTime(f1, t + fDur);
  const og = ctx.createGain(); og.gain.setValueAtTime(g0, t);
  og.gain.exponentialRampToValueAtTime(0.001, t + gDur);
  osc.connect(og).connect(ctx.destination); osc.start(t); osc.stop(t + gDur + 0.05);
}

export function playBoom(dist: number): void {
  if (!actx || !soundOn) return;
  const vol = Math.min(0.55, 220 / Math.max(150, dist));
  const t = actx.currentTime;
  noiseBurst(t, 0, 1.6, 900, 70, vol, 2.2);
  subBass(t, 72, 26, 0.9, vol * 1.2, 1);
}

export function playNuke(dist: number): void {
  if (!actx || !soundOn) return;
  const vol = Math.min(0.85, 2000 / Math.max(300, dist));
  const t = actx.currentTime;
  noiseBurst(t, 0, 0.25, 6000, 1200, vol * 0.7, 1.5);   // 鋭いクラック
  noiseBurst(t, 0.02, 4.5, 550, 40, vol, 2.0);          // 主爆音
  noiseBurst(t, 1.1, 3.5, 220, 50, vol * 0.45, 1.5);    // 遅れてくる残響
  subBass(t, 52, 14, 3.2, vol * 1.5, 3.4);              // 地鳴り
}

export function playPop(): void {
  if (!actx || !soundOn) return;
  noiseBurst(actx.currentTime, 0, 0.5, 1400, 1400, 0.16, 3);
}

// 爆撃警報サイレン(逃走モード)。連続予告で鳴りっぱなしにならないようスロットルする
let lastAlarmT = -10;
export function playAlarm(nuke: boolean): void {
  if (!actx || !soundOn) return;
  const t = actx.currentTime;
  if (t - lastAlarmT < 1.2) return;
  lastAlarmT = t;
  const osc = actx.createOscillator();
  const gn = actx.createGain();
  if (nuke) {
    // 核: 低く長いうなり
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(220, t);
    osc.frequency.exponentialRampToValueAtTime(150, t + 1.8);
    gn.gain.setValueAtTime(0.0001, t);
    gn.gain.exponentialRampToValueAtTime(0.09, t + 0.1);
    gn.gain.exponentialRampToValueAtTime(0.001, t + 2.0);
  } else {
    // 通常: 2トーンの短いサイレン
    osc.type = 'square';
    for (let i = 0; i < 6; i++) osc.frequency.setValueAtTime(i % 2 ? 900 : 640, t + i * 0.13);
    gn.gain.setValueAtTime(0.0001, t);
    gn.gain.exponentialRampToValueAtTime(0.05, t + 0.04);
    gn.gain.setValueAtTime(0.05, t + 0.65);
    gn.gain.exponentialRampToValueAtTime(0.001, t + 0.85);
  }
  osc.connect(gn).connect(actx.destination);
  // stopはstartの後に呼ぶこと(先に呼ぶとInvalidStateErrorでrAFループごと死ぬ)
  osc.start(t);
  osc.stop(t + (nuke ? 2.05 : 0.9));
}

export function playWhoosh(): void {
  if (!actx || !soundOn) return;
  const t = actx.currentTime;
  const len = actx.sampleRate * 1.2;
  const buf = actx.createBuffer(1, len, actx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (i / len);
  const src = actx.createBufferSource(); src.buffer = buf;
  const bp = actx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.2;
  bp.frequency.setValueAtTime(400, t); bp.frequency.exponentialRampToValueAtTime(2400, t + 1.1);
  const gn = actx.createGain(); gn.gain.setValueAtTime(0.0001, t);
  gn.gain.exponentialRampToValueAtTime(0.12, t + 1.0);
  gn.gain.exponentialRampToValueAtTime(0.0001, t + 1.25);
  src.connect(bp).connect(gn).connect(actx.destination); src.start(t);
}
