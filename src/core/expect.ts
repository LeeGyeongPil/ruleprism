// 기대 매핑 파일 검사(CI 용): "이 파일에는 이 에이전트가 이 규칙을 붙여야/붙이면 안 된다".
// 형식(JSON 또는 YAML):
//   { "cases": [ { "file": "src/api/handler.ts", "agent": "copilot",
//                  "includes": [".github/instructions/api.instructions.md"], "excludes": [], "launchDir": "" } ] }
import { parse as parseYaml } from 'yaml';
import { normalizeRel, resolveFile } from './resolve';
import type { RuleFile, RuleIndex } from './scan';
import { ALL_AGENTS, type AgentId, type ResolveOptions } from './types';

export interface ExpectCase {
  file: string;
  agent: AgentId;
  includes: string[];
  excludes: string[];
  launchDir?: string;
}

export interface CaseResult {
  case: ExpectCase;
  missing: string[];
  unexpected: string[];
}

/** 형식 오류는 사람이 읽을 수 있는 영어 메시지의 Error 로 던진다(CLI 가 종료 2 로 바꾼다). */
export class ExpectFormatError extends Error {}

export function parseExpectations(text: string): ExpectCase[] {
  let data: unknown;
  try {
    data = parseYaml(text);
  } catch (e) {
    throw new ExpectFormatError((e as Error).message.split('\n')[0]);
  }
  const cases = (data as { cases?: unknown } | null)?.cases;
  if (!Array.isArray(cases)) throw new ExpectFormatError('top-level "cases" array is missing');
  return cases.map((c, i) => {
    const o = (c ?? {}) as Record<string, unknown>;
    if (typeof o.file !== 'string' || o.file === '') throw new ExpectFormatError(`cases[${i}].file must be a string`);
    if (typeof o.agent !== 'string' || !ALL_AGENTS.includes(o.agent as AgentId)) {
      throw new ExpectFormatError(`cases[${i}].agent must be one of ${ALL_AGENTS.join(', ')}`);
    }
    const list = (v: unknown, name: string): string[] => {
      if (v === undefined) return [];
      if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) throw new ExpectFormatError(`cases[${i}].${name} must be a list of strings`);
      return v.map((x) => normalizeRel(x as string));
    };
    return {
      file: normalizeRel(o.file),
      agent: o.agent as AgentId,
      includes: list(o.includes, 'includes'),
      excludes: list(o.excludes, 'excludes'),
      ...(typeof o.launchDir === 'string' ? { launchDir: o.launchDir } : {}),
    };
  });
}

export function checkExpectations(index: RuleIndex, cases: ExpectCase[], options: Partial<ResolveOptions> = {}, userRules: RuleFile[] = []): CaseResult[] {
  return cases.map((c) => {
    const res = resolveFile(index, c.file, { ...options, agents: [c.agent], ...(c.launchDir !== undefined ? { launchDir: c.launchDir } : {}) }, userRules);
    const got = new Set((res.agents[c.agent]?.entries ?? []).map((e) => e.file));
    return {
      case: c,
      missing: c.includes.filter((f) => !got.has(f)),
      unexpected: c.excludes.filter((f) => got.has(f)),
    };
  });
}
