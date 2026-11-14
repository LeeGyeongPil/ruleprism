// AC-8(1): 확장 화면 모델 — 트리 노드·상태 표시줄·CodeLens 문구.
import { describe, expect, it } from 'vitest';
import { ruleMatches } from '../src/core/diagnostics';
import { resolveFile } from '../src/core/resolve';
import { makeT } from '../src/i18n/i18n';
import { buildTree, codeLensText, statusSummary, statusText } from '../src/view/model';
import { exampleIndex } from './helpers';

const t = makeT('en');
const ko = makeT('ko');
const index = exampleIndex('mixed-monorepo');
const res = resolveFile(index, 'src/web/components/Button.tsx', {});

describe('view model', () => {
  it('builds one node per agent with ordered entries, reasons and tokens', () => {
    const tree = buildTree(res, t);
    expect(tree.map((n) => n.label)).toEqual(['Claude Code', 'GitHub Copilot', 'Cursor', 'Codex', 'Gemini CLI']);
    const claude = tree[0];
    expect(claude.description).toMatch(/^7 files · ~\d+ tok · in context order$/);
    const first = claude.children![0];
    expect(first).toMatchObject({ kind: 'entry', label: '1. CLAUDE.md', file: 'CLAUDE.md', certainty: 'certain' });
    expect(first.description).toMatch(/^launch: in or above the launch folder \(\.\) · ~\d+ tok$/);
    const tsx = claude.children!.find((c) => c.file === '.claude/rules/frontend/tsx.md')!;
    expect(tsx.description).toContain('paths matched "src/**/*.tsx"');
    expect(tsx.tooltip).toContain('Certainty: when the agent touches this file');
    const skipped = claude.children!.filter((c) => c.kind === 'skipped').map((c) => c.label);
    expect(skipped).toEqual(['skipped: AGENTS.md', 'skipped: src/web/AGENTS.md']);
  });

  it('marks truncated Codex files', () => {
    const r = resolveFile(index, 'src/legacy/batch.ts', { launchDir: 'src/legacy' });
    const codex = buildTree(r, t).find((n) => n.id === 'codex')!;
    expect(codex.children!.find((c) => c.file === 'src/legacy/AGENTS.md')!.description).toContain('truncated at 32768 bytes');
  });

  it('status bar text', () => {
    expect(statusSummary(res)).toBe('C7 Cp9 Cu5 Cx1 G2');
    expect(statusText(res, t)).toBe('Rules: C7 Cp9 Cu5 Cx1 G2');
    expect(statusText(res, ko)).toBe('규칙: C7 Cp9 Cu5 Cx1 G2');
    const fileFolder = resolveFile(index, 'src/web/components/Button.tsx', { launchDir: 'src/web/components' });
    expect(statusSummary(fileFolder)).toBe('C7 Cp9 Cu5 Cx2 G2');
  });

  it('CodeLens text with the matching file count', () => {
    const lens = (p: string, tr = t) => codeLensText(ruleMatches(index, index.rules.find((r) => r.path === p)!), tr);
    expect(lens('.github/instructions/api.instructions.md')).toBe('matches 2 files in this workspace');
    expect(lens('.github/instructions/api.instructions.md', ko)).toBe('이 작업 공간에서 2개 파일에 일치');
    expect(lens('.claude/rules/dead.md')).toBe('matches no files in this workspace');
    expect(lens('.claude/rules/general.md')).toBe('applies to every file');
    expect(lens('.cursor/rules/manual.mdc')).toBe('not attached automatically');
    expect(lens('.cursor/rules/always.mdc')).toBe('applies to every file');
    // 규칙 파일이 아닌 파일에는 CodeLens 가 없다.
    expect(codeLensText(undefined, t)).toBeUndefined();
  });
});
