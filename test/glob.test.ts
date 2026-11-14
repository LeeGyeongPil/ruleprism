// AC-1: 도구별 글롭 의미 차이.
import { describe, expect, it } from 'vitest';
import { claudeMatch, explainPattern, isShallowRootPattern, rootGlobMatch, splitPatterns } from '../src/core/glob';

describe('per-tool glob semantics', () => {
  // [패턴, 경로, Claude 일치, Copilot/Cursor 일치]
  const table: [string, string, boolean, boolean][] = [
    ['*.md', 'docs/a/b.md', true, false],
    ['*.md', 'README.md', true, true],
    ['/*.md', 'README.md', true, false],
    ['/*.md', 'docs/x.md', false, false],
    ['*.ts', 'src/x.ts', true, false],
    ['**/*.ts', 'src/x.ts', true, true],
    ['src/*.tsx', 'src/a/b.tsx', false, false],
    ['src/**/*.{ts,tsx}', 'src/a/b.tsx', true, true],
    ['src/**/*.{ts,tsx}', 'lib/a.ts', false, false],
    ['.github/**', '.github/workflows/ci.yml', true, true],
  ];
  it.each(table)('%s vs %s → claude=%s, copilot/cursor=%s', (pattern, file, claude, root) => {
    expect(claudeMatch(pattern, file)).toBe(claude);
    expect(rootGlobMatch(pattern, file)).toBe(root);
  });

  it('"/*.md" keeps the leading slash meaning only for Claude (Copilot treats it as a literal absolute path)', () => {
    expect(rootGlobMatch('/*.md', 'README.md')).toBe(false);
  });

  it('splits a Copilot comma string', () => {
    expect(splitPatterns('**/*.ts, **/*.tsx')).toEqual(['**/*.ts', '**/*.tsx']);
    expect(splitPatterns('**/*.ts,**/*.tsx')).toEqual(['**/*.ts', '**/*.tsx']);
  });

  it('accepts Claude paths as a YAML list and as a comma string, without breaking brace groups', () => {
    expect(splitPatterns(['src/**/*.ts', 'lib/**'])).toEqual(['src/**/*.ts', 'lib/**']);
    expect(splitPatterns('src/**/*.{ts,tsx}, lib/**')).toEqual(['src/**/*.{ts,tsx}', 'lib/**']);
    expect(splitPatterns(['a.ts, b.ts'])).toEqual(['a.ts', 'b.ts']);
    expect(splitPatterns(undefined)).toEqual([]);
  });

  it('flags only wildcard patterns without a slash as shallow', () => {
    expect(isShallowRootPattern('*.ts')).toBe(true);
    expect(isShallowRootPattern('**/*.ts')).toBe(false);
    expect(isShallowRootPattern('**')).toBe(false);
    expect(isShallowRootPattern('package.json')).toBe(false);
  });

  it('explainPattern reports a verdict and a documentation link per tool', () => {
    const rows = explainPattern('*.ts', 'src/x.ts');
    expect(rows.map((r) => [r.agent, r.matches, r.key])).toEqual([
      ['claude', true, 'claude-basename'],
      ['copilot', false, 'root-shallow'],
      ['cursor', false, 'root-shallow'],
    ]);
    for (const r of rows) expect(r.doc).toMatch(/^https:\/\//);
  });
});
