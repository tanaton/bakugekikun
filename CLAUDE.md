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
- `vendor/three.min.js` — Three.js r147 UMD。編集しない
- `bakugekikun.html` — ビルド生成物。直接編集しない

## 約束事

- 街の生成は必ずシード付き乱数 `rng()` を使う(同じシードで同じ街を再現するため)。
  爆発などのゲームプレイ演出は `Math.random()` でよい
- アーティファクトを用いて確認する
- 大量オブジェクト(建物・木・車・瓦礫)はすべて InstancedMesh。個別Meshを増やさない
- 外部CDN読み込みは不可(配布先のCSP制約)。依存はファイルに埋め込む
