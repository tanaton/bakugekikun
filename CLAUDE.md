# 爆撃くん

3D都市爆撃ゲーム。TypeScript + Three.js(npm, r185) + Vite。
配布物はJS/CSS全部埋め込みの単一HTML(`bakugekikun.html`)で、ブラウザで直接開いて動く。

## コマンド

```
npm run dev     # 開発サーバー
npm run build   # tsc --noEmit + vite build + dist/index.html → bakugekikun.html
npm test        # Vitest(node環境)
```

## 構成(層と依存方向)

- `src/core/` — **純粋層**。three/DOM/Math.random のimport・使用禁止(`test/purity.test.ts` が機械検査)。
  シード付き街生成の全ロジック(rng・地形・都市プラン・ロット・車/木の配置)と汎用データ構造(SlotPool/SpatialHash)
- `src/render/` — Three.js依存。シーン初期化(gfx)・InstancedMesh構築(cityMeshes)・地面/水面テクスチャ・
  パーティクル/ライト/FXの常設プール
- `src/game/` — 毎フレームのゲームプレイ。`World`(world.ts)が状態の束: `gfx`(常設)/`city`+`index`+`view`(再生成で差し替え)/`sim`(リセット)
- `src/ui/` — HUD・入力・WebAudio・プロファイラ
- `test/` — 決定性・不変条件・ダイジェスト・node+スタブの統合スモーク(game.smoke.test.ts)

## 約束事

- 街の生成は必ずシード付き乱数を使う。`rngFor(seed, stream)` のサブシステム別ストリーム
  ('features'/'terrain'/'plan'/'lots'/'cars'/'trees'/'facadeTex'/'groundNoise')を守る。
  ストリーム内のrng呼び出し順を変えると既存シードの街が変わる → `cityGen.digest.test.ts` が検出する。
  意図的な変更のときだけ `npx vitest -u` でスナップショットを更新し、コミットメッセージに明記する。
  爆発などのゲームプレイ演出は `Math.random()` でよい
- `src/core` は three/DOM に依存させない(依存が要るならrender/game側に置く)
- 大量オブジェクト(建物・木・車・瓦礫)はすべて InstancedMesh。個別Meshを増やさない
- ライトを実行時にシーンへadd/removeしない(ライト数が変わると全マテリアルのシェーダー再コンパイルが走り
  100ms級のスパイクになる)。ライトは起動時に常設プールを作り intensity だけ動かす(`render/lightPool.ts`)
- 外部CDN読み込みは不可(配布先のCSP制約)。依存はすべてバンドルへ埋め込む(vite-plugin-singlefile)
- 検証: ロジックはnode+スタブのテストで(ヘッドレスブラウザは使わない)、見た目はアーティファクトで確認する
- `bakugekikun.html` と `dist/` はビルド生成物。直接編集しない
