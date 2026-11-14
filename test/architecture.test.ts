// AC-8(2): 계층 — src/core·src/view·src/cli(그리고 i18n·preview)는 vscode 를 import 하지 않는다.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO } from './helpers';

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...tsFiles(p));
    else if (e.name.endsWith('.ts')) out.push(p);
  }
  return out;
}

const VSCODE_IMPORT = /(from\s+['"]vscode['"])|(require\(\s*['"]vscode['"]\s*\))|(import\(\s*['"]vscode['"]\s*\))/;

describe('layering', () => {
  for (const layer of ['core', 'view', 'cli', 'i18n', 'preview']) {
    it(`src/${layer} does not import vscode`, () => {
      const files = tsFiles(path.join(REPO, 'src', layer));
      expect(files.length).toBeGreaterThan(0);
      for (const f of files) expect(VSCODE_IMPORT.test(fs.readFileSync(f, 'utf8')), path.relative(REPO, f)).toBe(false);
    });
  }

  it('only src/extension imports vscode', () => {
    const ext = fs.readFileSync(path.join(REPO, 'src/extension/extension.ts'), 'utf8');
    expect(VSCODE_IMPORT.test(ext)).toBe(true);
  });

  it('the manifest wires the extension entry point and the CLI bin to built files', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
    expect(pkg.main).toBe('./out/extension/extension.js');
    expect(pkg.bin.ruleprism).toBe('out/cli/main.js');
    expect(fs.existsSync(path.join(REPO, 'out/extension/extension.js'))).toBe(true);
    expect(fs.readFileSync(path.join(REPO, 'out/cli/main.js'), 'utf8').startsWith('#!/usr/bin/env node')).toBe(true);
    // engines.vscode 와 @types/vscode 선언 범위가 같아야 vsce 가 패키징한다.
    expect(pkg.devDependencies['@types/vscode']).toBe(pkg.engines.vscode);
  });
});
