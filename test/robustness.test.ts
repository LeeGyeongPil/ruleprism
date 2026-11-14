// AC-4: 읽기 실패·깨진 앞머리가 있어도 예외 없이 결과를 낸다.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { computeDiagnostics } from '../src/core/diagnostics';
import { parseFrontMatter } from '../src/core/frontmatter';
import { diskReader, memoryReader } from '../src/core/fsreader';
import { resolveFile } from '../src/core/resolve';
import { scanWorkspace } from '../src/core/scan';
import { tempDir } from './helpers';

const WORKSPACE = {
  'CLAUDE.md': '# main\n',
  '.claude/rules/locked.md': '---\npaths: "src/**"\n---\nlocked\n',
  '.claude/rules/unclosed.md': '---\npaths: "docs/**"\nThis rule never closes its front matter.\n',
  '.claude/rules/bad-yaml.md': '---\npaths: [src/**/*.go\n---\nGo only\n',
  '.github/instructions/bad.instructions.md': '---\napplyTo: **/*.ts\n---\nTS\n',
  '.cursor/rules/loose.mdc': '---\nglobs: **/*.ts\n---\nTS\n',
  'src/a.ts': '',
};

describe('robustness', () => {
  const index = scanWorkspace(memoryReader(WORKSPACE, { unreadable: ['.claude/rules/locked.md', 'CLAUDE.md'] }));

  it('does not throw and reports unreadable files as RP008', () => {
    const diags = computeDiagnostics(index);
    expect(diags.filter((d) => d.code === 'RP008').map((d) => [d.file, d.args.error])).toEqual([
      ['.claude/rules/locked.md', 'EACCES'],
      ['CLAUDE.md', 'EACCES'],
    ]);
    expect(() => resolveFile(index, 'src/a.ts', {})).not.toThrow();
  });

  it('reports malformed front matter as RP004 with a per-tool message', () => {
    const rp004 = computeDiagnostics(index).filter((d) => d.code === 'RP004');
    expect(rp004.map((d) => [d.file, d.msgId, d.severity])).toEqual([
      ['.claude/rules/bad-yaml.md', 'diag.RP004.claude', 'warning'],
      ['.claude/rules/unclosed.md', 'diag.RP004.claude', 'warning'],
      ['.cursor/rules/loose.mdc', 'diag.RP004.cursor', 'info'],
      ['.github/instructions/bad.instructions.md', 'diag.RP004.copilot', 'warning'],
    ]);
  });

  it('Claude loads YAML-error and unclosed rules unconditionally, even for unrelated files', () => {
    const res = resolveFile(index, 'src/a.ts', {});
    const claude = res.agents.claude!.entries;
    expect(claude.find((e) => e.file === '.claude/rules/bad-yaml.md')).toMatchObject({ reason: 'rule-yaml-error', certainty: 'certain' });
    expect(claude.find((e) => e.file === '.claude/rules/unclosed.md')).toMatchObject({ reason: 'rule-yaml-error', certainty: 'certain' });
    // 읽지 못한 파일은 목록에 넣지 않는다.
    expect(claude.some((e) => e.file === 'CLAUDE.md' || e.file === '.claude/rules/locked.md')).toBe(false);
  });

  it('Cursor still reads unquoted globs with the lenient parser', () => {
    const res = resolveFile(index, 'src/a.ts', {});
    expect(res.agents.cursor!.entries.map((e) => [e.file, e.reason, e.detail])).toEqual([['.cursor/rules/loose.mdc', 'globs-matched', '**/*.ts']]);
  });

  it('Copilot marks a YAML-broken instructions file as uncertain', () => {
    const res = resolveFile(index, 'src/a.ts', {});
    const e = res.agents.copilot!.entries.find((x) => x.file === '.github/instructions/bad.instructions.md');
    expect(e?.certainty).toBe('uncertain');
  });

  it('front matter edge cases do not throw', () => {
    for (const text of ['', '---', '---\n---', '---\n: :\n---\n', '﻿---\npaths: x\n---\n', '---\n- a\n- b\n---\n', '---\r\npaths: "a/**"\r\n---\r\nbody']) {
      expect(() => parseFrontMatter(text)).not.toThrow();
    }
    expect(parseFrontMatter('---\r\npaths: "a/**"\r\n---\r\nbody').data).toEqual({ paths: 'a/**' });
    expect(parseFrontMatter('---\n- a\n---\n').strictError).toBeDefined();
  });
});

describe('disk reader', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });

  it('skips ignored folders, records .git and does not throw on a missing root', () => {
    const root = tempDir('disk');
    dirs.push(root);
    fs.mkdirSync(path.join(root, 'node_modules', 'x'), { recursive: true });
    fs.writeFileSync(path.join(root, 'node_modules', 'x', 'AGENTS.md'), 'ignored');
    fs.mkdirSync(path.join(root, '.git'));
    fs.writeFileSync(path.join(root, 'AGENTS.md'), 'root');
    const listed = diskReader(root).list();
    expect(listed.files).toEqual(['AGENTS.md']);
    expect(listed.gitDirs).toEqual(['']);
    const missing = diskReader(path.join(root, 'nope')).list();
    expect(missing.files).toEqual([]);
    expect(missing.unreadableDirs[0].error).toBe('ENOENT');
  });

  it('stops listing at the file limit', () => {
    const root = tempDir('limit');
    dirs.push(root);
    for (let i = 0; i < 5; i++) fs.writeFileSync(path.join(root, `f${i}.ts`), '');
    const listed = diskReader(root, 3).list();
    expect(listed.files.length).toBe(3);
    expect(listed.truncated).toBe(true);
  });
});

describe('file limit never hides rule files (regression)', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });

  const RULE = '.github/instructions/ts.instructions.md';

  it('memoryReader keeps rule files that sort after the cut and reports RP010', () => {
    const files: Record<string, string> = { [RULE]: '---\napplyTo: "**/*.ts"\n---\nTS\n', 'AGENTS.md': 'root' };
    for (let i = 0; i < 20; i++) files[`src/f${i}.ts`] = '';
    const index = scanWorkspace(memoryReader(files, { maxFiles: 5 }));
    expect(index.filesTruncated).toBe(true);
    expect(index.rules.map((r) => r.path)).toContain(RULE);
    const res = resolveFile(index, 'src/f1.ts');
    expect(res.agents.copilot!.entries.map((e) => e.file)).toContain(RULE);
    const diags = computeDiagnostics(index);
    expect(diags.find((d) => d.code === 'RP010')).toMatchObject({ severity: 'info', msgId: 'diag.RP010' });
  });

  it('diskReader keeps rule files past the limit', () => {
    const root = tempDir('limit-rules');
    dirs.push(root);
    fs.mkdirSync(path.join(root, 'src'));
    for (let i = 0; i < 10; i++) fs.writeFileSync(path.join(root, 'src', `f${i}.ts`), '');
    fs.mkdirSync(path.join(root, '.github', 'instructions'), { recursive: true });
    fs.writeFileSync(path.join(root, RULE), '---\napplyTo: "**/*.ts"\n---\nTS\n');
    const index = scanWorkspace(diskReader(root, 3));
    expect(index.filesTruncated).toBe(true);
    expect(index.rules.map((r) => r.path)).toEqual([RULE]);
  });

  it('does not report RP010 below the limit', () => {
    const index = scanWorkspace(memoryReader({ 'a.ts': '' }));
    expect(computeDiagnostics(index).some((d) => d.code === 'RP010')).toBe(false);
  });
});
