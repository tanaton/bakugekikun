// 影の2枚マップ化: threeのシェーダーチャンクをパッチして、平行光源の影が
// 精細マップ(カメラ追従の sun)の範囲外に出たら、街全体をカバーする粗い
// 全域マップ(SunShadow.sunFar)へフォールバックするようにする。
// これでズームで精細マップの範囲が狭まっても遠景の影が消えない。
// colorMode 同様、モジュール読み込み時のグローバルパッチ。マテリアル個別の
// onBeforeCompile と違い、影を受ける全マテリアルに一括で効く。

import * as THREE from 'three';

// lights_fragment_begin 内の平行光源へ影を掛ける行(three r185 の原文)。
// three の更新で原文が変わると replace が空振りするため、見つからなければ throw で気付く
export const DIR_LINE = 'directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;';

// 精細マップのUV範囲内はそれを使い、縁でフェードしながら全域マップへ切り替える。
// 平行光源の影が2枚(0=精細な太陽、1=全域用の intensity 0 ライト)のときだけ定義される
const DUAL_FN = /* glsl */`
#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS == 2
float bkDualShadow( vec4 nearCoord, vec4 farCoord ) {
	DirectionalLightShadow sN = directionalLightShadows[ 0 ];
	DirectionalLightShadow sF = directionalLightShadows[ 1 ];
	vec2 uv = nearCoord.xy / nearCoord.w;
	vec2 edge = min( uv, 1.0 - uv );
	float wN = smoothstep( 0.0, 0.04, min( edge.x, edge.y ) );   // 1=精細マップの内側
	float s = 1.0;
	if ( wN < 1.0 ) s = getShadow( directionalShadowMap[ 1 ], sF.shadowMapSize, sF.shadowIntensity, sF.shadowBias, sF.shadowRadius, farCoord );
	if ( wN > 0.0 ) s = mix( s, getShadow( directionalShadowMap[ 0 ], sN.shadowMapSize, sN.shadowIntensity, sN.shadowBias, sN.shadowRadius, nearCoord ), wN );
	return s;
}
#endif
`;

// 2枚構成のときは0番(精細)のループ回でbkDualShadowを使う。1番(全域用ライト)は
// 照明に寄与しない(intensity 0)ので、そのループ回の影サンプリングは丸ごと省く
const DUAL_LINE = `
#if NUM_DIR_LIGHT_SHADOWS == 2
		#if UNROLLED_LOOP_INDEX == 0
		directLight.color *= ( directLight.visible && receiveShadow ) ? bkDualShadow( vDirectionalShadowCoord[ 0 ], vDirectionalShadowCoord[ 1 ] ) : 1.0;
		#endif
#else
		${DIR_LINE}
#endif
`;

if (!THREE.ShaderChunk.shadowmap_pars_fragment.includes('bkDualShadow')) {   // 二重パッチ防止
  if (!THREE.ShaderChunk.lights_fragment_begin.includes(DIR_LINE)) {
    throw new Error('dualShadow: lights_fragment_beginに想定行がない(threeの更新でシェーダー原文が変わった)');
  }
  THREE.ShaderChunk.lights_fragment_begin =
    THREE.ShaderChunk.lights_fragment_begin.replace(DIR_LINE, DUAL_LINE);
  THREE.ShaderChunk.shadowmap_pars_fragment += DUAL_FN;
}
