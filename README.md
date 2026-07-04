# 爆撃くん — GOD'S EYE STRIKE

神の視点で5km四方の3D都市をミサイル爆撃するブラウザゲーム。
`bakugekikun.html` をブラウザで開くだけで動く自己完結の単一HTMLファイル。

## 遊び方

| 操作 | 内容 |
| --- | --- |
| W A S D | 移動(Shiftで高速) |
| 左ドラッグ | 視点回転 |
| ホイール | ズーム |
| 右クリック | 爆撃地点を指定 |

- **シード**: 同じシードなら道路・ビル・地形の起伏まで同じ街が再現される
- **時間帯**: 昼 / 夕暮れを切り替え(窓明かり・爆発光は夕暮れが映える)
- **弾種**: 単弾頭ミサイル / クラスター弾(上空で7〜9発に分裂) / 戦術核 ☢(全壊半径420m・キノコ雲)
- 高層ビルは爆風と反対側へ倒れ込み、倒れた先を巻き添えにする
- 爆風外縁のビルは炎上し、時間差で崩壊する
- 右上パネルに破壊建物数・破壊車両数・被害総額を表示

## ファイル構成

```
src/hud.html       HUD(CSS + DOM)と <script> 開始タグまで
vendor/three.min.js  Three.js r147(UMDビルド)
src/game.html      ゲーム本体のJS(地形・街生成・破壊・エフェクト)
bakugekikun.html   上記3つを結合した配布物(ビルド生成物)
```

## ビルド

`src/` か `vendor/` を編集したら結合し直す:

```powershell
./build.ps1
```

(実体は3ファイルの単純な連結。bash なら `cat src/hud.html vendor/three.min.js src/game.html > bakugekikun.html`)
