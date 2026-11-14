// AC-3: 진단 RP001–RP009 의 파일·줄과 빠른 수정 텍스트.
import { describe, expect, it } from 'vitest';
import { MIXED_MONOREPO } from '../src/core/demo-workspace';
import { computeDiagnostics, ruleMatches } from '../src/core/diagnostics';
import { applyFix } from '../src/core/fixes';
import { memoryReader } from '../src/core/fsreader';
import { scanWorkspace } from '../src/core/scan';
import { exampleIndex } from './helpers';

describe('diagnostics on the practice workspaces', () => {
  const diags = computeDiagnostics(exampleIndex('mixed-monorepo'));

  it('reports every code at the expected file, line and severity', () => {
    expect(diags.map((d) => `${d.code} ${d.severity} ${d.file}:${d.line}`)).toEqual([
      'RP004 warning .claude/rules/broken.md:2',
      'RP007 warning .claude/rules/dead.md:2',
      'RP009 warning .claude/rules/globs-only.md:2',
      'RP003 warning .cursor/rules/always.mdc:4',
      'RP008 warning .cursor/rules/locked.mdc:1',
      'RP004 info .cursor/rules/star.mdc:2',
      'RP001 warning .github/instructions/arr.instructions.md:2',
      'RP002 warning .github/instructions/arr.instructions.md:2',
      'RP002 warning .github/instructions/arr.instructions.md:2',
      'RP007 warning .github/instructions/arr.instructions.md:2',
      'RP002 warning .github/instructions/shallow.instructions.md:2',
      'RP007 warning .github/instructions/shallow.instructions.md:2',
      'RP005 info AGENTS.md:1',
      'RP005 info src/legacy/AGENTS.md:1',
      'RP006 warning src/legacy/AGENTS.md:1',
      'RP005 info src/web/AGENTS.md:1',
    ]);
  });

  it('covers all nine codes', () => {
    expect(new Set(diags.map((d) => d.code))).toEqual(new Set(['RP001', 'RP002', 'RP003', 'RP004', 'RP005', 'RP006', 'RP007', 'RP008', 'RP009']));
  });

  it('finds nothing on clean-repo', () => {
    expect(computeDiagnostics(exampleIndex('clean-repo'))).toEqual([]);
  });

  it('RP005 disappears with claude-md-and-agents-md', () => {
    const both = computeDiagnostics(exampleIndex('mixed-monorepo'), { claudeInstructionFiles: 'claude-md-and-agents-md' });
    expect(both.some((d) => d.code === 'RP005')).toBe(false);
  });
});

describe('quick fixes', () => {
  const diags = computeDiagnostics(exampleIndex('mixed-monorepo'));
  const textOf = (p: string) => MIXED_MONOREPO.files[p];

  it('RP001 turns the YAML list into one comma-separated string', () => {
    const d = diags.find((x) => x.code === 'RP001')!;
    expect(textOf(d.file).split('\n')[1]).toBe('applyTo: ["*.ts","*.tsx"]');
    expect(d.fix).toMatchObject({ startLine: 2, endLine: 2, newText: 'applyTo: "*.ts, *.tsx"' });
    expect(applyFix(textOf(d.file), d.fix!).split('\n')[1]).toBe('applyTo: "*.ts, *.tsx"');
  });

  it('RP001 also rewrites a block list', () => {
    const text = '---\napplyTo:\n  - "**/*.ts"\n  - "**/*.tsx"\ndescription: x\n---\nbody\n';
    const idx = scanWorkspace(memoryReader({ '.github/instructions/b.instructions.md': text, 'a.ts': '' }));
    const d = computeDiagnostics(idx).find((x) => x.code === 'RP001')!;
    expect(d.fix).toMatchObject({ startLine: 2, endLine: 4 });
    expect(applyFix(text, d.fix!)).toBe('---\napplyTo: "**/*.ts, **/*.tsx"\ndescription: x\n---\nbody\n');
  });

  it('RP002 prefixes the shallow pattern with **/', () => {
    const d = diags.find((x) => x.code === 'RP002' && x.file.endsWith('shallow.instructions.md'))!;
    expect(d.args.pattern).toBe('*.tsx');
    expect(applyFix(textOf(d.file), d.fix!).split('\n')[1]).toBe('applyTo: "**/*.tsx"');
  });

  it('RP002 fix for "*.ts" gives "**/*.ts" and leaves other patterns alone', () => {
    const text = '---\napplyTo: "**/*.md, *.ts"\n---\nbody\n';
    const idx = scanWorkspace(memoryReader({ '.github/instructions/c.instructions.md': text, 'src/a.ts': '' }));
    const d = computeDiagnostics(idx).find((x) => x.code === 'RP002')!;
    expect(d.fix!.newText).toBe('applyTo: "**/*.md, **/*.ts"');
  });

  it('RP002 also applies to Cursor globs', () => {
    const text = '---\nglobs: *.tsx\n---\nbody\n';
    const idx = scanWorkspace(memoryReader({ '.cursor/rules/r.mdc': text, 'src/a.tsx': '' }));
    const d = computeDiagnostics(idx).find((x) => x.code === 'RP002')!;
    expect(d.msgId).toBe('diag.RP002.cursor');
    expect(d.fix!.newText).toBe('globs: **/*.tsx');
  });
});

describe('rule match counts (CodeLens and RP007)', () => {
  const index = exampleIndex('mixed-monorepo');
  const rule = (p: string) => index.rules.find((r) => r.path === p)!;

  it('counts files per scoped rule', () => {
    expect(ruleMatches(index, rule('.github/instructions/api.instructions.md'))).toMatchObject({ scoped: true, count: 2 });
    expect(ruleMatches(index, rule('.claude/rules/dead.md'))).toMatchObject({ scoped: true, count: 0 });
    expect(ruleMatches(index, rule('.claude/rules/general.md'))).toMatchObject({ scoped: false });
  });

  it('sorts diagnostics the same way whatever the machine locale is (regression: Linux CI)', () => {
    // 리눅스 CI(LANG=C.UTF-8)는 ICU 기본 로캘이 en-US-u-va-posix 라 localeCompare 순서가 macOS 와 다르다.
    const idx = scanWorkspace(memoryReader({ '.claude/rules/alpha.md': '---\npaths: "zzz/**"\n---\n', '.claude/rules/Zeta.md': '---\npaths: "yyy/**"\n---\n', 'a.ts': '' }));
    const files = () => computeDiagnostics(idx).filter((d) => d.code === 'RP007').map((d) => d.file);
    const expected = ['.claude/rules/Zeta.md', '.claude/rules/alpha.md']; // 문자 코드 순: 'Z'(0x5A) < 'a'(0x61)
    expect(files()).toEqual(expected);
    const original = String.prototype.localeCompare;
    try {
      // 기본 로캘을 바꾼 것처럼 localeCompare 를 뒤집어도 결과가 같아야 한다.
      String.prototype.localeCompare = function (this: string, that: string) {
        return -original.call(this, that);
      } as typeof original;
      expect(files()).toEqual(expected);
    } finally {
      String.prototype.localeCompare = original;
    }
  });

  it('marks RP007 as approximate when the file list hit the limit', () => {
    const idx = scanWorkspace(memoryReader({ '.claude/rules/x.md': '---\npaths: "zzz/**"\n---\n', 'a.ts': '', 'b.ts': '' }, { maxFiles: 2 }));
    const d = computeDiagnostics(idx).find((x) => x.code === 'RP007')!;
    expect(d).toMatchObject({ severity: 'info', msgId: 'diag.RP007.approx' });
  });
});
