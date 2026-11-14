// AC-5: CLI 정상 경로(빌드된 out/cli/main.js 를 자식 프로세스로 실행).
import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { CLI, REPO, runCli, tempDir } from './helpers';

const EN = { LANG: 'en_US.UTF-8' };
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

describe('CLI', () => {
  it('is built before the tests run (pretest compiles)', () => {
    expect(fs.existsSync(CLI)).toBe(true);
  });

  it('--version matches package.json', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
    const r = runCli(['--version']);
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toBe(pkg.version);
  });

  it('which prints a per-agent table', () => {
    const r = runCli(['which', 'src/web/components/Button.tsx', '--example', 'mixed-monorepo'], { env: EN });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('src/web/components/Button.tsx  (launch folder: .)');
    expect(r.stdout).toMatch(/Claude Code {2}7 files/);
    expect(r.stdout).toMatch(/1\. \[=\] CLAUDE\.md\s+~\d+ tok {2}launch: in or above the launch folder \(\.\)/);
    expect(r.stdout).toContain('paths matched "src/**/*.tsx"');
    expect(r.stdout).toContain('skipped  src/web/AGENTS.md: not read: Codex reads AGENTS.md only from the project root down to the launch folder (.)');
  });

  it('which --json is valid JSON with schemaVersion 1', () => {
    const r = runCli(['which', 'src/web/components/Button.tsx', '--example', 'mixed-monorepo', '--json', '--launch-dir', 'src/web/components'], { env: EN });
    expect(r.code).toBe(0);
    const json = JSON.parse(r.stdout);
    expect(json.schemaVersion).toBe(1);
    expect(json.launchDir).toBe('src/web/components');
    expect(Object.keys(json.agents)).toEqual(['claude', 'copilot', 'cursor', 'codex', 'gemini']);
    expect(json.agents.codex.entries.map((e: { file: string }) => e.file)).toEqual(['AGENTS.md', 'src/web/AGENTS.md']);
    expect(json.warnings.some((w: { code: string }) => w.code === 'RP008')).toBe(true);
  });

  it('--agent limits the output', () => {
    const r = runCli(['which', 'src/x.ts', '--example', 'mixed-monorepo', '--agent', 'codex,gemini', '--json']);
    expect(Object.keys(JSON.parse(r.stdout).agents)).toEqual(['codex', 'gemini']);
  });

  it('explain shows the per-tool meaning of one pattern', () => {
    const r = runCli(['explain', '*.ts', 'src/x.ts'], { env: EN });
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/✔ Claude Code\s+matches/);
    expect(r.stdout).toMatch(/✘ GitHub Copilot\s+does not match/);
    expect(r.stdout).toMatch(/✘ Cursor\s+does not match/);
  });

  it('lint --fail-on warning exits 1 on the example and 0 on clean-repo', () => {
    const bad = runCli(['lint', '--example', 'mixed-monorepo', '--fail-on', 'warning'], { env: EN });
    expect(bad.code).toBe(1);
    expect(bad.stdout).toContain('.github/instructions/arr.instructions.md:2  RP001  warning');
    expect(bad.stdout).toContain('fix: Convert applyTo to one comma-separated string  ->  applyTo: "*.ts, *.tsx"');
    const clean = runCli(['lint', '--example', 'clean-repo', '--fail-on', 'warning'], { env: EN });
    expect(clean.code).toBe(0);
    expect(clean.stdout).toContain('No problems found.');
    // info 만 남는 설정에서는 --fail-on warning 이 통과한다.
    expect(runCli(['lint', '--example', 'mixed-monorepo', '--fail-on', 'none']).code).toBe(0);
  });

  it('check exits 0 on passing expectations and 1 with FAIL lines on failing ones', () => {
    const ok = runCli(['check', 'ruleprism.expect.json', '--example', 'mixed-monorepo'], { env: EN });
    expect(ok.code).toBe(0);
    expect(ok.stdout).toContain('3/3 cases passed');
    const fail = runCli(['check', 'ruleprism.expect.fail.json', '--example', 'mixed-monorepo'], { env: EN });
    expect(fail.code).toBe(1);
    expect(fail.stdout).toContain('FAIL src/api/handler.ts copilot: missing .github/instructions/arr.instructions.md');
    expect(fail.stdout).toContain('FAIL src/web/components/Button.tsx codex: missing src/web/AGENTS.md');
  });

  it('demo (npm start) prints the Button.tsx table and diagnostics from the practice workspace', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
    expect(pkg.scripts.start).toContain('out/cli/main.js demo');
    const r = runCli(['demo'], { env: EN });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('Practice workspace "mixed-monorepo"');
    expect(r.stdout).toContain('src/web/components/Button.tsx  (launch folder: .)');
    expect(r.stdout).toContain('RP006');
  });

  it('demo --write unpacks the workspace to disk, and the disk copy gives the same verdicts', () => {
    const base = tempDir('demo');
    dirs.push(base);
    const ws = path.join(base, 'ws');
    const w = runCli(['demo', '--write', ws], { env: EN });
    expect(w.code).toBe(0);
    expect(fs.existsSync(path.join(ws, '.claude', 'rules', 'ts.md'))).toBe(true);

    const disk = JSON.parse(runCli(['which', 'src/web/components/Button.tsx', '--root', ws, '--json']).stdout);
    const mem = JSON.parse(runCli(['which', 'src/web/components/Button.tsx', '--example', 'mixed-monorepo', '--json']).stdout);
    // 메모리 예제에서만 읽지 못하게 한 locked.mdc 를 빼면 디스크와 메모리 판정이 같다.
    for (const agent of ['claude', 'copilot', 'codex', 'gemini']) expect(disk.agents[agent], agent).toEqual(mem.agents[agent]);
    const cursorFiles = (j: { agents: { cursor: { entries: { file: string }[] } } }) => j.agents.cursor.entries.map((e) => e.file).filter((f) => f !== '.cursor/rules/locked.mdc');
    expect(cursorFiles(disk)).toEqual(cursorFiles(mem));

    // 디스크 사본에는 일부러 읽지 못하게 한 파일이 없으므로 RP008 만 빠진다.
    const lint = runCli(['lint', '--root', ws, '--fail-on', 'warning', '--json']);
    expect(lint.code).toBe(1);
    const codes = new Set(JSON.parse(lint.stdout).diagnostics.map((d: { code: string }) => d.code));
    expect(codes).toEqual(new Set(['RP001', 'RP002', 'RP003', 'RP004', 'RP005', 'RP006', 'RP007', 'RP009']));

    // 기대 파일은 현재 폴더 기준 경로로 읽는다.
    expect(runCli(['check', 'ruleprism.expect.json'], { cwd: ws }).code).toBe(0);
    expect(runCli(['check', 'ruleprism.expect.fail.json'], { cwd: ws }).code).toBe(1);
  });
});

describe('which --agent filters warnings by agent', () => {
  it('shows no Claude-only warning when only codex is asked', () => {
    const all = runCli(['which', 'src/web/components/Button.tsx', '--example', 'mixed-monorepo', '--lang', 'en']);
    const codex = runCli(['which', 'src/web/components/Button.tsx', '--example', 'mixed-monorepo', '--agent', 'codex', '--lang', 'en']);
    expect(codex.code).toBe(0);
    expect(codex.stdout).not.toContain('Claude Code does not read');
    expect(codex.stdout).not.toContain('RP005');
    expect(all.stdout).toContain('Claude Code does not read');
  });
});
