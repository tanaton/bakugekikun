# 爆撃くん

3D都市爆撃ゲーム。Three.js込みの単一HTML(`bakugekikun.html`)が配布物で、ブラウザで直接開いて動く。

## ビルド

`src/` か `vendor/` を編集したら結合し直す(単純な連結):

```
cat src/hud.html vendor/three.min.js src/game.html > bakugekikun.html
```

PowerShellなら `./build.ps1`。

## 構成

- `src/hud.html` — CSS + HUDのDOM。`<script>` 開始タグで終わる
- `src/game.html` — ゲーム本体のJS。`</script>` で始まる(hud側のタグを閉じる)
- `vendor/three.min.js` — Three.js r185。npm `three@0.185.0` を esbuild でIIFE化したもの(`npx esbuild entry.js --bundle --minify --format=iife --global-name=THREE`、entry.js は `export * from 'three';`)。編集しない
- `bakugekikun.html` — ビルド生成物。直接編集しない

## 約束事

- 街の生成は必ずシード付き乱数 `rng()` を使う(同じシードで同じ街を再現するため)。
  爆発などのゲームプレイ演出は `Math.random()` でよい
- アーティファクトを用いて確認する
- 大量オブジェクト(建物・木・車・瓦礫)はすべて InstancedMesh。個別Meshを増やさない
- ライトを実行時にシーンへadd/removeしない(ライト数が変わると全マテリアルのシェーダー再コンパイルが走り100ms級のスパイクになる)。ライトは起動時に常設プールを作り intensity だけ動かす(`boomLights`/`nukeLights` 方式)
- 外部CDN読み込みは不可(配布先のCSP制約)。依存はファイルに埋め込む
