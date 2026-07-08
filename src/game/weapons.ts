// 武器ごとの飛翔パラメータとマーカー色(不変の定義。マーカーの実体はmissiles.tsが管理)

export interface Weapon {
  id: 'single' | 'cluster' | 'nuke';
  label: string;
  speed: number;
  scale: number;
  markerColor: number;
}

export const WEAPONS: readonly Weapon[] = [
  { id: 'single',  label: '弾種: 単弾頭ミサイル', speed: 620, scale: 1, markerColor: 0xff5533 },
  { id: 'cluster', label: '弾種: クラスター弾',   speed: 620, scale: 1, markerColor: 0xff5533 },
  { id: 'nuke',    label: '弾種: 戦術核 ☢',      speed: 440, scale: 2, markerColor: 0xff2200 },
];
