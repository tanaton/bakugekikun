// キー入力の押しっぱなし対策の単体テスト。
// keyupは「必ず届く」保証がない(IME変換・フォーカス喪失・タブ切替で飲み込まれる)ため、
// createInputの各解除経路がキー状態を確実に落とすことを検証する

import { describe, expect, it } from 'vitest';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Handler = (e: any) => void;
const handlers = new Map<string, Handler[]>();
const on = (type: string, fn: Handler): void => {
  if (!handlers.has(type)) handlers.set(type, []);
  handlers.get(type)!.push(fn);
};
const fire = (type: string, e: any = {}): void => {
  for (const fn of handlers.get(type) ?? []) fn(e);
};

(globalThis as any).addEventListener = on;
(globalThis as any).document = { addEventListener: on, hidden: false };

const canvasStub: any = {
  addEventListener() { /* ポインタ系はこのテストでは使わない */ },
  setPointerCapture() { /* noop */ },
};
/* eslint-enable @typescript-eslint/no-explicit-any */

const { createInput } = await import('../src/ui/input');

const key = (code: string, extra: object = {}): object =>
  ({ code, keyCode: 0, isComposing: false, target: { tagName: 'CANVAS' }, ...extra });

describe('キー押しっぱなし対策', () => {
  const input = createInput(canvasStub, () => { /* noop */ });

  it('通常のkeydown/keyupで押下状態が入り切りする', () => {
    fire('keydown', key('KeyW'));
    expect(input.keys.KeyW).toBe(true);
    fire('keyup', key('KeyW'));
    expect(input.keys.KeyW).toBe(false);
  });

  it('IME変換扱いのkeydown(keyCode 229)はキーを立てず、押下中の全キーを解除する', () => {
    fire('keydown', key('KeyW'));
    fire('keydown', key('ShiftLeft'));
    fire('keydown', key('KeyA', { keyCode: 229 }));   // IMEが横取りした打鍵
    expect(input.keys.KeyW).toBe(false);
    expect(input.keys.ShiftLeft).toBe(false);
    expect(input.keys.KeyA).toBeFalsy();
  });

  it('isComposing中のkeydownも同様に全解除する', () => {
    fire('keydown', key('KeyD'));
    fire('keydown', key('KeyS', { isComposing: true }));
    expect(input.keys.KeyD).toBe(false);
    expect(input.keys.KeyS).toBeFalsy();
  });

  it('blurで全キー解除(フォーカス喪失中のkeyupは届かない)', () => {
    fire('keydown', key('KeyW'));
    fire('keydown', key('ArrowUp'));
    fire('blur');
    expect(input.keys.KeyW).toBe(false);
    expect(input.keys.ArrowUp).toBe(false);
  });

  it('タブ非表示(visibilitychange)で全キー解除', () => {
    fire('keydown', key('KeyW'));
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    (globalThis as any).document.hidden = true;
    fire('visibilitychange');
    expect(input.keys.KeyW).toBe(false);
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    (globalThis as any).document.hidden = false;
  });

  it('シード入力欄でのタイプは移動キーにならない', () => {
    fire('keydown', key('KeyW', { target: { tagName: 'INPUT' } }));
    expect(input.keys.KeyW).toBeFalsy();
  });
});
