import { describe, expect, it } from 'vitest';
import { generateCityData } from '../src/core/cityGen';

const SEEDS = ['BAKUGEKI-01', 'CITY-00001', 'CITY-99999', 'radial?', 'organic?', 'grid?'];

describe('generateCityData 決定性', () => {
  it('同じシードで完全に同じ街になる', () => {
    for (const seed of SEEDS) {
      const a = generateCityData(seed);
      const b = generateCityData(seed);
      expect(a.plan).toBe(b.plan);
      expect(a.buildings).toEqual(b.buildings);
      expect(a.cars).toEqual(b.cars);
      expect(a.trees).toEqual(b.trees);
      expect(a.roadPaths).toEqual(b.roadPaths);
      expect(a.groundPolys).toEqual(b.groundPolys);
      expect(a.alleyPaths).toEqual(b.alleyPaths);
      expect(a.lotDecals).toEqual(b.lotDecals);
    }
  });

  it('違うシードで違う街になる', () => {
    const a = generateCityData('SEED-A');
    const b = generateCityData('SEED-B');
    expect(a.buildings).not.toEqual(b.buildings);
  });
});
