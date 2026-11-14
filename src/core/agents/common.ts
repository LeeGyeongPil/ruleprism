// 해석기들이 함께 쓰는 작은 도구: 판정 입력(Context)과 결과 모으기(Collector).
import type { RuleFile, RuleIndex, RuleKind } from '../scan';
import { approxTokens, chainTo, isAncestorOrSelf } from '../scan';
import type { AgentResult, Certainty, Entry, Ordering, ReasonCode, ResolveOptions, Skipped } from '../types';

export interface Context {
  index: RuleIndex;
  /** 사용자 수준 파일(`~/…`). CLI 는 --user 일 때만, 확장은 설정에 따라 채운다. */
  userRules: RuleFile[];
  /** 판정할 파일(루트 기준). */
  file: string;
  /** 그 파일이 든 폴더. */
  fileDir: string;
  opts: ResolveOptions;
}

export class Collector {
  private entries: Omit<Entry, 'order'>[] = [];
  private skipped: Skipped[] = [];
  private seen = new Set<string>();

  add(rule: RuleFile, reason: ReasonCode, certainty: Certainty, detail?: string, extra: Partial<Entry> = {}): void {
    // 같은 파일을 두 번 넣지 않는다(예: CLAUDE.md 가 조상 체인과 하위 체인 둘 다에 걸릴 때).
    if (this.seen.has(rule.path)) return;
    this.seen.add(rule.path);
    const text = ruleBody(rule);
    this.entries.push({ file: rule.path, reason, certainty, approxTokens: approxTokens(text), ...(detail !== undefined ? { detail } : {}), ...extra });
  }

  skip(rule: RuleFile, reason: ReasonCode, detail?: string): void {
    if (this.seen.has(rule.path)) return;
    this.seen.add(rule.path);
    this.skipped.push({ file: rule.path, reason, ...(detail !== undefined ? { detail } : {}) });
  }

  result(ordering: Ordering): AgentResult {
    const entries = this.entries.map((e, i) => ({ order: i + 1, ...e }));
    return { entries, skipped: this.skipped, approxTokens: entries.reduce((s, e) => s + e.approxTokens, 0), ordering };
  }
}

/** 문맥에 들어가는 본문: 앞머리가 정상이면 뺀 본문, 아니면 전체. */
export function ruleBody(rule: RuleFile): string {
  if (rule.fm) return rule.fm.body;
  return rule.text ?? '';
}

/** 읽을 수 있는 규칙 중 종류·폴더가 맞는 것(경로순). */
export function rulesAt(index: RuleIndex, kinds: RuleKind[], dir: string): RuleFile[] {
  return index.rules.filter((r) => kinds.includes(r.kind) && r.dir === dir && r.readError === undefined);
}

/** 루트 아래 폴더 이름 표기('' → '.'). */
export function dirLabel(dir: string): string {
  return dir === '' ? '.' : dir;
}

/**
 * Codex·Gemini 의 프로젝트 경계: dir 의 조상 중 `.git` 을 가진 가장 가까운 폴더.
 * 없으면 작업 공간 루트.
 */
export function projectRootOf(index: RuleIndex, dir: string): string {
  let best = '';
  for (const g of index.gitDirs) {
    if (isAncestorOrSelf(g, dir) && g.length >= best.length) best = g;
  }
  return best;
}

export function launchChain(ctx: Context): string[] {
  return chainTo(ctx.opts.launchDir);
}

export function fileChain(ctx: Context): string[] {
  return chainTo(ctx.fileDir);
}
