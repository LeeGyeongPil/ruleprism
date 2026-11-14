// 빠른 수정(RP001·RP002) 텍스트 편집 만들기. 줄 단위로 바꾼다.
import type { RuleFile } from './scan';
import type { TextFix } from './types';

function lineAt(text: string, line: number): string {
  return text.split(/\r?\n/)[line - 1] ?? '';
}

/** RP001: `applyTo: [...]`(한 줄 또는 블록 목록) → `applyTo: "a, b"`. */
export function applyToListFix(rule: RuleFile, patterns: string[]): TextFix | undefined {
  const fm = rule.fm;
  const start = fm?.keyLines.applyTo;
  const end = fm?.keyEndLines.applyTo;
  if (!start || !end) return undefined;
  return { titleKey: 'fix.RP001', startLine: start, endLine: end, newText: `applyTo: "${patterns.join(', ')}"` };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 패턴이 들어 있는 줄을 키 줄 ~ 키 끝 줄 사이에서 찾는다. */
export function findPatternLine(rule: RuleFile, key: string, pattern: string): number | undefined {
  const fm = rule.fm;
  const start = fm?.keyLines[key];
  const end = fm?.keyEndLines[key] ?? start;
  if (!start || !end || rule.text === undefined) return undefined;
  const re = patternRegExp(pattern);
  for (let l = start; l <= end; l++) if (re.test(lineAt(rule.text, l))) return l;
  return start;
}

/** 다른 패턴의 일부가 아닌, 따옴표·쉼표·괄호·공백으로 둘러싸인 패턴만 잡는다. */
function patternRegExp(pattern: string): RegExp {
  return new RegExp(`(^|[\\s"'\\[,:])${escapeRegExp(pattern)}(?=$|[\\s"'\\],])`);
}

/** RP002: 그 줄의 `*.ts` 를 `**\/*.ts` 로. */
export function shallowPatternFix(rule: RuleFile, key: string, pattern: string): TextFix | undefined {
  const line = findPatternLine(rule, key, pattern);
  if (!line || rule.text === undefined) return undefined;
  const original = lineAt(rule.text, line);
  const re = new RegExp(patternRegExp(pattern).source, 'g');
  const newText = original.replace(re, (_m, pre: string) => `${pre}**/${pattern}`);
  if (newText === original) return undefined;
  return { titleKey: 'fix.RP002', startLine: line, endLine: line, newText };
}

/** 편집을 텍스트에 적용한다(테스트·CLI 미리보기용). 확장은 VS Code WorkspaceEdit 로 같은 일을 한다. */
export function applyFix(text: string, fix: TextFix): string {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  lines.splice(fix.startLine - 1, fix.endLine - fix.startLine + 1, ...fix.newText.split('\n'));
  return lines.join(eol);
}
