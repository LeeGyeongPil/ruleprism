// 작업 공간에서 규칙·지침 파일을 찾아 색인한다(이름·위치 규칙만 본다).
import { parseFrontMatter, type FrontMatter } from './frontmatter';
import { errorCode, type FsReader } from './fsreader';

export type RuleKind =
  | 'claude-md' // CLAUDE.md, .claude/CLAUDE.md
  | 'claude-local' // CLAUDE.local.md
  | 'claude-rule' // <dir>/.claude/rules/**/*.md
  | 'agents-md' // AGENTS.md
  | 'agents-override' // AGENTS.override.md
  | 'gemini-md' // GEMINI.md (이름은 설정)
  | 'copilot-repo' // .github/copilot-instructions.md
  | 'copilot-instructions' // .github/instructions/**/*.instructions.md
  | 'cursor-rule'; // <dir>/.cursor/rules/**/*.mdc|.md

export interface RuleFile {
  path: string;
  kind: RuleKind;
  /** 이 파일이 "속한" 폴더: 같은 폴더의 CLAUDE.md, `.claude`·`.cursor` 를 품은 폴더. '' = 루트. */
  dir: string;
  /** 읽은 내용. 읽기 실패면 undefined 이고 readError 가 있다. */
  text?: string;
  readError?: string;
  fm?: FrontMatter;
  /** 사용자 수준 파일(`~/…`)인가. */
  user?: boolean;
}

export interface RuleIndex {
  rules: RuleFile[];
  /** 작업 공간의 모든 파일(죽은 규칙·CodeLens 계산용). */
  files: string[];
  filesTruncated: boolean;
  gitDirs: string[];
  unreadableDirs: { dir: string; error: string }[];
}

function dirname(p: string): string {
  const i = p.lastIndexOf('/');
  return i < 0 ? '' : p.slice(0, i);
}

function basename(p: string): string {
  return p.slice(p.lastIndexOf('/') + 1);
}

/** 경로 하나가 어떤 규칙 파일인지 정한다. 아니면 undefined. */
export function classify(p: string, geminiFileNames: string[]): { kind: RuleKind; dir: string } | undefined {
  const name = basename(p);
  const parent = dirname(p);

  // `.claude/rules/**.md` — `.claude` 를 품은 폴더가 기준.
  const claudeRules = /^(?:(.*)\/)?\.claude\/rules\/.+\.md$/.exec(p);
  if (claudeRules) return { kind: 'claude-rule', dir: claudeRules[1] ?? '' };

  // `.cursor/rules/**.mdc|.md`
  const cursorRules = /^(?:(.*)\/)?\.cursor\/rules\/.+\.(mdc|md)$/.exec(p);
  if (cursorRules) return { kind: 'cursor-rule', dir: cursorRules[1] ?? '' };

  // Copilot 은 워크스페이스 루트의 `.github` 만 본다.
  if (p === '.github/copilot-instructions.md') return { kind: 'copilot-repo', dir: '' };
  if (/^\.github\/instructions\/.+\.instructions\.md$/.test(p)) return { kind: 'copilot-instructions', dir: '' };

  if (name === 'CLAUDE.md') {
    // `.claude/CLAUDE.md` 는 `.claude` 를 품은 폴더의 지침이다.
    if (basename(parent) === '.claude') return { kind: 'claude-md', dir: dirname(parent) };
    return { kind: 'claude-md', dir: parent };
  }
  if (name === 'CLAUDE.local.md') return { kind: 'claude-local', dir: parent };
  if (name === 'AGENTS.override.md') return { kind: 'agents-override', dir: parent };
  if (name === 'AGENTS.md') return { kind: 'agents-md', dir: parent };
  if (geminiFileNames.includes(name)) return { kind: 'gemini-md', dir: parent };
  return undefined;
}

/** 규칙 파일 하나를 읽어 앞머리까지 채운다. 읽기 실패는 예외 대신 readError 로 남긴다. */
export function loadRule(reader: FsReader, p: string, kind: RuleKind, dir: string): RuleFile {
  try {
    const text = reader.readText(p);
    const needsFm = kind === 'claude-rule' || kind === 'cursor-rule' || kind === 'copilot-instructions';
    return { path: p, kind, dir, text, fm: needsFm ? parseFrontMatter(text) : undefined };
  } catch (e) {
    return { path: p, kind, dir, readError: errorCode(e) };
  }
}

export function scanWorkspace(reader: FsReader, geminiFileNames: string[] = ['GEMINI.md']): RuleIndex {
  const listed = reader.list((p) => classify(p, geminiFileNames) !== undefined);
  const rules: RuleFile[] = [];
  for (const p of listed.files) {
    const c = classify(p, geminiFileNames);
    if (c) rules.push(loadRule(reader, p, c.kind, c.dir));
  }
  return {
    rules,
    files: listed.files,
    filesTruncated: listed.truncated,
    gitDirs: listed.gitDirs,
    unreadableDirs: listed.unreadableDirs,
  };
}

/**
 * 사용자 수준 파일(홈 폴더)을 색인한다.
 * homeReader 는 홈 폴더 기준으로 읽고, rulesReader 는 `~/.claude/rules` 만 나열한다(홈 전체를 훑지 않는다).
 * 없는 파일은 조용히 건너뛰고, 있는데 못 읽으면 readError 로 남긴다.
 */
export function scanUserFiles(homeReader: FsReader, rulesReader: FsReader | undefined, geminiFileNames: string[] = ['GEMINI.md']): RuleFile[] {
  const out: RuleFile[] = [];
  const tryLoad = (p: string, kind: RuleKind) => {
    const r = loadRule(homeReader, p, kind, '');
    if (r.readError === 'ENOENT' || r.readError === 'ENOTDIR') return;
    out.push({ ...r, path: `~/${p}`, user: true });
  };
  tryLoad('.claude/CLAUDE.md', 'claude-md');
  if (rulesReader) {
    for (const p of rulesReader.list().files) {
      if (p.endsWith('.md')) tryLoad(`.claude/rules/${p}`, 'claude-rule');
    }
  }
  tryLoad('.codex/AGENTS.override.md', 'agents-override');
  tryLoad('.codex/AGENTS.md', 'agents-md');
  for (const n of geminiFileNames) tryLoad(`.gemini/${n}`, 'gemini-md');
  return out;
}

/** 루트에서 dir 까지의 폴더 목록(둘 다 포함). '' = 루트. */
export function chainTo(dir: string): string[] {
  const out = [''];
  if (dir === '') return out;
  const parts = dir.split('/');
  for (let i = 1; i <= parts.length; i++) out.push(parts.slice(0, i).join('/'));
  return out;
}

/** a 가 b 의 조상이거나 같은가. */
export function isAncestorOrSelf(a: string, b: string): boolean {
  return a === '' || a === b || b.startsWith(`${a}/`);
}

export function fileDir(p: string): string {
  return dirname(p);
}

/** 근사 토큰: 문자 수 ÷ 4 올림. */
export function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
