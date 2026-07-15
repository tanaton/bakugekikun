# 爆撃くん

3D都市爆撃ゲーム。TypeScript + Three.js(npm, r185) + Vite。
配布物はJS/CSS全部埋め込みの単一HTML(`docs/index.html`、GitHub Pages公開用)で、ブラウザで直接開いて動く。

## コマンド

```
npm run dev     # 開発サーバー
npm run build   # tsc --noEmit + vite build → docs/index.html(GitHub Pages公開用)
npm test        # Vitest(node環境)
```

## 約束事

- 街の生成は必ずシード付き乱数ストリーム `rngFor(seed, stream)` を使う。爆発などのゲームプレイ演出は `Math.random()` でよい
- 大量オブジェクト(建物・木・車・瓦礫)はすべて InstancedMesh。個別Meshを増やさない
- ロジック確認はnode+スタブのテストで実施する。ヘッドレスブラウザは使わない
- ユーザーはアーティファクトで動作確認する(PCとスマホ)
