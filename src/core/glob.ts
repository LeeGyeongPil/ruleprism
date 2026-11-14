// 도구별 글롭 의미. 같은 패턴이 도구마다 다르게 일치한다는 것이 이 확장의 핵심 교훈이다.
//
// Claude Code `.claude/rules` 의 paths (https://code.claude.com/docs/en/memory, 확인 2026-11-14)
//   - YAML 목록 또는 쉼표 문자열. 중괄호 확장 지원.
//   - 기준 폴더: `.claude` 를 품은 폴더.
//   - 슬래시 없는 패턴(`*.md`)은 모든 깊이에서 일치, 앞 `/` 는 기준 폴더에 고정.
// GitHub Copilot applyTo / Cursor globs
//   (https://code.visualstudio.com/docs/agents/reference/custom-instructions-reference,
//    https://cursor.com/docs/context/rules, 확인 2026-11-14)
//   - 쉼표로 구분한 패턴, 워크스페이스 루트 기준 일반 글롭. `*.py` 는 루트 파일만, `**/*.py` 가 재귀.
import picomatch from 'picomatch';

export type GlobFlavor = 'claude' | 'root';

/** 쉼표로 패턴을 나눈다. 중괄호 안의 쉼표(`*.{ts,tsx}`)는 나누지 않는다. */
export function splitPatterns(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap((v) => splitPatterns(v));
  if (value === undefined || value === null || value === false) return [];
  const s = String(value);
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '{') depth++;
    if (ch === '}') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((p) => p.trim()).filter((p) => p !== '');
}

/** Claude Code paths 의미: 슬래시 없으면 모든 깊이, 앞 `/` 는 고정. */
export function claudeMatch(pattern: string, relPath: string): boolean {
  let p = pattern.trim();
  if (p === '') return false;
  if (p.startsWith('/')) {
    p = p.slice(1);
    return picomatch(p, { dot: true })(relPath);
  }
  if (!p.includes('/')) return picomatch(p, { dot: true, basename: true })(relPath);
  return picomatch(p, { dot: true })(relPath);
}

/** Copilot·Cursor 의미: 루트 기준 일반 글롭. */
export function rootGlobMatch(pattern: string, relPath: string): boolean {
  const p = pattern.trim();
  if (p === '') return false;
  return picomatch(p, { dot: true })(relPath);
}

export function matchWith(flavor: GlobFlavor, pattern: string, relPath: string): boolean {
  return flavor === 'claude' ? claudeMatch(pattern, relPath) : rootGlobMatch(pattern, relPath);
}

/** 패턴 목록 중 처음 일치한 것을 돌려준다. */
export function firstMatch(flavor: GlobFlavor, patterns: string[], relPath: string): string | undefined {
  return patterns.find((p) => matchWith(flavor, p, relPath));
}

/** Copilot·Cursor 에서 루트 파일만 잡는 얕은 패턴인가(`*.ts`). `README.md` 같은 고정 이름은 의도로 보고 제외. */
export function isShallowRootPattern(pattern: string): boolean {
  const p = pattern.trim();
  if (p === '*' || p === '**' || p.includes('/')) return false;
  return p.includes('*');
}

/** `base` 폴더 기준 상대 경로. base 밖이면 undefined. */
export function relativeTo(base: string, relPath: string): string | undefined {
  if (base === '') return relPath;
  return relPath.startsWith(`${base}/`) ? relPath.slice(base.length + 1) : undefined;
}

export type ExplainKey =
  | 'claude-basename'
  | 'claude-anchored'
  | 'claude-path'
  | 'root-shallow'
  | 'root-path';

export interface ExplainRow {
  agent: 'claude' | 'copilot' | 'cursor';
  matches: boolean;
  /** 설명 문구 키(`explain.<key>`). */
  key: ExplainKey;
  doc: string;
}

export const DOCS = {
  claude: 'https://code.claude.com/docs/en/memory#path-specific-rules',
  copilot: 'https://code.visualstudio.com/docs/agents/reference/custom-instructions-reference',
  cursor: 'https://cursor.com/docs/context/rules',
  codex: 'https://learn.chatgpt.com/docs/agent-configuration/agents-md',
  gemini: 'https://geminicli.com/docs/cli/gemini-md/',
} as const;

/** 한 패턴이 한 파일에 도구별로 일치하는지와 그 이유. */
export function explainPattern(pattern: string, relPath: string): ExplainRow[] {
  const p = pattern.trim();
  const claudeKey: ExplainKey = p.startsWith('/') ? 'claude-anchored' : p.includes('/') ? 'claude-path' : 'claude-basename';
  const rootKey: ExplainKey = p.includes('/') ? 'root-path' : 'root-shallow';
  const root = rootGlobMatch(p, relPath);
  return [
    { agent: 'claude', matches: claudeMatch(p, relPath), key: claudeKey, doc: DOCS.claude },
    { agent: 'copilot', matches: root, key: rootKey, doc: DOCS.copilot },
    { agent: 'cursor', matches: root, key: rootKey, doc: DOCS.cursor },
  ];
}
