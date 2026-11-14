// 확장 화면 모델: 트리 노드·상태 표시줄 문구·CodeLens 문구를 만드는 순수 함수.
// vscode 를 import 하지 않으므로 vitest 로 바로 검증하고, 정적 미리보기도 같은 함수를 쓴다.
import type { RuleMatchInfo } from '../core/diagnostics';
import type { AgentId, Certainty, Diagnostic, Entry, Resolution } from '../core/types';
import { ALL_AGENTS } from '../core/types';
import type { Translate } from '../i18n/i18n';

export const AGENT_SHORT: Record<AgentId, string> = { claude: 'C', copilot: 'Cp', cursor: 'Cu', codex: 'Cx', gemini: 'G' };
export const CERTAINTY_MARK: Record<Certainty, string> = { certain: '=', conditional: '~', uncertain: '?' };

export interface TreeNode {
  id: string;
  kind: 'agent' | 'entry' | 'skipped';
  label: string;
  description?: string;
  tooltip?: string;
  /** 클릭하면 열 파일(루트 기준, 사용자 파일은 `~/…`). */
  file?: string;
  certainty?: Certainty;
  children?: TreeNode[];
}

/** 이유 코드 + 세부 → 사람이 읽는 문구. */
export function reasonText(e: { reason: string; detail?: string }, t: Translate): string {
  return t(`reason.${e.reason}`, { detail: e.detail ?? '' });
}

export function entryDescription(e: Entry, t: Translate): string {
  const parts = [reasonText(e, t), t('entry.tokens', { n: e.approxTokens })];
  if (e.truncated) parts.push(t('entry.truncated', { max: e.detail ?? '' }));
  return parts.join(' · ');
}

/** 에이전트 › 항목 트리. 빠진 파일도 이유와 함께 보여 준다. */
export function buildTree(res: Resolution, t: Translate): TreeNode[] {
  const nodes: TreeNode[] = [];
  for (const agent of ALL_AGENTS) {
    const r = res.agents[agent];
    if (!r) continue;
    const children: TreeNode[] = r.entries.map((e) => ({
      id: `${agent}:${e.file}`,
      kind: 'entry',
      label: `${e.order}. ${e.file}`,
      description: entryDescription(e, t),
      tooltip: `${reasonText(e, t)}\n${t('view.tooltip.certainty', { certainty: t(`certainty.${e.certainty}`) })}`,
      file: e.file,
      certainty: e.certainty,
    }));
    for (const s of r.skipped) {
      children.push({
        id: `${agent}:skipped:${s.file}`,
        kind: 'skipped',
        label: `${t('entry.skipped')}: ${s.file}`,
        description: reasonText(s, t),
        tooltip: reasonText(s, t),
        file: s.file,
      });
    }
    nodes.push({
      id: agent,
      kind: 'agent',
      label: t(`agent.${agent}`),
      description: t(r.entries.length === 1 ? 'view.agentDescription.one' : 'view.agentDescription', { count: r.entries.length, tokens: r.approxTokens, ordering: t(`ordering.${r.ordering}`) }),
      children,
    });
  }
  return nodes;
}

/** `C5 Cp3 Cu2 Cx1 G2` */
export function statusSummary(res: Resolution): string {
  return ALL_AGENTS.filter((a) => res.agents[a])
    .map((a) => `${AGENT_SHORT[a]}${res.agents[a]!.entries.length}`)
    .join(' ');
}

export function statusText(res: Resolution, t: Translate): string {
  return t('view.status', { summary: statusSummary(res) });
}

/** 규칙 파일 맨 위 CodeLens 문구. 규칙 파일이 아니면 undefined. */
export function codeLensText(info: RuleMatchInfo | undefined, t: Translate): string | undefined {
  if (!info) return undefined;
  if (!info.scoped) return info.count > 0 ? t('view.codelens.always') : t('view.codelens.manual');
  if (info.count === 0) return t('view.codelens.dead');
  return info.approximate ? t('view.codelens.scopedApprox', { count: info.count }) : t('view.codelens.scoped', { count: info.count });
}

export function diagnosticMessage(d: Diagnostic, t: Translate): string {
  return t(d.msgId, d.args);
}
