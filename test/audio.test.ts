// 効果音のWebAudio呼び出し順の検証。実ブラウザのAudioNodeは「start前のstop」で
// InvalidStateErrorを投げ、rAFループ内なら画面が完全停止する(playAlarmで実際に起きた)。
// 実装と同じ不変条件を強制するフェイクAudioContextで全効果音を鳴らして回帰を防ぐ

import { describe, expect, it } from 'vitest';

/* eslint-disable @typescript-eslint/no-explicit-any */
const param = (): any => ({
  value: 0,
  setValueAtTime() { /* noop */ },
  exponentialRampToValueAtTime() { /* noop */ },
});

class FakeSource {
  started = false;
  stopped = false;
  buffer: unknown = null;
  type = '';
  frequency = param();
  Q = param();
  gain = param();
  connect(n: any): any { return n; }
  start(): void {
    if (this.started) throw new Error('InvalidStateError: 二重start');
    this.started = true;
  }
  stop(): void {
    // 実ブラウザと同じ: start前のstopはInvalidStateError
    if (!this.started) throw new Error('InvalidStateError: start前にstopが呼ばれた');
    this.stopped = true;
  }
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  sampleRate = 100;   // ノイズバッファを小さく保つ
  currentTime = 0;
  state = 'running';
  destination = {};
  sources: FakeSource[] = [];
  constructor() { FakeAudioContext.instances.push(this); }
  private mk(): FakeSource {
    const s = new FakeSource();
    this.sources.push(s);
    return s;
  }
  createOscillator(): FakeSource { return this.mk(); }
  createBufferSource(): FakeSource { return this.mk(); }
  createGain(): any { return { gain: param(), connect: (n: any) => n }; }
  createBiquadFilter(): FakeSource { return new FakeSource(); }   // フィルタはstart対象外
  createBuffer(_ch: number, len: number): any {
    return { getChannelData: () => new Float32Array(len) };
  }
  resume(): Promise<void> { return Promise.resolve(); }
}

(globalThis as any).window = { AudioContext: FakeAudioContext };
/* eslint-enable @typescript-eslint/no-explicit-any */

const { initAudio, playAlarm, playBoom, playNuke, playPop, playWhoosh } =
  await import('../src/ui/audio');

describe('効果音のWebAudio呼び出し順', () => {
  it('全効果音がstart前のstopなしで再生でき、鳴らしたノードは必ずstartされる', () => {
    initAudio();
    const ctx = FakeAudioContext.instances[0];
    expect(ctx).toBeDefined();

    playAlarm(false);                     // 通常サイレン(逃走モードの最初の警報)
    ctx.currentTime += 2;                 // スロットル(1.2s)を越えて核警報も鳴らす
    playAlarm(true);
    playBoom(300);
    playNuke(500);
    playPop();
    playWhoosh();

    expect(ctx.sources.length).toBeGreaterThan(0);
    // オシレーター/バッファソースはすべてstart済み(startなしのノードは無音でリークする)
    for (const s of ctx.sources) expect(s.started).toBe(true);
  });

  it('警報はスロットルされる(短時間の連続予告で鳴りっぱなしにならない)', () => {
    const ctx = FakeAudioContext.instances[0];
    ctx.currentTime += 10;   // 前テストの警報からスロットルを抜ける
    const before = ctx.sources.length;
    playAlarm(false);
    playAlarm(false);   // 1.2秒以内の2回目は無音
    expect(ctx.sources.length).toBe(before + 1);
  });
});
