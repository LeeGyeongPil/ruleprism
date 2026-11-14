// 진단 RP001–RP009: 규칙이 "조용히" 엉뚱하게 붙거나 안 붙는 설정을 찾는다.
// 모든 진단은 적용 판정에서 나온다(일반 문법 린트는 범위 밖).
import { claudeRuleScope } from './agents/claude';
import { codexChain, codexPick } from './agents/codex';
import { cursorRuleMode } from './agents/cursor';
import { claudeMatch, isShallowRootPattern, relativeTo, rootGlobMatch, splitPatterns } from './glob';
import { applyToListFix, findPatternLine, shallowPatternFix } from './fixes';
import type { RuleFile, RuleIndex } from './scan';
import { chainTo } from './scan';
import { DEFAULT_MAX_FILES } from './fsreader';
import { DEFAULT_OPTIONS, type Diagnostic, type ResolveOptions } from './types';

/** 범위 규칙이 작업 공간의 몇 개 파일에 일치하는가. 무조건 규칙이면 scoped=false. */
export interface RuleMatchInfo {
  scoped: boolean;
  /** 범위를 정하는 앞머리 키(paths·applyTo·globs). */
  key?: string;
  count: number;
  /** 파일 목록이 상한에서 잘려 정확하지 않을 수 있다. */
  approximate: boolean;
}

/** CodeLens 와 RP007 이 함께 쓰는 "이 규칙이 붙는 파일 수" 계산. 규칙 파일이 아니면 undefined. */
export function ruleMatches(index: RuleIndex, rule: RuleFile): RuleMatchInfo | undefined {
  if (rule.readError !== undefined) return undefined;
  const approximate = index.filesTruncated;
  const count = (test: (f: string) => boolean) => index.files.filter(test).length;
  if (rule.kind === 'claude-rule') {
    const scope = claudeRuleScope(rule);
    if (!scope.scoped) return { scoped: false, count: index.files.length, approximate };
    return {
      scoped: true,
      key: 'paths',
      approximate,
      count: count((f) => {
        const rel = relativeTo(rule.dir, f);
        return rel !== undefined && scope.patterns.some((p) => claudeMatch(p, rel));
      }),
    };
  }
  if (rule.kind === 'copilot-instructions') {
    const raw = rule.fm?.closed ? rule.fm.data.applyTo : undefined;
    const patterns = splitPatterns(raw);
    // applyTo 가 없으면 자동으로 붙지 않는다(수동 첨부).
    if (patterns.length === 0) return { scoped: false, count: 0, approximate };
    return { scoped: true, key: 'applyTo', approximate, count: count((f) => patterns.some((p) => rootGlobMatch(p, f))) };
  }
  if (rule.kind === 'cursor-rule') {
    const m = cursorRuleMode(rule);
    if (m.mode !== 'globs') return { scoped: false, count: m.mode === 'always' ? index.files.length : 0, approximate };
    return {
      scoped: true,
      key: 'globs',
      approximate,
      count: count((f) => {
        const rel = relativeTo(rule.dir, f);
        return rel !== undefined && m.patterns.some((p) => rootGlobMatch(p, rel));
      }),
    };
  }
  return undefined;
}

export function computeDiagnostics(index: RuleIndex, options: Partial<ResolveOptions> = {}): Diagnostic[] {
  const opts: ResolveOptions = { ...DEFAULT_OPTIONS, ...options };
  const out: Diagnostic[] = [];
  const readable = index.rules.filter((r) => r.readError === undefined);

  // RP008 규칙 파일·폴더를 읽지 못함
  for (const r of index.rules) {
    if (r.readError !== undefined) out.push({ code: 'RP008', severity: 'warning', file: r.path, line: 1, msgId: 'diag.RP008', args: { error: r.readError } });
  }
  for (const d of index.unreadableDirs) {
    out.push({ code: 'RP008', severity: 'warning', file: d.dir === '' ? '.' : d.dir, line: 1, msgId: 'diag.RP008.dir', args: { error: d.error } });
  }

  // RP010 파일 수 상한에 걸림 — 규칙 파일은 모두 찾았지만 죽은 규칙·개수 계산은 근사값이다.
  if (index.filesTruncated) {
    out.push({ code: 'RP010', severity: 'info', file: '.', line: 1, msgId: 'diag.RP010', args: { max: DEFAULT_MAX_FILES } });
  }

  for (const r of readable) {
    const fm = r.fm;
    // RP004 앞머리가 엄격 YAML 이 아님(또는 닫히지 않음) — 도구마다 결과가 다르다.
    if (fm?.strictError) {
      const args = { error: fm.strictError.message };
      if (r.kind === 'claude-rule') out.push({ code: 'RP004', severity: 'warning', file: r.path, line: fm.strictError.line, msgId: 'diag.RP004.claude', args });
      if (r.kind === 'copilot-instructions') out.push({ code: 'RP004', severity: 'warning', file: r.path, line: fm.strictError.line, msgId: 'diag.RP004.copilot', args });
      if (r.kind === 'cursor-rule') out.push({ code: 'RP004', severity: 'info', file: r.path, line: fm.strictError.line, msgId: 'diag.RP004.cursor', args });
    }

    if (r.kind === 'copilot-instructions' && fm?.closed) {
      const raw = fm.data.applyTo;
      const patterns = splitPatterns(raw);
      // RP001 applyTo 가 YAML 목록
      if (Array.isArray(raw) && !fm.strictError) {
        out.push({ code: 'RP001', severity: 'warning', file: r.path, line: fm.keyLines.applyTo ?? 1, msgId: 'diag.RP001', args: {}, fix: applyToListFix(r, patterns) });
      }
      // RP002 슬래시 없는 와일드카드 패턴 = 루트 파일만
      for (const p of patterns.filter(isShallowRootPattern)) {
        out.push({ code: 'RP002', severity: 'warning', file: r.path, line: findPatternLine(r, 'applyTo', p) ?? 1, msgId: 'diag.RP002.copilot', args: { pattern: p }, fix: shallowPatternFix(r, 'applyTo', p) });
      }
    }

    if (r.kind === 'cursor-rule' && fm?.closed) {
      const m = cursorRuleMode(r);
      const globs = splitPatterns(fm.data.globs);
      // RP003 alwaysApply 와 globs 동시 지정 → globs 무시
      if (m.mode === 'always' && globs.length > 0) {
        out.push({ code: 'RP003', severity: 'warning', file: r.path, line: fm.keyLines.globs ?? fm.keyLines.alwaysApply ?? 1, msgId: 'diag.RP003', args: {} });
      }
      if (m.mode === 'globs') {
        for (const p of m.patterns.filter(isShallowRootPattern)) {
          out.push({ code: 'RP002', severity: 'info', file: r.path, line: findPatternLine(r, 'globs', p) ?? 1, msgId: 'diag.RP002.cursor', args: { pattern: p }, fix: shallowPatternFix(r, 'globs', p) });
        }
      }
    }

    // RP009 Claude 규칙에 paths 대신 globs·applyTo
    if (r.kind === 'claude-rule') {
      const scope = claudeRuleScope(r);
      if (!scope.scoped && scope.reason === 'rule-globs-not-paths') {
        const key = 'globs' in (fm?.data ?? {}) ? 'globs' : 'applyTo';
        out.push({ code: 'RP009', severity: 'warning', file: r.path, line: fm?.keyLines[key] ?? 1, msgId: 'diag.RP009', args: { key } });
      }
    }

    // RP007 작업 공간의 어떤 파일에도 일치하지 않는 범위 규칙(죽은 규칙)
    const m = ruleMatches(index, r);
    if (m?.scoped && m.key && m.count === 0 && splitPatterns(fm?.data[m.key]).length > 0) {
      out.push({
        code: 'RP007',
        severity: m.approximate ? 'info' : 'warning',
        file: r.path,
        line: fm?.keyLines[m.key] ?? 1,
        msgId: m.approximate ? 'diag.RP007.approx' : 'diag.RP007',
        args: { key: m.key },
      });
    }
  }

  // RP005 CLAUDE.md 류 때문에 Claude 가 AGENTS.md 를 읽지 않음(기본 모드)
  if (opts.claudeInstructionFiles === 'claude-md-or-agents-md') {
    for (const a of readable.filter((r) => r.kind === 'agents-md')) {
      const shadow = chainTo(a.dir)
        .flatMap((d) => readable.filter((r) => (r.kind === 'claude-md' || r.kind === 'claude-local') && r.dir === d))
        .at(-1);
      if (shadow) out.push({ code: 'RP005', severity: 'info', file: a.path, line: 1, msgId: 'diag.RP005', args: { claude: shadow.path } });
    }
  }

  // RP006 Codex 합계 상한 초과로 잘리는 파일 — 그 폴더를 작업 폴더로 띄웠다고 가정하고 체인을 더한다.
  const reported = new Set<string>();
  const agentDirs = [...new Set(readable.filter((r) => r.kind === 'agents-md' || r.kind === 'agents-override').map((r) => r.dir))].sort();
  for (const launch of agentDirs) {
    let used = 0;
    for (const d of codexChain({ index }, launch)) {
      const { picked } = codexPick(readable.filter((r) => (r.kind === 'agents-md' || r.kind === 'agents-override') && r.dir === d));
      if (!picked) continue;
      const bytes = Buffer.byteLength(picked.text ?? '', 'utf8');
      if (used + bytes > opts.codexMaxBytes && !reported.has(picked.path)) {
        reported.add(picked.path);
        out.push({ code: 'RP006', severity: 'warning', file: picked.path, line: 1, msgId: 'diag.RP006', args: { max: opts.codexMaxBytes, launch: launch === '' ? '.' : launch, total: used + bytes } });
      }
      used += bytes;
    }
  }

  const rank = { error: 0, warning: 1, info: 2 } as const;
  return out.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.code.localeCompare(b.code) || rank[a.severity] - rank[b.severity]);
}
