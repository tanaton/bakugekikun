# 爆撃くん — GOD'S EYE STRIKE

神の視点で5km四方の3D都市をミサイル爆撃するブラウザゲーム。
`docs/index.html` をブラウザで開くだけで動く自己完結の単一HTMLファイル(GitHub Pages公開用)。

## 遊び方

| 操作 | 内容 |
| --- | --- |
| W A S D | 移動(Shiftで高速) |
| 左ドラッグ | 視点回転 |
| ホイール | ズーム |
| 右クリック | 爆撃地点を指定 |
| P | 処理時間プロファイラ |

- **シード**: 同じシードなら道路・ビル・地形の起伏まで同じ街が再現される
- **時間帯**: 昼 / 夕暮れを切り替え(窓明かり・爆発光は夕暮れが映える)
- **弾種**: 単弾頭ミサイル / クラスター弾(上空で7〜9発に分裂) / 戦術核 ☢(全壊半径420m・キノコ雲)
- 高層ビルは爆風と反対側へ倒れ込み、倒れた先を巻き添えにする
- 爆風外縁のビルは炎上し、時間差で崩壊する
- 右上パネルに破壊建物数・破壊車両数・被害総額を表示

## 開発

TypeScript 7 (RC) + Three.js (r185, npm) + Vite 8。Node.js 20.19以上(22.12+推奨)。

```
npm ci            # 依存のインストール
npm run dev       # 開発サーバー(HMR付き)
npm run build     # 型チェック + 単一HTMLビルド → docs/index.html
npm test          # 単体テスト(Vitest / node環境)
```

ビルドは `vite-plugin-singlefile` でJS/CSSをすべてインライン化し、
配布物 `docs/index.html` を直接生成する。外部CDNには依存しない。

## ファイル構成

```
index.html      HUDのDOM(ビルド時にJS/CSSがインライン化される)
src/main.ts     起動配線
src/core/       純粋層: シード付き街生成の全ロジック(three/DOM非依存・単体テスト対象)
src/render/     Three.js依存: シーン・InstancedMesh・テクスチャ・常設プール
src/game/       ゲームプレイ: World・ミサイル・爆発・破壊・車
src/ui/         HUD・入力・サウンド・プロファイラ
test/           決定性・不変条件・ダイジェスト凍結・統合スモーク
docs/index.html 配布物(ビルド生成物。直接編集しない)
```
