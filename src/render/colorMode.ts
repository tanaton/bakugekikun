// r147当時の配色を維持するためカラーマネジメントは無効(hex値をそのまま使う旧パイプライン)。
// モジュール初期化時に new THREE.Color(hex) するコードより先に実行される必要があるため、
// main.ts の最初のimportにしている(遅れるとその色だけsRGB→リニア変換がかかり暗くなる)

import * as THREE from 'three';

THREE.ColorManagement.enabled = false;
