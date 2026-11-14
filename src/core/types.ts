// 코어 공용 타입. 이 폴더(src/core)는 vscode 를 절대 import 하지 않는다 — CLI·테스트·확장이 함께 쓴다.

/** 판정하는 에이전트 다섯 종류. */
export type AgentId = 'claude' | 'copilot' | 'cursor' | 'codex' | 'gemini';
export const ALL_AGENTS: AgentId[] = ['claude', 'copilot', 'cursor', 'codex', 'gemini'];

/**
 * 확실성 3단계.
 * - certain: 세션 시작 때 또는 파일이 문맥에 들어오면 문서상 반드시 붙는다.
 * - conditional: 에이전트가 이 파일을 읽기·쓰기·고치기 도구로 다룰 때 붙는다(필요 시 로드).
 * - uncertain: 에이전트가 스스로 정하거나(요청형) 공식 문서에 동작이 없다.
 */
export type Certainty = 'certain' | 'conditional' | 'uncertain';

/** 왜 붙는지(또는 왜 빠지는지)를 나타내는 이유 코드. 사람이 읽는 문구는 i18n 카탈로그의 `reason.<code>`. */
export type ReasonCode =
  // 붙는 이유
  | 'user-file'
  | 'launch-ancestor'
  | 'on-demand-subdir'
  | 'agents-md-instead'
  | 'agents-md-alongside'
  | 'rule-unconditional'
  | 'rule-yaml-error'
  | 'rule-globs-not-paths'
  | 'paths-matched'
  | 'repo-wide'
  | 'applyto-matched'
  | 'applyto-list-matched'
  | 'workspace-agents-md'
  | 'workspace-claude-md'
  | 'claude-rule-in-copilot'
  | 'claude-rule-paths-in-copilot'
  | 'always-apply'
  | 'globs-matched'
  | 'agent-requested'
  | 'cursor-agents-md'
  | 'codex-chain'
  | 'gemini-launch'
  | 'gemini-jit'
  // 빠지는 이유
  | 'skip-agents-md-shadowed'
  | 'skip-override'
  | 'skip-not-in-chain'
  | 'skip-manual'
  | 'skip-no-applyto'
  | 'skip-truncated'
  | 'skip-empty'
  | 'skip-setting-off';

/** 한 에이전트가 이 파일에 붙이는 지침 파일 한 개. */
export interface Entry {
  /** 문맥에 들어가는 순서(1부터). Copilot·Cursor 는 병합이라 나열 순서일 뿐이다. */
  order: number;
  /** 작업 공간 루트 기준 경로('/' 구분). 사용자 수준 파일은 `~/` 로 시작한다. */
  file: string;
  reason: ReasonCode;
  /** 일치한 패턴, 관련 폴더 같은 세부 값. */
  detail?: string;
  certainty: Certainty;
  /** 근사 토큰(문자 수 ÷ 4, 올림). 실제 토크나이저가 아니다. */
  approxTokens: number;
  /** Codex 32 KiB 상한 때문에 일부만 들어가는 파일. */
  truncated?: boolean;
}

/** 후보였지만 붙지 않는 파일과 그 이유(설명용). */
export interface Skipped {
  file: string;
  reason: ReasonCode;
  detail?: string;
}

export type Ordering = 'context-order' | 'merged';

export interface AgentResult {
  entries: Entry[];
  skipped: Skipped[];
  approxTokens: number;
  ordering: Ordering;
}

export interface Resolution {
  schemaVersion: 1;
  file: string;
  launchDir: string;
  agents: Partial<Record<AgentId, AgentResult>>;
}

export type Severity = 'error' | 'warning' | 'info';
export type DiagCode =
  | 'RP001'
  | 'RP002'
  | 'RP003'
  | 'RP004'
  | 'RP005'
  | 'RP006'
  | 'RP007'
  | 'RP008'
  | 'RP009'
  | 'RP010';

/** Problems 패널·lint 에 나가는 진단 한 건. 문구는 `diag.<code>[.<variant>]` 키 + args 로 만든다. */
export interface Diagnostic {
  code: DiagCode;
  severity: Severity;
  /** 루트 기준 경로. */
  file: string;
  /** 1부터 세는 줄 번호. */
  line: number;
  msgId: string;
  args: Record<string, string | number>;
  /** 빠른 수정이 있으면 그 편집. */
  fix?: TextFix;
}

/** 줄 단위 텍스트 편집: [startLine, endLine] (1부터, 둘 다 포함) 줄을 newText 로 바꾼다. */
export interface TextFix {
  titleKey: string;
  startLine: number;
  endLine: number;
  newText: string;
}

export type InstructionFilesMode = 'claude-md-or-agents-md' | 'claude-md-and-agents-md';

/** 판정 옵션. 확장은 VS Code 설정에서, CLI 는 인자·문서 기본값에서 채운다. */
export interface ResolveOptions {
  /** 가정 작업 폴더(루트 기준, '' = 루트). */
  launchDir: string;
  agents: AgentId[];
  claudeInstructionFiles: InstructionFilesMode;
  codexMaxBytes: number;
  geminiFileNames: string[];
  /** VS Code `chat.useAgentsMdFile`(기본 true). */
  copilotUseAgentsMd: boolean;
  /** VS Code `chat.useClaudeMdFile`(기본 true). */
  copilotUseClaudeMd: boolean;
}

export const DEFAULT_OPTIONS: ResolveOptions = {
  launchDir: '',
  agents: [...ALL_AGENTS],
  claudeInstructionFiles: 'claude-md-or-agents-md',
  codexMaxBytes: 32 * 1024,
  geminiFileNames: ['GEMINI.md'],
  copilotUseAgentsMd: true,
  copilotUseClaudeMd: true,
};
