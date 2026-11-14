// Claude Code 해석기.
// 근거: https://code.claude.com/docs/en/memory (확인 2026-11-14)
//  - 작업 폴더와 그 위 폴더의 CLAUDE.md·.claude/CLAUDE.md·CLAUDE.local.md 는 시작할 때 로드,
//    루트 → 작업 폴더 순으로 이어 붙이고, 같은 폴더에서는 CLAUDE.local.md 가 뒤.
//  - 작업 폴더 아래 하위 폴더의 CLAUDE.md 는 그 폴더의 파일을 읽기·쓰기·고칠 때 로드(필요 시).
//  - .claude/rules/**/*.md: paths 없으면 시작 때 로드(.claude/CLAUDE.md 와 같은 우선순위),
//    paths 가 있으면 일치하는 파일을 다룰 때 로드. paths 는 YAML 목록 또는 쉼표 문자열.
//    YAML 이 깨지면 앞머리를 무시하고 paths 없는 규칙처럼 무조건 로드. paths 외 필드는 무시.
//  - AGENTS.md: 기본(claude-md-or-agents-md)은 작업 폴더·조상에 CLAUDE.md 류가 하나도 없을 때만 읽는다.
//    claude-md-and-agents-md 면 폴더마다 CLAUDE.md 다음에 AGENTS.md.
import { splitPatterns, claudeMatch, relativeTo } from '../glob';
import type { RuleFile } from '../scan';
import { isAncestorOrSelf } from '../scan';
import type { AgentResult, ReasonCode } from '../types';
import { Collector, type Context, dirLabel, fileChain, launchChain, rulesAt } from './common';

export type ClaudeRuleScope =
  | { scoped: false; reason: Extract<ReasonCode, 'rule-unconditional' | 'rule-yaml-error' | 'rule-globs-not-paths'> }
  | { scoped: true; patterns: string[] };

/** `.claude/rules` 파일 하나가 무조건 규칙인지, paths 범위 규칙인지. */
export function claudeRuleScope(rule: RuleFile): ClaudeRuleScope {
  const fm = rule.fm;
  if (!fm || !fm.present) return { scoped: false, reason: 'rule-unconditional' };
  if (fm.strictError) return { scoped: false, reason: 'rule-yaml-error' };
  const data = fm.data;
  if (data.paths === undefined || data.paths === null) {
    // 다른 도구 문법(globs·applyTo)만 있으면 Claude 는 무시하고 무조건 로드한다.
    if ('globs' in data || 'applyTo' in data) return { scoped: false, reason: 'rule-globs-not-paths' };
    return { scoped: false, reason: 'rule-unconditional' };
  }
  const patterns = splitPatterns(data.paths);
  if (patterns.length === 0) return { scoped: false, reason: 'rule-unconditional' };
  return { scoped: true, patterns };
}

/** 같은 폴더 안 순서: CLAUDE.md → .claude/CLAUDE.md. */
function claudeMdAt(ctx: Context, dir: string): RuleFile[] {
  return rulesAt(ctx.index, ['claude-md'], dir).sort((a, b) => a.path.length - b.path.length);
}

export function resolveClaude(ctx: Context): AgentResult {
  const c = new Collector();
  const { index, opts, file } = ctx;
  const launch = launchChain(ctx);
  // 작업 폴더 아래이면서 파일의 조상인 폴더 = 필요 시 로드 대상.
  const onDemand = fileChain(ctx).filter((d) => !launch.includes(d) && isAncestorOrSelf(opts.launchDir, d));
  const andMode = opts.claudeInstructionFiles === 'claude-md-and-agents-md';
  const hasClaudeInLaunch = launch.some((d) => rulesAt(index, ['claude-md', 'claude-local'], d).length > 0);
  const firstClaude = launch.flatMap((d) => rulesAt(index, ['claude-md', 'claude-local'], d))[0];

  // 0) 사용자 수준: ~/.claude/CLAUDE.md, ~/.claude/rules (paths 는 작업 폴더 기준)
  for (const r of ctx.userRules.filter((u) => u.readError === undefined)) {
    if (r.kind === 'claude-md') c.add(r, 'user-file', 'certain');
  }
  for (const r of ctx.userRules.filter((u) => u.readError === undefined && u.kind === 'claude-rule')) {
    const scope = claudeRuleScope(r);
    if (!scope.scoped) c.add(r, 'user-file', 'certain');
    else {
      const rel = relativeTo(opts.launchDir, file);
      const hit = rel !== undefined ? scope.patterns.find((p) => claudeMatch(p, rel)) : undefined;
      if (hit) c.add(r, 'paths-matched', 'conditional', hit);
    }
  }

  // 1) 시작 때: 루트 → 작업 폴더
  for (const d of launch) {
    for (const r of claudeMdAt(ctx, d)) c.add(r, 'launch-ancestor', 'certain', dirLabel(d));
    for (const r of rulesAt(index, ['claude-rule'], d)) {
      const scope = claudeRuleScope(r);
      if (!scope.scoped) c.add(r, scope.reason, 'certain');
    }
    for (const r of rulesAt(index, ['claude-local'], d)) c.add(r, 'launch-ancestor', 'certain', dirLabel(d));
    for (const r of rulesAt(index, ['agents-md'], d)) {
      if (andMode) c.add(r, 'agents-md-alongside', 'certain');
      else if (!hasClaudeInLaunch) c.add(r, 'agents-md-instead', 'certain');
      else c.skip(r, 'skip-agents-md-shadowed', firstClaude?.path);
    }
  }

  // 2) 필요 시: 작업 폴더 아래, 이 파일이 든 폴더까지
  for (const d of onDemand) {
    const own = [...claudeMdAt(ctx, d), ...rulesAt(index, ['claude-local'], d)];
    for (const r of own) c.add(r, 'on-demand-subdir', 'conditional', dirLabel(d));
    for (const r of rulesAt(index, ['claude-rule'], d)) {
      const scope = claudeRuleScope(r);
      if (!scope.scoped) c.add(r, 'on-demand-subdir', 'conditional', dirLabel(d));
    }
    for (const r of rulesAt(index, ['agents-md'], d)) {
      if (andMode) c.add(r, 'agents-md-alongside', 'conditional');
      // 기본 모드: 시작 체인에 CLAUDE.md 가 없고 그 폴더에도 CLAUDE.md 류가 없을 때만.
      else if (!hasClaudeInLaunch && own.length === 0) c.add(r, 'agents-md-instead', 'conditional');
      else c.skip(r, 'skip-agents-md-shadowed', (own[0] ?? firstClaude)?.path);
    }
  }

  // 3) paths 범위 규칙: 기준 폴더(.claude 를 품은 폴더) 기준 상대 경로로 맞춘다.
  for (const d of [...launch, ...onDemand]) {
    const rel = relativeTo(d, file);
    if (rel === undefined) continue;
    for (const r of rulesAt(index, ['claude-rule'], d)) {
      const scope = claudeRuleScope(r);
      if (!scope.scoped) continue;
      const hit = scope.patterns.find((p) => claudeMatch(p, rel));
      if (hit) c.add(r, 'paths-matched', 'conditional', hit);
    }
  }

  return c.result('context-order');
}
