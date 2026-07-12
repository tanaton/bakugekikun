import { describe, expect, it } from 'vitest';
import { GROUND_WORLD } from '../src/core/config';
import { focusToMapPx, MAP_CANVAS_SIZE } from '../src/ui/map';

describe('focusToMapPx(ワールド→マップcanvas座標)', () => {
  it('原点はマップ中央、世界の縁はマップの縁に写る', () => {
    const size = MAP_CANVAS_SIZE;
    expect(focusToMapPx(0, 0, size)).toEqual({ px: size / 2, py: size / 2 });
    const h = GROUND_WORLD / 2;
    expect(focusToMapPx(-h, -h, size)).toEqual({ px: 0, py: 0 });
    expect(focusToMapPx(h, h, size)).toEqual({ px: size, py: size });
  });

  it('線形に写る(中点は中点へ)', () => {
    const size = 512;
    const a = focusToMapPx(1000, -600, size);
    const b = focusToMapPx(2000, -1200, size);
    const m = focusToMapPx(1500, -900, size);
    expect(m.px).toBeCloseTo((a.px + b.px) / 2, 10);
    expect(m.py).toBeCloseTo((a.py + b.py) / 2, 10);
  });
});
