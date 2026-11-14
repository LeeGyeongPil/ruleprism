// Cursor 해석기.
// 근거: https://cursor.com/docs/context/rules (확인 2026-11-14)
//  - .cursor/rules/**/*.mdc 의 앞머리 조합으로 4종:
//    alwaysApply: true → 항상(globs·description 무시) / globs → 파일이 일치할 때 /
//    description 만 → 에이전트가 판단(요청형, "maybe") / 둘 다 없음 → 수동(@멘션)이라 자동으로 붙지 않음.
//  - globs 는 쉼표 구분, 루트 기준 글롭. 앞머리 없는 .md 는 규칙 시스템이 무시.
//  - 루트·하위 AGENTS.md 를 읽고, 가까운 파일이 우선.
//  - 하위 폴더 .cursor/rules 의 동작은 공식 문서에 없고 포럼 보고가 엇갈린다
//    (https://forum.cursor.com/t/nested-cursor-rules-subdirectories/110303) → uncertain.
import { relativeTo, rootGlobMatch, splitPatterns } from '../glob';
import type { RuleFile } from '../scan';
import type { AgentResult, Certainty, ReasonCode } from '../types';
import { Collector, type Context, fileChain, rulesAt } from './common';

export type CursorMode =
  | { mode: 'always' }
  | { mode: 'globs'; patterns: string[] }
  | { mode: 'requested' }
  | { mode: 'manual' }
  | { mode: 'ignored' };

/** Cursor 규칙 한 개의 적용 방식. 엄격 YAML 이 실패하면 관대한 파서 결과를 쓴다. */
export function cursorRuleMode(rule: RuleFile): CursorMode {
  const fm = rule.fm;
  if (!fm || !fm.present || !fm.closed) return rule.path.endsWith('.md') ? { mode: 'ignored' } : { mode: 'manual' };
  const d = fm.data;
  if (d.alwaysApply === true || d.alwaysApply === 'true') return { mode: 'always' };
  const patterns = splitPatterns(d.globs);
  if (patterns.length > 0) return { mode: 'globs', patterns };
  if (typeof d.description === 'string' && d.description.trim() !== '') return { mode: 'requested' };
  return { mode: 'manual' };
}

export function resolveCursor(ctx: Context): AgentResult {
  const c = new Collector();
  const { index, file } = ctx;
  const chain = fileChain(ctx);

  for (const d of chain) {
    const rel = relativeTo(d, file);
    if (rel === undefined) continue;
    // 루트가 아닌 폴더의 .cursor/rules 는 문서에 없는 동작이라 확실성을 낮춘다.
    const nested = d !== '';
    const sure = (base: Certainty): Certainty => (nested ? 'uncertain' : base);
    for (const r of rulesAt(index, ['cursor-rule'], d)) {
      const m = cursorRuleMode(r);
      let reason: ReasonCode | undefined;
      let detail: string | undefined;
      let certainty: Certainty = 'certain';
      if (m.mode === 'always') reason = 'always-apply';
      else if (m.mode === 'globs') {
        const hit = m.patterns.find((p) => rootGlobMatch(p, rel));
        if (hit) {
          reason = 'globs-matched';
          detail = hit;
        }
      } else if (m.mode === 'requested') {
        reason = 'agent-requested';
        certainty = 'uncertain';
      } else if (m.mode === 'manual') c.skip(r, 'skip-manual');
      if (reason) c.add(r, reason, sure(certainty), detail);
    }
  }

  // AGENTS.md: 루트 → 파일 폴더. 뒤(가까운 것)가 우선.
  for (const d of chain) {
    for (const r of rulesAt(index, ['agents-md'], d)) c.add(r, 'cursor-agents-md', 'certain', d === '' ? '.' : d);
  }

  return c.result('merged');
}
