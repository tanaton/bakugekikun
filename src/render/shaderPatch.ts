// threeのシェーダー原文を置換するパッチ群の共通の約束:
// threeの更新で原文が変わるとreplaceが空振りして静かに壊れるため、
// 置換対象が見つからなければthrowで気付く(water/cityMeshes/dualShadowで共用)

export function replaceOrThrow(source: string, needle: string, replacement: string, tag: string): string {
  if (!source.includes(needle)) {
    throw new Error(`${tag}: 想定行がない(threeの更新でシェーダー原文が変わった)`);
  }
  return source.replace(needle, replacement);
}
