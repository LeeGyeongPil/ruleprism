// CLI 출력: 사람이 읽는 표와 JSON(schemaVersion 1).
import type { CaseResult } from '../core/expect';
import type { ExplainRow } from '../core/glob';
import type { AgentId, Diagnostic, Resolution, Severity } from '../core/types';
import { ALL_AGENTS } from '../core/types';
import type { Translate } from '../i18n/i18n';
import { CERTAINTY_MARK, diagnosticMessage, reasonText } from '../view/model';

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

export function renderWhich(res: Resolution, t: Translate, warnings: Diagnostic[]): string {
  const lines: string[] = [];
  lines.push(t('cli.which.title', { file: res.file, launch: res.launchDir === '' ? '.' : res.launchDir }));
  for (const agent of ALL_AGENTS) {
    const r = res.agents[agent];
    if (!r) continue;
    lines.push('');
    lines.push(t(r.entries.length === 1 ? 'cli.which.agentLine.one' : 'cli.which.agentLine', { agent: t(`agent.${agent}`), count: r.entries.length, tokens: r.approxTokens, ordering: t(`ordering.${r.ordering}`) }));
    if (r.entries.length === 0) lines.push(t('cli.which.none'));
    const width = Math.max(0, ...r.entries.map((e) => e.file.length));
    const tokWidth = Math.max(0, ...r.entries.map((e) => t('entry.tokens', { n: e.approxTokens }).length));
    for (const e of r.entries) {
      const tok = pad(t('entry.tokens', { n: e.approxTokens }), tokWidth);
      const cut = e.truncated ? ` (${t('entry.truncated', { max: e.detail ?? '' })})` : '';
      lines.push(`  ${String(e.order).padStart(2)}. [${CERTAINTY_MARK[e.certainty]}] ${pad(e.file, width)}  ${tok}  ${reasonText(e, t)}${cut}`);
    }
    for (const s of r.skipped) lines.push(t('cli.which.skipped', { file: s.file, reason: reasonText(s, t) }));
  }
  lines.push('');
  lines.push(t('cli.which.legend'));
  if (warnings.length > 0) {
    lines.push('');
    lines.push(t('cli.which.warnings'));
    for (const d of warnings) lines.push(`  ${d.file}:${d.line}  ${d.code}  ${diagnosticMessage(d, t)}`);
  }
  return `${lines.join('\n')}\n`;
}

export function whichJson(res: Resolution, root: string, warnings: Diagnostic[], t: Translate): unknown {
  return {
    schemaVersion: 1,
    root,
    file: res.file,
    launchDir: res.launchDir,
    agents: res.agents,
    warnings: warnings.map((d) => diagJson(d, t)),
  };
}

export function diagJson(d: Diagnostic, t: Translate): unknown {
  return {
    code: d.code,
    severity: d.severity,
    file: d.file,
    line: d.line,
    message: diagnosticMessage(d, t),
    ...(d.fix ? { fix: { title: t(d.fix.titleKey), startLine: d.fix.startLine, endLine: d.fix.endLine, newText: d.fix.newText } } : {}),
  };
}

export function renderLint(diags: Diagnostic[], t: Translate): string {
  if (diags.length === 0) return `${t('cli.lint.clean')}\n`;
  const lines: string[] = [];
  for (const d of diags) {
    lines.push(`${d.file}:${d.line}  ${d.code}  ${t(`severity.${d.severity}`)}  ${diagnosticMessage(d, t)}`);
    if (d.fix) lines.push(t('cli.lint.fix', { title: t(d.fix.titleKey), text: d.fix.newText }));
  }
  const count = (s: Severity) => diags.filter((d) => d.severity === s).length;
  lines.push('');
  lines.push(t('cli.lint.summary', { count: diags.length, errors: count('error'), warnings: count('warning'), infos: count('info') }));
  return `${lines.join('\n')}\n`;
}

export function renderExplain(pattern: string, file: string, rows: ExplainRow[], t: Translate): string {
  const lines = [t('cli.explain.title', { pattern, file }), ''];
  const width = Math.max(...rows.map((r) => t(`agent.${r.agent}`).length));
  for (const r of rows) {
    const mark = r.matches ? '✔' : '✘';
    const verdict = r.matches ? t('cli.explain.match') : t('cli.explain.nomatch');
    lines.push(`  ${mark} ${pad(t(`agent.${r.agent}`), width)}  ${verdict} — ${t(`explain.${r.key}`)}`);
    lines.push(`    ${r.doc}`);
  }
  return `${lines.join('\n')}\n`;
}

export function renderCheck(results: CaseResult[], t: Translate): { text: string; failed: number } {
  const lines: string[] = [];
  let failed = 0;
  for (const r of results) {
    const { file, agent } = r.case;
    if (r.missing.length === 0 && r.unexpected.length === 0) {
      lines.push(t('cli.check.ok', { file, agent }));
      continue;
    }
    failed++;
    for (const rule of r.missing) lines.push(t('cli.check.missing', { file, agent, rule }));
    for (const rule of r.unexpected) lines.push(t('cli.check.unexpected', { file, agent, rule }));
  }
  lines.push('');
  lines.push(t('cli.check.summary', { passed: results.length - failed, total: results.length }));
  return { text: `${lines.join('\n')}\n`, failed };
}

/** Which agent a diagnostic is about; undefined = every agent. */
function diagnosticAgent(d: Diagnostic): AgentId | undefined {
  switch (d.msgId) {
    case 'diag.RP001':
    case 'diag.RP002.copilot':
    case 'diag.RP004.copilot':
      return 'copilot';
    case 'diag.RP002.cursor':
    case 'diag.RP003':
    case 'diag.RP004.cursor':
      return 'cursor';
    case 'diag.RP004.claude':
    case 'diag.RP005':
    case 'diag.RP009':
      return 'claude';
    case 'diag.RP006':
      return 'codex';
    default:
  }
  if (d.code === 'RP007') {
    if (/(^|\/)\.claude\/rules\//.test(d.file)) return 'claude';
    if (d.file.startsWith('.github/instructions/')) return 'copilot';
    if (/(^|\/)\.cursor\/rules\//.test(d.file)) return 'cursor';
  }
  return undefined;
}

/** which 결과에 관련된 경고만 고른다: 선택한 에이전트의 목록에 나온 파일의 진단 + 읽기 실패·잘림 안내. */
export function warningsFor(res: Resolution, diags: Diagnostic[]): Diagnostic[] {
  const files = new Set<string>();
  const selected = Object.keys(res.agents) as AgentId[];
  for (const a of selected) {
    for (const e of res.agents[a]!.entries) files.add(e.file);
  }
  return diags.filter((d) => {
    if (d.code === 'RP008' || d.code === 'RP010') return true;
    if (!files.has(d.file)) return false;
    const agent = diagnosticAgent(d);
    return agent === undefined || selected.includes(agent);
  });
}
