// AC-6: CLI 오류 경로 — 종료 2, stderr 에 error: + hint:, 스택 트레이스 없음.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { runCli, tempDir } from './helpers';

const EN = { LANG: 'en_US.UTF-8' };
const base = tempDir('errors');
afterAll(() => fs.rmSync(base, { recursive: true, force: true }));

function expectUsageError(args: string[], errorPart: string, opts: { cwd?: string } = {}) {
  const r = runCli(args, { env: EN, ...opts });
  expect(r.code).toBe(2);
  expect(r.stdout).toBe('');
  const lines = r.stderr.trimEnd().split('\n');
  expect(lines[0]).toMatch(/^error: /);
  expect(lines[0]).toContain(errorPart);
  expect(lines[1]).toMatch(/^hint: /);
  expect(lines.length).toBe(2);
  // 스택 트레이스 줄이 없다.
  expect(r.stderr).not.toMatch(/^\s+at /m);
  expect(r.stderr).not.toContain('Error:');
}

describe('CLI error paths', () => {
  it('unknown option', () => expectUsageError(['which', 'a.ts', '--bogus'], "Unknown option '--bogus'"));
  it('unknown command', () => expectUsageError(['frobnicate'], 'unknown command "frobnicate"'));
  it('missing positional', () => expectUsageError(['which'], '"which" needs <file>'));
  it('extra positional', () => expectUsageError(['lint', 'extra'], 'unexpected extra arguments: extra'));
  it('missing --root', () => expectUsageError(['which', 'a.ts', '--root', path.join(base, 'does-not-exist')], 'does not exist'));
  it('--root that is a file', () => {
    const f = path.join(base, 'plain.txt');
    fs.writeFileSync(f, 'x');
    expectUsageError(['lint', '--root', f], 'is not a folder');
  });
  it('file outside the root', () => expectUsageError(['which', '../outside.ts', '--root', base], 'is outside the workspace root'));
  it('absolute file outside the root', () => expectUsageError(['which', '/etc/hosts', '--root', base], 'is outside the workspace root'));
  it('file outside the root of an example', () => expectUsageError(['which', '../x.ts', '--example', 'clean-repo'], 'is outside the workspace root'));
  it('launch folder outside the root', () => expectUsageError(['which', 'a.ts', '--root', base, '--launch-dir', '..'], 'launch folder ".." is outside'));
  it('unreadable expectations file (missing)', () => expectUsageError(['check', 'nope.json', '--root', base], 'cannot read the expectations file "nope.json" (ENOENT)', { cwd: base }));
  it('unreadable expectations file (a folder)', () => {
    fs.mkdirSync(path.join(base, 'expect-dir'), { recursive: true });
    expectUsageError(['check', 'expect-dir', '--root', base], 'cannot read the expectations file "expect-dir" (EISDIR)', { cwd: base });
  });
  it('invalid expectations file', () => {
    fs.writeFileSync(path.join(base, 'bad.json'), '{"cases": [{"file": "a.ts", "agent": "robot"}]}');
    expectUsageError(['check', 'bad.json', '--root', base], 'agent must be one of', { cwd: base });
  });
  it('bad --lang', () => expectUsageError(['lint', '--lang', 'fr'], 'unknown language "fr"'));
  it('bad --agent', () => expectUsageError(['which', 'a.ts', '--example', 'clean-repo', '--agent', 'robot'], 'unknown agent "robot"'));
  it('bad --fail-on', () => expectUsageError(['lint', '--example', 'clean-repo', '--fail-on', 'loud'], 'unknown --fail-on level "loud"'));
  it('bad --codex-max-bytes', () => {
    expectUsageError(['which', 'a.ts', '--example', 'clean-repo', '--codex-max-bytes', 'lots'], '--codex-max-bytes must be a positive whole number');
    expectUsageError(['which', 'a.ts', '--example', 'clean-repo', '--codex-max-bytes=0'], '--codex-max-bytes must be a positive whole number');
  });
  it('negative --codex-max-bytes in the space form gets the numeric message', () => {
    expectUsageError(['which', 'a.ts', '--example', 'clean-repo', '--codex-max-bytes', '-3'], '--codex-max-bytes must be a positive whole number, got "-3"');
  });
  it('empty explain pattern or file', () => {
    expectUsageError(['explain', '', 'src/x.ts'], '<pattern> must not be empty');
    expectUsageError(['explain', '*.ts', '  '], '<file> must not be empty');
  });
  it('unknown example', () => expectUsageError(['lint', '--example', 'nope'], 'unknown example "nope"'));
  it('--example with --root', () => expectUsageError(['lint', '--example', 'clean-repo', '--root', base], '--example and --root cannot be used together'));
  it('unwritable demo output path', () => expectUsageError(['demo', '--write', '/dev/null/ruleprism-demo'], 'cannot write the practice workspace'));
  it('non-empty demo output folder is not overwritten', () => {
    const d = path.join(base, 'full');
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'keep.txt'), 'mine');
    expectUsageError(['demo', '--write', d], 'already exists and is not empty');
    expect(fs.readFileSync(path.join(d, 'keep.txt'), 'utf8')).toBe('mine');
  });
  it('errors are translated too', () => {
    const r = runCli(['frobnicate', '--lang', 'ko']);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('error: 알 수 없는 명령 "frobnicate"');
    expect(r.stderr).toContain('hint: "ruleprism --help" 로');
  });
});
