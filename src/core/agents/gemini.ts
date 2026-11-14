// Gemini CLI 해석기.
// 근거(확인 2026-11-14):
//  - https://geminicli.com/docs/cli/gemini-md/
//  - https://geminicli.com/docs/reference/configuration/ (context.fileName, context.memoryBoundaryMarkers)
//  - ~/.gemini/GEMINI.md → 작업 폴더와 그 조상의 GEMINI.md(`.git` 이 있는 폴더에서 멈춤)
//    → 도구가 파일을 다룰 때 그 파일 폴더와 조상을 JIT 로 찾아 로드.
//  - 파일 이름은 context.fileName 으로 바꿀 수 있다(ruleprism.gemini.fileNames).
import { chainTo, isAncestorOrSelf } from '../scan';
import type { AgentResult } from '../types';
import { Collector, type Context, dirLabel, projectRootOf, rulesAt } from './common';

export function resolveGemini(ctx: Context): AgentResult {
  const c = new Collector();
  const { index, opts } = ctx;
  // 같은 폴더에 여러 이름이 있으면 설정 순서대로.
  const at = (d: string) =>
    rulesAt(index, ['gemini-md'], d).sort(
      (a, b) => opts.geminiFileNames.indexOf(a.path.split('/').pop()!) - opts.geminiFileNames.indexOf(b.path.split('/').pop()!),
    );

  // 0) 사용자 수준
  for (const r of ctx.userRules.filter((u) => u.kind === 'gemini-md' && u.readError === undefined)) c.add(r, 'user-file', 'certain');

  // 1) 시작 때: 경계(.git) ~ 작업 폴더
  const launchBoundary = projectRootOf(index, opts.launchDir);
  const launch = chainTo(opts.launchDir).filter((d) => isAncestorOrSelf(launchBoundary, d));
  for (const d of launch) for (const r of at(d)) c.add(r, 'gemini-launch', 'certain', dirLabel(d));

  // 2) JIT: 파일 폴더와 그 조상(파일 쪽 경계까지) 중 아직 안 읽은 곳
  const fileBoundary = projectRootOf(index, ctx.fileDir);
  for (const d of chainTo(ctx.fileDir)) {
    if (launch.includes(d) || !isAncestorOrSelf(fileBoundary, d)) continue;
    for (const r of at(d)) c.add(r, 'gemini-jit', 'conditional', dirLabel(d));
  }

  return c.result('context-order');
}
