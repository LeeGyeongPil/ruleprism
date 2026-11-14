// 판정 진입점: 색인 + 파일 + 옵션 → 에이전트별 결과.
import { resolveClaude } from './agents/claude';
import type { Context } from './agents/common';
import { resolveCodex } from './agents/codex';
import { resolveCopilot } from './agents/copilot';
import { resolveCursor } from './agents/cursor';
import { resolveGemini } from './agents/gemini';
import type { RuleFile, RuleIndex } from './scan';
import { fileDir } from './scan';
import { type AgentId, type AgentResult, DEFAULT_OPTIONS, type Resolution, type ResolveOptions } from './types';

const RESOLVERS: Record<AgentId, (ctx: Context) => AgentResult> = {
  claude: resolveClaude,
  copilot: resolveCopilot,
  cursor: resolveCursor,
  codex: resolveCodex,
  gemini: resolveGemini,
};

/** 경로 표기를 맞춘다: '\\' → '/', 앞 './'·'/' 제거, 끝 '/' 제거. */
export function normalizeRel(p: string): string {
  let s = p.replace(/\\/g, '/');
  while (s.startsWith('./')) s = s.slice(2);
  s = s.replace(/^\/+/, '').replace(/\/+$/, '');
  return s === '.' ? '' : s;
}

export function resolveFile(index: RuleIndex, file: string, options: Partial<ResolveOptions> = {}, userRules: RuleFile[] = []): Resolution {
  const opts: ResolveOptions = { ...DEFAULT_OPTIONS, ...options };
  opts.launchDir = normalizeRel(opts.launchDir);
  const rel = normalizeRel(file);
  const ctx: Context = { index, userRules, file: rel, fileDir: fileDir(rel), opts };
  const agents: Partial<Record<AgentId, AgentResult>> = {};
  for (const a of opts.agents) agents[a] = RESOLVERS[a](ctx);
  return { schemaVersion: 1, file: rel, launchDir: opts.launchDir, agents };
}

/** "가정 작업 폴더" 설정값을 루트 기준 폴더로 바꾼다: workspaceRoot | fileFolder | 경로. */
export function launchDirFor(setting: string, file: string): string {
  if (setting === '' || setting === 'workspaceRoot') return '';
  if (setting === 'fileFolder') return fileDir(normalizeRel(file));
  return normalizeRel(setting);
}
