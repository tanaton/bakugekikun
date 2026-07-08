import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// src/core は純粋層: three.js にも DOM にも依存してはならない。
// 層の腐敗を機械的に検出する
const CORE_DIR = fileURLToPath(new URL('../src/core', import.meta.url));
const FORBIDDEN: [RegExp, string][] = [
  [/from\s+['"]three['"]/, "import from 'three'"],
  [/\bdocument\s*\./, 'document.*'],
  [/\bwindow\s*\./, 'window.*'],
  [/\bperformance\s*\./, 'performance.*'],
  [/\bnavigator\s*\./, 'navigator.*'],
  [/\brequestAnimationFrame\b/, 'requestAnimationFrame'],
  [/\bMath\.random\b/, 'Math.random(街の生成は必ずシード付きrng)'],
];

describe('core層の純粋性', () => {
  const files = readdirSync(CORE_DIR).filter(f => f.endsWith('.ts'));

  it('coreにファイルが存在する', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it.each(files)('%s がthree/DOM/Math.randomに依存しない', file => {
    // コメントは検査対象外(仕様の説明でMath.random等に言及してよい)
    const src = readFileSync(join(CORE_DIR, file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    for (const [re, label] of FORBIDDEN) {
      expect(src, `${file} に ${label} が含まれている`).not.toMatch(re);
    }
  });

  it('coreはcore外のモジュールをimportしない', () => {
    for (const file of files) {
      const src = readFileSync(join(CORE_DIR, file), 'utf8');
      const imports = [...src.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(m => m[1]);
      for (const imp of imports) {
        expect(imp, `${file} が ${imp} をimportしている`).toMatch(/^\.\//);
      }
    }
  });
});
