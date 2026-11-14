// GitHub Copilot (VS Code) 해석기.
// 근거(확인 2026-11-14):
//  - https://code.visualstudio.com/docs/agents/reference/custom-instructions-reference
//  - https://code.visualstudio.com/docs/agents/reference/ai-settings
//    chat.useAgentsMdFile 기본 true(워크스페이스 루트 AGENTS.md), chat.useClaudeMdFile 기본 true
//    (루트 CLAUDE.md·.claude/CLAUDE.md·CLAUDE.local.md·~/.claude/CLAUDE.md, .claude/rules 의 paths 형식).
//  - .github/copilot-instructions.md 는 저장소 전체, .github/instructions/**/*.instructions.md 는
//    applyTo(쉼표로 구분한 패턴, 워크스페이스 루트 기준, 기본값 없음)가 일치할 때.
//  - 파일 사이에 우선순위가 없다 → 순서는 "병합"으로 표시.
//  - applyTo 를 YAML 목록으로 쓴 경우의 동작은 문서에 없다 → uncertain.
import { claudeMatch, rootGlobMatch, splitPatterns } from '../glob';
import type { AgentResult } from '../types';
import { claudeRuleScope } from './claude';
import { Collector, type Context, rulesAt } from './common';

export function resolveCopilot(ctx: Context): AgentResult {
  const c = new Collector();
  const { index, opts, file } = ctx;

  // 1) 저장소 전체 지침
  for (const r of rulesAt(index, ['copilot-repo'], '')) c.add(r, 'repo-wide', 'certain');

  // 2) 경로별 지침(.instructions.md 의 applyTo)
  for (const r of rulesAt(index, ['copilot-instructions'], '')) {
    const fm = r.fm;
    const raw = fm?.data.applyTo;
    if (!fm || !fm.closed || raw === undefined || raw === null || raw === '') {
      c.skip(r, 'skip-no-applyto');
      continue;
    }
    const patterns = splitPatterns(raw);
    const hit = patterns.find((p) => rootGlobMatch(p, file));
    if (!hit) continue;
    // 목록이거나 YAML 이 깨져 관대하게 읽은 경우는 실제로 붙는지 문서로 단정할 수 없다.
    if (Array.isArray(raw)) c.add(r, 'applyto-list-matched', 'uncertain', hit);
    else c.add(r, 'applyto-matched', fm.strictError ? 'uncertain' : 'certain', hit);
  }

  // 3) 워크스페이스 루트 AGENTS.md
  for (const r of rulesAt(index, ['agents-md'], '')) {
    if (opts.copilotUseAgentsMd) c.add(r, 'workspace-agents-md', 'certain');
    else c.skip(r, 'skip-setting-off', 'chat.useAgentsMdFile');
  }

  // 4) Claude 지침 파일(chat.useClaudeMdFile)
  const claudeFiles = [
    ...ctx.userRules.filter((u) => u.kind === 'claude-md' && u.readError === undefined),
    ...rulesAt(index, ['claude-md', 'claude-local'], ''),
  ];
  for (const r of claudeFiles) {
    if (opts.copilotUseClaudeMd) c.add(r, r.user ? 'user-file' : 'workspace-claude-md', 'certain');
    else c.skip(r, 'skip-setting-off', 'chat.useClaudeMdFile');
  }
  if (opts.copilotUseClaudeMd) {
    for (const r of rulesAt(index, ['claude-rule'], '')) {
      const scope = claudeRuleScope(r);
      if (!scope.scoped) c.add(r, 'claude-rule-in-copilot', 'uncertain');
      else {
        const hit = scope.patterns.find((p) => claudeMatch(p, file));
        if (hit) c.add(r, 'claude-rule-paths-in-copilot', 'uncertain', hit);
      }
    }
  }

  return c.result('merged');
}
