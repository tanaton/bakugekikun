# src/ と vendor/ を結合して配布用の bakugekikun.html を生成する
$root = $PSScriptRoot
Get-Content -Raw "$root/src/hud.html", "$root/vendor/three.min.js", "$root/src/game.html" |
  Set-Content -NoNewline -Encoding utf8 "$root/bakugekikun.html"
Write-Host "built: bakugekikun.html ($((Get-Item "$root/bakugekikun.html").Length) bytes)"
