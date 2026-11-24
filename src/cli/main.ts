#!/usr/bin/env node
// ruleprism CLI: which · explain · lint · check · demo
// 종료 코드: 0 정상 / 1 check 불일치·lint 문제 / 2 사용법·입력 오류(stderr 에 error: + hint:, 스택 트레이스 없음).
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { parseArgs } from 'node:util';
import { computeDiagnostics } from '../core/diagnostics';
import { DEMO_WORKSPACES, MIXED_MONOREPO, type DemoWorkspace } from '../core/demo-workspace';
import { checkExpectations, ExpectFormatError, parseExpectations } from '../core/expect';
import { diskReader, errorCode, type FsReader, memoryReader } from '../core/fsreader';
import { explainPattern } from '../core/glob';
import { normalizeRel, resolveFile } from '../core/resolve';
import { type RuleFile, scanUserFiles, scanWorkspace } from '../core/scan';
import { ALL_AGENTS, type AgentId, DEFAULT_OPTIONS, type InstructionFilesMode, type ResolveOptions, type Severity } from '../core/types';
import { detectLang, makeT, type Translate } from '../i18n/i18n';
import { diagJson, renderCheck, renderExplain, renderLint, renderWhich, warningsFor, whichJson } from './render';

/** 사용자에게 보여 줄 오류: 메시지 키 + 힌트 키. 종료 코드 2. */
class CliError extends Error {
  constructor(
    readonly key: string,
    readonly args: Record<string, string | number>,
    readonly hintKey: string,
  ) {
    super(key);
  }
}

export interface Io {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
  cwd: string;
  env: NodeJS.ProcessEnv;
}

/** package.json 의 버전(확장 매니페스트와 같은 파일이라 둘이 어긋나지 않는다). */
export function readVersion(): string {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8')) as { version: string };
  return pkg.version;
}

const OPTIONS = {
  root: { type: 'string' },
  'launch-dir': { type: 'string' },
  agent: { type: 'string' },
  json: { type: 'boolean' },
  user: { type: 'boolean' },
  example: { type: 'string' },
  'fail-on': { type: 'string' },
  'claude-instruction-files': { type: 'string' },
  'codex-max-bytes': { type: 'string' },
  write: { type: 'string' },
  lang: { type: 'string' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
} as const;

/** 인자 해석보다 먼저 --lang 을 찾아 둔다(인자 오류 메시지도 고른 언어로 내기 위해). */
function peekLang(argv: string[]): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--lang') return argv[i + 1];
    if (argv[i].startsWith('--lang=')) return argv[i].slice('--lang='.length);
  }
  return undefined;
}

export function run(argv: string[], io: Io): number {
  const langFlag = peekLang(argv);
  const t = makeT(detectLang(langFlag, io.env));
  try {
    if (langFlag !== undefined && !['en', 'ko'].includes(langFlag)) throw new CliError('cli.error.badLang', { value: langFlag }, 'cli.hint.lang');
    return runCommand(argv, io, t);
  } catch (e) {
    if (e instanceof CliError) {
      io.stderr(`${t('cli.error.prefix', { message: t(e.key, e.args) })}\n${t('cli.hint.prefix', { message: t(e.hintKey) })}\n`);
      return 2;
    }
    // 예상하지 못한 실패도 스택 트레이스 대신 한 줄로.
    const detail = e instanceof Error ? e.message.split('\n')[0] : String(e);
    io.stderr(`${t('cli.error.prefix', { message: t('cli.error.unexpected', { detail }) })}\n${t('cli.hint.prefix', { message: t('cli.hint.unexpected') })}\n`);
    return 2;
  }
}

function runCommand(argv: string[], io: Io, t: Translate): number {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true });
  } catch (e) {
    // "--codex-max-bytes -5" (space form): Node says "ambiguous"; give the numeric message instead.
    if ((e as { code?: string }).code === 'ERR_PARSE_ARGS_INVALID_OPTION_VALUE') {
      const at = argv.indexOf('--codex-max-bytes');
      if (at >= 0 && (e as Error).message.includes("'--codex-max-bytes'")) {
        throw new CliError('cli.error.badNumber', { value: argv[at + 1] ?? '' }, 'cli.hint.number');
      }
    }
    throw new CliError('cli.error.badArgs', { detail: (e as Error).message.split('\n')[0] }, 'cli.hint.seeHelp');
  }
  const { values, positionals } = parsed;
  const version = readVersion();

  if (values.version) {
    io.stdout(`${version}\n`);
    return 0;
  }
  const [command, ...rest] = positionals;
  if (values.help || command === undefined) {
    io.stdout(`${t('cli.help', { version })}\n`);
    return 0;
  }
  if (!['which', 'explain', 'lint', 'check', 'demo'].includes(command)) {
    throw new CliError('cli.error.unknownCommand', { command }, 'cli.hint.seeHelp');
  }

  // 위치 인자 개수 확인
  const need: Record<string, { n: number; what: string }> = {
    which: { n: 1, what: '<file>' },
    explain: { n: 2, what: '<pattern> <file>' },
    lint: { n: 0, what: '' },
    check: { n: 1, what: '<expect.json|yaml>' },
    demo: { n: 0, what: '' },
  };
  if (rest.length < need[command].n) throw new CliError('cli.error.missingArg', { command, what: need[command].what }, 'cli.hint.seeHelp');
  if (rest.length > need[command].n) throw new CliError('cli.error.tooManyArgs', { command, args: rest.slice(need[command].n).join(' ') }, 'cli.hint.seeHelp');

  // explain 은 작업 공간이 필요 없다.
  if (command === 'explain') {
    const [pattern, file] = rest;
    if (pattern.trim() === '') throw new CliError('cli.error.emptyArg', { what: '<pattern>' }, 'cli.hint.emptyArg');
    if (file.trim() === '') throw new CliError('cli.error.emptyArg', { what: '<file>' }, 'cli.hint.emptyArg');
    const rows = explainPattern(pattern, normalizeRel(file));
    io.stdout(values.json ? `${JSON.stringify({ schemaVersion: 1, pattern, file: normalizeRel(file), results: rows }, null, 2)}\n` : renderExplain(pattern, normalizeRel(file), rows, t));
    return 0;
  }

  if (command === 'demo' && values.write !== undefined) return writeDemo(values.write, io, t);

  // 작업 공간 정하기: --example(메모리) 또는 --root(디스크). demo 는 기본으로 mixed-monorepo.
  if (values.example !== undefined && values.root !== undefined) throw new CliError('cli.error.exampleAndRoot', {}, 'cli.hint.exampleAndRoot');
  let example: DemoWorkspace | undefined;
  if (values.example !== undefined) {
    example = DEMO_WORKSPACES[values.example];
    if (!example) throw new CliError('cli.error.unknownExample', { value: values.example }, 'cli.hint.example');
  } else if (command === 'demo') example = MIXED_MONOREPO;

  let reader: FsReader;
  let rootLabel: string;
  let rootAbs: string | undefined;
  if (example) {
    reader = memoryReader(example.files, { unreadable: example.unreadable });
    rootLabel = `example:${example.name}`;
  } else {
    rootAbs = path.resolve(io.cwd, values.root ?? '.');
    if (!isDir(rootAbs)) throw new CliError('cli.error.rootMissing', { root: values.root ?? '.' }, 'cli.hint.root');
    reader = diskReader(rootAbs);
    rootLabel = rootAbs;
  }

  const opts = readOptions(values, rootAbs, rootLabel);
  const index = scanWorkspace(reader, opts.geminiFileNames);
  const userRules = values.user ? loadUserRules(opts.geminiFileNames) : [];

  if (command === 'which' || command === 'demo') {
    const file = command === 'demo' ? example!.focusFile : toRootRelative(rest[0], rootAbs, rootLabel, 'file');
    // which 는 아직 없는 파일을 가정해 보는 용도라 막지 않고, 오타를 알아챌 수 있게 stderr 에만 경고한다.
    if (command === 'which') {
      if (!pathExists(file, 'file', rootAbs, example)) io.stderr(`${t('cli.warn.fileMissing', { file: rest[0], root: rootLabel })}\n`);
      if (opts.launchDir !== undefined && !pathExists(opts.launchDir, 'dir', rootAbs, example)) {
        io.stderr(`${t('cli.warn.launchDirMissing', { dir: values['launch-dir'] as string, root: rootLabel })}\n`);
      }
    }
    const res = resolveFile(index, file, opts, userRules);
    const diags = computeDiagnostics(index, opts);
    if (values.json) {
      io.stdout(`${JSON.stringify(whichJson(res, rootLabel, warningsFor(res, diags), t), null, 2)}\n`);
      return 0;
    }
    if (command === 'demo') {
      io.stdout(`${t('cli.demo.banner', { name: example!.name })}\n\n`);
      io.stdout(renderWhich(res, t, []));
      io.stdout(`\n${renderLint(diags, t)}`);
      for (const f of example!.unreadable) io.stdout(`${t('cli.demo.unreadableNote', { file: f })}\n`);
      io.stdout(`\n${t('cli.demo.next')}\n`);
      return 0;
    }
    io.stdout(renderWhich(res, t, warningsFor(res, diags)));
    return 0;
  }

  if (command === 'lint') {
    const failOn = values['fail-on'] ?? 'warning';
    if (!['error', 'warning', 'info', 'none'].includes(failOn)) throw new CliError('cli.error.badFailOn', { value: failOn }, 'cli.hint.failOn');
    const diags = computeDiagnostics(index, opts);
    io.stdout(values.json ? `${JSON.stringify({ schemaVersion: 1, root: rootLabel, diagnostics: diags.map((d) => diagJson(d, t)) }, null, 2)}\n` : renderLint(diags, t));
    return diags.some((d) => atOrAbove(d.severity, failOn)) ? 1 : 0;
  }

  // check
  const cases = readExpectations(rest[0], io.cwd, example);
  // 오타 난 경로가 검사 없이 통과하지 않도록, 없는 file·launchDir 은 모두 모아 종료 2 로 알린다.
  const problems: string[] = [];
  cases.forEach((c, i) => {
    if (!pathExists(c.file, 'file', rootAbs, example)) problems.push(`cases[${i}].file "${c.file}"`);
    if (c.launchDir !== undefined && !pathExists(c.launchDir, 'dir', rootAbs, example)) problems.push(`cases[${i}].launchDir "${c.launchDir}"`);
  });
  if (problems.length > 0) throw new CliError('cli.error.checkPathMissing', { list: problems.join(', '), root: rootLabel }, 'cli.hint.checkPathMissing');
  const results = checkExpectations(index, cases, opts, userRules);
  const { text, failed } = renderCheck(results, t);
  io.stdout(values.json ? `${JSON.stringify({ schemaVersion: 1, root: rootLabel, total: results.length, failed, results }, null, 2)}\n` : text);
  return failed > 0 ? 1 : 0;
}

function isDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** 작업 공간(디스크 --root 또는 --example 맵)에 그 파일·폴더가 있는지. 루트 밖이면 없는 것으로 본다. */
function pathExists(rel: string, kind: 'file' | 'dir', rootAbs: string | undefined, example: DemoWorkspace | undefined): boolean {
  const clean = normalizeRel(rel);
  const isRoot = clean === '' || clean === '.';
  if (example) {
    const keys = Object.keys(example.files);
    if (kind === 'file') return keys.includes(clean);
    return isRoot || keys.some((k) => k.startsWith(`${clean}/`));
  }
  if (!rootAbs) return false;
  try {
    const abs = path.resolve(rootAbs, clean);
    const rel = path.relative(rootAbs, abs);
    // Outside the root (".." prefix or a different drive) counts as missing.
    if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) return false;
    const st = fs.statSync(abs);
    return kind === 'file' ? st.isFile() : st.isDirectory();
  } catch {
    return false;
  }
}

function atOrAbove(sev: Severity, failOn: string): boolean {
  const rank: Record<string, number> = { error: 3, warning: 2, info: 1, none: 99 };
  return rank[sev] >= rank[failOn];
}

/** 파일·폴더 인자를 루트 기준 상대 경로로. 루트 밖이면 종료 2. */
function toRootRelative(arg: string, rootAbs: string | undefined, rootLabel: string, kind: 'file' | 'dir'): string {
  const outside = () =>
    kind === 'file'
      ? new CliError('cli.error.outsideRoot', { file: arg, root: rootLabel }, 'cli.hint.outsideRoot')
      : new CliError('cli.error.launchOutside', { dir: arg, root: rootLabel }, 'cli.hint.launchOutside');
  let rel: string;
  if (rootAbs) {
    const abs = path.isAbsolute(arg) ? arg : path.resolve(rootAbs, arg);
    rel = path.relative(rootAbs, abs).split(path.sep).join('/');
  } else {
    if (path.isAbsolute(arg)) throw outside();
    rel = path.posix.normalize(normalizeRel(arg) || '.');
  }
  if (rel === '..' || rel.startsWith('../') || path.isAbsolute(rel)) throw outside();
  return normalizeRel(rel);
}

function readOptions(values: Record<string, string | boolean | undefined>, rootAbs: string | undefined, rootLabel: string): ResolveOptions {
  const opts: ResolveOptions = { ...DEFAULT_OPTIONS };
  const agent = values.agent as string | undefined;
  if (agent !== undefined && agent !== 'all') {
    const list = agent.split(',').map((a) => a.trim()).filter((a) => a !== '');
    const bad = list.find((a) => !ALL_AGENTS.includes(a as AgentId));
    if (bad !== undefined || list.length === 0) throw new CliError('cli.error.badAgent', { value: bad ?? agent }, 'cli.hint.agent');
    opts.agents = list as AgentId[];
  }
  const mode = values['claude-instruction-files'] as string | undefined;
  if (mode !== undefined) {
    if (mode !== 'claude-md-or-agents-md' && mode !== 'claude-md-and-agents-md') throw new CliError('cli.error.badMode', { value: mode }, 'cli.hint.mode');
    opts.claudeInstructionFiles = mode as InstructionFilesMode;
  }
  const max = values['codex-max-bytes'] as string | undefined;
  if (max !== undefined) {
    if (!/^\d+$/.test(max) || Number(max) <= 0) throw new CliError('cli.error.badNumber', { value: max }, 'cli.hint.number');
    opts.codexMaxBytes = Number(max);
  }
  const launch = values['launch-dir'] as string | undefined;
  if (launch !== undefined) opts.launchDir = toRootRelative(launch, rootAbs, rootLabel, 'dir');
  return opts;
}

/** 사용자 수준 파일: 홈 전체를 훑지 않고 정해진 경로와 ~/.claude/rules 만 본다. */
function loadUserRules(geminiFileNames: string[]): RuleFile[] {
  const home = os.homedir();
  return scanUserFiles(diskReader(home), diskReader(path.join(home, '.claude', 'rules')), geminiFileNames);
}

function readExpectations(file: string, cwd: string, example: DemoWorkspace | undefined) {
  let text: string;
  // --example 이면 예제 맵 안의 기대 파일을 먼저 찾는다.
  const inExample = example?.files[normalizeRel(file)];
  if (inExample !== undefined) text = inExample;
  else {
    try {
      text = fs.readFileSync(path.resolve(cwd, file), 'utf8');
    } catch (e) {
      throw new CliError('cli.error.expectUnreadable', { file, error: errorCode(e) }, 'cli.hint.expectUnreadable');
    }
  }
  try {
    return parseExpectations(text);
  } catch (e) {
    if (e instanceof ExpectFormatError) throw new CliError('cli.error.expectFormat', { file, detail: e.message }, 'cli.hint.expectFormat');
    throw e;
  }
}

/** 연습용 작업 공간을 디스크에 푼다. 비어 있지 않은 폴더는 덮어쓰지 않는다. */
function writeDemo(dirArg: string, io: Io, t: Translate): number {
  const dir = path.resolve(io.cwd, dirArg);
  try {
    if (fs.existsSync(dir) && fs.readdirSync(dir).length > 0) throw new CliError('cli.error.writeNotEmpty', { dir: dirArg }, 'cli.hint.writeNotEmpty');
    const files = MIXED_MONOREPO.files;
    for (const [rel, text] of Object.entries(files)) {
      const target = path.join(dir, rel);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, text, 'utf8');
    }
    io.stdout(`${t('cli.demo.written', { count: Object.keys(files).length, dir: dirArg })}\n${t('cli.demo.writtenNext', { dir: dirArg })}\n`);
    return 0;
  } catch (e) {
    if (e instanceof CliError) throw e;
    throw new CliError('cli.error.writeFailed', { dir: dirArg, error: errorCode(e) }, 'cli.hint.writeFailed');
  }
}

if (require.main === module) {
  // 파이프가 먼저 닫혀도(| head) 트레이스백 없이 끝낸다.
  process.stdout.on('error', (e: NodeJS.ErrnoException) => {
    if (e.code === 'EPIPE') process.exit(0);
  });
  process.exitCode = run(process.argv.slice(2), {
    stdout: (s) => process.stdout.write(s),
    stderr: (s) => process.stderr.write(s),
    cwd: process.cwd(),
    env: process.env,
  });
}
