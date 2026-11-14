// Codex 해석기.
// 근거: https://learn.chatgpt.com/docs/agent-configuration/agents-md (확인 2026-11-14,
//       developers.openai.com/codex/guides/agents-md 에서 이동)
//  - ~/.codex 의 AGENTS.override.md 또는 AGENTS.md 중 첫 비어 있지 않은 것.
//  - 프로젝트 루트(보통 git 루트)에서 작업 폴더까지 내려가며 폴더당 최대 1개
//    (AGENTS.override.md → AGENTS.md). 작업 폴더 아래 하위 폴더는 읽지 않는다.
//  - 합계 project_doc_max_bytes(기본 32 KiB)를 넘는 부분은 잘린다.
import type { RuleFile } from '../scan';
import { chainTo, isAncestorOrSelf } from '../scan';
import type { AgentResult } from '../types';
import { Collector, type Context, fileChain, projectRootOf, rulesAt } from './common';

function byteLength(s: string): number {
  return Buffer.byteLength(s, 'utf8');
}

/** 한 폴더에서 Codex 가 고르는 파일과, 그 때문에 빠지는 파일. */
export function codexPick(files: RuleFile[]): { picked?: RuleFile; skipped: { rule: RuleFile; why: 'skip-override' | 'skip-empty' }[] } {
  const ordered = [...files.filter((r) => r.kind === 'agents-override'), ...files.filter((r) => r.kind === 'agents-md')];
  const skipped: { rule: RuleFile; why: 'skip-override' | 'skip-empty' }[] = [];
  let picked: RuleFile | undefined;
  for (const r of ordered) {
    if (picked) skipped.push({ rule: r, why: 'skip-override' });
    else if ((r.text ?? '').trim() === '') skipped.push({ rule: r, why: 'skip-empty' });
    else picked = r;
  }
  return { picked, skipped };
}

/** 프로젝트 루트 → 작업 폴더 체인. */
export function codexChain(ctx: Pick<Context, 'index'>, launchDir: string): string[] {
  const projectRoot = projectRootOf(ctx.index, launchDir);
  return chainTo(launchDir).filter((d) => isAncestorOrSelf(projectRoot, d));
}

export function resolveCodex(ctx: Context): AgentResult {
  const c = new Collector();
  const { index, opts } = ctx;

  // 0) 사용자 수준(~/.codex): 합계 상한은 프로젝트 문서에만 적용한다.
  const user = codexPick(ctx.userRules.filter((u) => u.readError === undefined && (u.kind === 'agents-md' || u.kind === 'agents-override')));
  if (user.picked) c.add(user.picked, 'user-file', 'certain');

  // 1) 프로젝트 루트 → 작업 폴더, 폴더당 1개, 합계 상한
  const chain = codexChain(ctx, opts.launchDir);
  let used = 0;
  for (const d of chain) {
    const { picked, skipped } = codexPick(rulesAt(index, ['agents-override', 'agents-md'], d));
    if (picked) {
      const bytes = byteLength(picked.text ?? '');
      if (used >= opts.codexMaxBytes) c.skip(picked, 'skip-truncated', String(opts.codexMaxBytes));
      else if (used + bytes > opts.codexMaxBytes) {
        // 남은 바이트만큼만 들어간다(근사 토큰도 그만큼).
        const kept = opts.codexMaxBytes - used;
        c.add(picked, 'codex-chain', 'certain', String(opts.codexMaxBytes), { truncated: true, approxTokens: Math.ceil(kept / 4) });
      } else c.add(picked, 'codex-chain', 'certain');
      used += bytes;
    }
    for (const s of skipped) c.skip(s.rule, s.why, picked?.path);
  }

  // 2) 체인 밖(작업 폴더 아래 등)에 있는 이 파일 조상 폴더의 AGENTS.md 는 읽지 않는다 — 이유로 보여 준다.
  for (const d of fileChain(ctx)) {
    if (chain.includes(d)) continue;
    for (const r of rulesAt(index, ['agents-override', 'agents-md'], d)) c.skip(r, 'skip-not-in-chain', opts.launchDir === '' ? '.' : opts.launchDir);
  }

  return c.result('context-order');
}
