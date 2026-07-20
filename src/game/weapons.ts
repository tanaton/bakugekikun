// 武器ごとの挙動定義(不変)。発射・分裂・着弾はこの定義を解釈するだけにして、
// 武器idの分岐や規模の定数をmissiles/explosions/mainに散らさない。
// マーカーの実体はmissiles.tsが管理

// クラスター弾の分裂パラメータ
export interface WeaponSplit {
  nMin: number; nMax: number;   // 子弾数の範囲
  rMin: number; rMax: number;   // 親目標からの散布半径(m)
  altitude: number;             // 分裂する対目標高度(m)
  boom: number;                 // 子弾の爆発半径
  speed: number;                // 子弾の速度
  scale: number;                // 子弾のメッシュ縮尺
}

export interface Weapon {
  id: 'single' | 'cluster' | 'nuke';
  label: string;
  speed: number;
  scale: number;
  markerColor: number;
  hot: boolean;                 // UIボタンを警告色にする危険武器
  boom: number | 'nuke';        // 着弾時の爆発(半径 or 戦術核)
  split?: WeaponSplit;          // クラスター弾: 上空で子弾に分裂
}

// 戦術核の全壊半径。爆発演出(detonateNuke)と逃走モードの警告円・被弾判定が共有する
export const NUKE_R = 420;

export const WEAPONS: readonly Weapon[] = [
  { id: 'single',  label: '弾種: 単弾頭ミサイル', speed: 620, scale: 1, markerColor: 0xff5533,
    hot: false, boom: 105 },
  { id: 'cluster', label: '弾種: クラスター弾',   speed: 620, scale: 1, markerColor: 0xff5533,
    hot: false, boom: 105,
    split: { nMin: 7, nMax: 9, rMin: 25, rMax: 175, altitude: 380, boom: 55, speed: 560, scale: 0.5 } },
  { id: 'nuke',    label: '弾種: 戦術核 ☢',      speed: 440, scale: 2, markerColor: 0xff2200,
    hot: true, boom: 'nuke' },
];
