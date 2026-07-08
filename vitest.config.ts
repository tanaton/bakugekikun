import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // 街の生成は1シード数秒かかる。ワーカーが混み合ったときの誤タイムアウトを避ける
    testTimeout: 30000,
  },
});
