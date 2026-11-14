// AC-2: 해석기 골든(예제 mixed-monorepo 의 Button.tsx) + 작업 폴더·instructionFiles 에 따른 차이.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { memoryReader } from '../src/core/fsreader';
import { launchDirFor, resolveFile } from '../src/core/resolve';
import { scanUserFiles, scanWorkspace } from '../src/core/scan';
import { exampleIndex } from './helpers';

const FILE = 'src/web/components/Button.tsx';
const golden = (name: string) => JSON.parse(fs.readFileSync(path.join(__dirname, 'golden', name), 'utf8'));
const files = (res: ReturnType<typeof resolveFile>, agent: 'claude' | 'copilot' | 'cursor' | 'codex' | 'gemini') =>
  res.agents[agent]!.entries.map((e) => e.file);

describe('resolver golden files', () => {
  const index = exampleIndex('mixed-monorepo');

  it('launch folder = workspace root', () => {
    expect(resolveFile(index, FILE, { launchDir: launchDirFor('workspaceRoot', FILE) })).toEqual(golden('button.root.json'));
  });

  it('launch folder = folder of the file', () => {
    expect(resolveFile(index, FILE, { launchDir: launchDirFor('fileFolder', FILE) })).toEqual(golden('button.filefolder.json'));
  });

  it('Codex reads src/web/AGENTS.md only when launched at or below src/web', () => {
    const root = resolveFile(index, FILE, { launchDir: '' });
    const leaf = resolveFile(index, FILE, { launchDir: 'src/web/components' });
    expect(files(root, 'codex')).toEqual(['AGENTS.md']);
    expect(root.agents.codex!.skipped).toEqual([{ file: 'src/web/AGENTS.md', reason: 'skip-not-in-chain', detail: '.' }]);
    expect(files(leaf, 'codex')).toEqual(['AGENTS.md', 'src/web/AGENTS.md']);
  });

  it('Claude leaves AGENTS.md out when CLAUDE.md exists, and reads both with claude-md-and-agents-md', () => {
    const def = resolveFile(index, FILE, {});
    expect(files(def, 'claude')).not.toContain('AGENTS.md');
    expect(def.agents.claude!.skipped.map((s) => [s.file, s.reason])).toEqual([
      ['AGENTS.md', 'skip-agents-md-shadowed'],
      ['src/web/AGENTS.md', 'skip-agents-md-shadowed'],
    ]);
    const both = resolveFile(index, FILE, { claudeInstructionFiles: 'claude-md-and-agents-md' });
    const list = files(both, 'claude');
    // 폴더마다 CLAUDE.md 다음에 AGENTS.md
    expect(list.indexOf('AGENTS.md')).toBeGreaterThan(list.indexOf('CLAUDE.md'));
    expect(list.indexOf('src/web/AGENTS.md')).toBeGreaterThan(list.indexOf('src/web/CLAUDE.md'));
  });

  it('Claude reads AGENTS.md instead when there is no CLAUDE.md', () => {
    const idx = exampleIndex('clean-repo');
    const res = resolveFile(idx, 'src/index.ts', {});
    expect(res.agents.claude!.entries.find((e) => e.file === 'AGENTS.md')?.reason).toBe('agents-md-instead');
  });

  it('a CLAUDE.local.md alone also hides AGENTS.md (documented pitfall)', () => {
    const idx = scanWorkspace(memoryReader({ 'AGENTS.md': '# a\n', 'CLAUDE.local.md': '# mine\n', 'src/a.ts': '' }));
    const res = resolveFile(idx, 'src/a.ts', {});
    expect(files(res, 'claude')).toEqual(['CLAUDE.local.md']);
  });

  it('same-folder order is CLAUDE.md, .claude/CLAUDE.md, rules without paths, CLAUDE.local.md', () => {
    const idx = scanWorkspace(
      memoryReader({
        'CLAUDE.local.md': 'local',
        'CLAUDE.md': 'main',
        '.claude/CLAUDE.md': 'dot',
        '.claude/rules/a.md': 'rule',
        'x.ts': '',
      }),
    );
    expect(files(resolveFile(idx, 'x.ts', {}), 'claude')).toEqual(['CLAUDE.md', '.claude/CLAUDE.md', '.claude/rules/a.md', 'CLAUDE.local.md']);
  });

  it('Codex picks AGENTS.override.md over AGENTS.md in a folder and stops at the nearest .git', () => {
    const idx = scanWorkspace(
      memoryReader({
        'AGENTS.md': 'outer',
        'pkg/.git/HEAD': 'ref',
        'pkg/AGENTS.md': 'pkg',
        'pkg/AGENTS.override.md': 'override',
        'pkg/a.ts': '',
      }),
    );
    const res = resolveFile(idx, 'pkg/a.ts', { launchDir: 'pkg' });
    expect(files(res, 'codex')).toEqual(['pkg/AGENTS.override.md']);
    expect(res.agents.codex!.skipped).toEqual([
      { file: 'pkg/AGENTS.md', reason: 'skip-override', detail: 'pkg/AGENTS.override.md' },
      // 바깥 AGENTS.md 는 프로젝트 루트(pkg, .git 이 있는 곳) 위라서 읽지 않는다.
      { file: 'AGENTS.md', reason: 'skip-not-in-chain', detail: 'pkg' },
    ]);
  });

  it('Codex marks the file where the byte limit cuts in', () => {
    const idx = scanWorkspace(memoryReader({ 'AGENTS.md': 'a'.repeat(60), 'src/AGENTS.md': 'b'.repeat(60), 'src/deep/AGENTS.md': 'c', 'src/deep/x.ts': '' }));
    const res = resolveFile(idx, 'src/deep/x.ts', { launchDir: 'src/deep', codexMaxBytes: 100 });
    const codex = res.agents.codex!;
    expect(codex.entries.map((e) => [e.file, e.truncated ?? false, e.approxTokens])).toEqual([
      ['AGENTS.md', false, 15],
      ['src/AGENTS.md', true, 10],
    ]);
    expect(codex.skipped).toEqual([{ file: 'src/deep/AGENTS.md', reason: 'skip-truncated', detail: '100' }]);
  });

  it('Cursor nested .cursor/rules are marked uncertain; Gemini JIT is conditional', () => {
    const idx = scanWorkspace(
      memoryReader({
        '.cursor/rules/root.mdc': '---\nalwaysApply: true\n---\nx',
        'pkg/.cursor/rules/nested.mdc': '---\nglobs: "*.ts"\n---\ny',
        'pkg/GEMINI.md': 'g',
        'pkg/a.ts': '',
      }),
    );
    const res = resolveFile(idx, 'pkg/a.ts', {});
    expect(res.agents.cursor!.entries.map((e) => [e.file, e.certainty])).toEqual([
      ['.cursor/rules/root.mdc', 'certain'],
      ['pkg/.cursor/rules/nested.mdc', 'uncertain'],
    ]);
    expect(res.agents.gemini!.entries.map((e) => [e.file, e.reason, e.certainty])).toEqual([['pkg/GEMINI.md', 'gemini-jit', 'conditional']]);
  });

  it('Copilot follows chat.useAgentsMdFile and chat.useClaudeMdFile', () => {
    const index2 = exampleIndex('mixed-monorepo');
    const off = resolveFile(index2, FILE, { copilotUseAgentsMd: false, copilotUseClaudeMd: false });
    const list = files(off, 'copilot');
    expect(list).not.toContain('AGENTS.md');
    expect(list).not.toContain('CLAUDE.md');
    expect(list).toEqual(['.github/copilot-instructions.md', '.github/instructions/ts.instructions.md']);
  });

  it('user-level files come first, relative to the launch folder for ~/.claude/rules', () => {
    const webRule = '---\npaths: "components/**"\n---\nweb';
    const home = memoryReader({ '.claude/CLAUDE.md': 'me', '.claude/rules/web.md': webRule, '.codex/AGENTS.md': 'codex me', '.gemini/GEMINI.md': 'gem me' });
    // 규칙 나열은 ~/.claude/rules 기준 리더로 한다(홈 전체를 훑지 않는다).
    const rules = memoryReader({ 'web.md': webRule });
    const user = scanUserFiles(home, rules);
    const idx = exampleIndex('mixed-monorepo');
    const res = resolveFile(idx, FILE, { launchDir: 'src/web' }, user);
    expect(files(res, 'claude').slice(0, 2)).toEqual(['~/.claude/CLAUDE.md', '~/.claude/rules/web.md']);
    expect(files(res, 'codex')[0]).toBe('~/.codex/AGENTS.md');
    expect(files(res, 'gemini')[0]).toBe('~/.gemini/GEMINI.md');
  });
});
