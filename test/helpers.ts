// テスト共通ヘルパー

import { rngFor } from '../src/core/rng';
import { generateFeatures, Terrain } from '../src/core/terrain';

// 本体(cityGen)と同じストリーム割り当てで地形だけを生成する
export const mkTerrain = (seed: string): Terrain =>
  new Terrain(generateFeatures(rngFor(seed, 'features')), rngFor(seed, 'terrain'));
