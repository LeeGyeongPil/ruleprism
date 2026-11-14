// AC-10: 정적 HTML 미리보기(같은 코어, 서버·스크립트 없음, 두 언어).
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { CHILD_TIMEOUT_MS, REPO, tempDir } from './helpers';

const out = tempDir('preview');
afterAll(() => fs.rmSync(out, { recursive: true, force: true }));

describe('static preview', () => {
  const r = spawnSync(process.execPath, [path.join(REPO, 'out/preview/render.js'), '--out', out], { encoding: 'utf8', timeout: CHILD_TIMEOUT_MS });

  it('writes sidebar.en.html and sidebar.ko.html', () => {
    expect(r.status).toBe(0);
    expect(fs.existsSync(path.join(out, 'sidebar.en.html'))).toBe(true);
    expect(fs.existsSync(path.join(out, 'sidebar.ko.html'))).toBe(true);
  });

  for (const [lang, sidebar, problems, caption] of [
    ['en', 'Rules for this file', 'Problems', 'not a VS Code screenshot'],
    ['ko', '이 파일에 붙는 규칙', '문제', 'VS Code 화면이 아닙니다'],
  ] as const) {
    it(`${lang}: 5 agent sections, diagnostics list, own language, no servers or scripts`, () => {
      const html = fs.readFileSync(path.join(out, `sidebar.${lang}.html`), 'utf8');
      expect(html).toContain(`<html lang="${lang}">`);
      const agents = [...html.matchAll(/data-agent="(\w+)"/g)].map((m) => m[1]);
      expect(agents).toEqual(['claude', 'copilot', 'cursor', 'codex', 'gemini']);
      expect(html).toContain(sidebar);
      expect(html).toContain(problems);
      expect(html).toContain(caption);
      for (const code of ['RP001', 'RP002', 'RP003', 'RP004', 'RP005', 'RP006', 'RP007', 'RP008', 'RP009']) expect(html).toContain(code);
      expect(html).not.toMatch(/https?:\/\//);
      expect(html).not.toContain('localhost');
      expect(html).not.toMatch(/<script|<link|<img|@import/i);
    });
  }

  it('the Korean page uses Korean reasons, the English page English ones', () => {
    const en = fs.readFileSync(path.join(out, 'sidebar.en.html'), 'utf8');
    const ko = fs.readFileSync(path.join(out, 'sidebar.ko.html'), 'utf8');
    expect(en).toContain('Rules: C7');
    expect(ko).toContain('규칙: C7');
    expect(ko).toContain('시작 시: 작업 폴더 또는 그 위 폴더');
    expect(en).not.toContain('시작 시');
  });

  it('npm run preview is wired to the same renderer and docs/preview', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
    expect(pkg.scripts.preview).toContain('out/preview/render.js');
  });
});
