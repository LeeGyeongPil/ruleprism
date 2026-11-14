// 번들 예제 작업 공간(경로 → 내용 맵). 연습용으로 직접 만든 것이다.
// `ruleprism demo`·`--example`·테스트·정적 미리보기가 같은 맵을 쓴다 — 디스크에 쓰지 않고 메모리로 읽는다.
// mixed-monorepo 는 진단 RP001–RP009 가 모두 한 번 이상 나오도록, clean-repo 는 진단 0 이 되도록 짰다.

export interface DemoWorkspace {
  name: string;
  files: Record<string, string>;
  /** 메모리 리더가 EACCES 를 던질 경로(RP008 재현). 디스크로 풀 때는 일반 파일로 쓴다. */
  unreadable: string[];
  /** 데모가 기본으로 보여 주는 파일. */
  focusFile: string;
}

// Codex 합계 상한(32 KiB)을 넘기는 긴 지침: 약 34 KiB.
const LEGACY_NOTES = [
  '# Legacy billing service',
  '',
  'Notes migrated from the old wiki. Most of this is history; keep it short next time.',
  '',
  ...Array.from({ length: 420 }, (_, i) => `- Note ${String(i + 1).padStart(3, '0')}: the legacy batch job writes invoices in two phases; check both tables.`),
  '',
].join('\n');

export const MIXED_MONOREPO: DemoWorkspace = {
  name: 'mixed-monorepo',
  focusFile: 'src/web/components/Button.tsx',
  unreadable: ['.cursor/rules/locked.mdc'],
  files: {
    'README.md': '# Mixed monorepo (practice workspace)\n\nA small made-up repo used to show how agent rule files apply.\n',
    'package.json': '{ "name": "mixed-monorepo", "private": true }\n',
    'CLAUDE.md': '# Project instructions\n\n- Use npm, not yarn.\n- Run `npm test` before you finish.\n',
    'AGENTS.md': '# Agent instructions\n\n- Use npm, not yarn.\n- Keep pull requests small.\n',
    'GEMINI.md': '# Gemini instructions\n\n- Prefer small, reviewed changes.\n',

    'src/x.ts': 'export const x = 1;\n',
    'src/web/CLAUDE.md': '# Web app\n\n- Components live in `components/`; one component per file.\n',
    'src/web/AGENTS.md': '# Web app (all agents)\n\n- Use function components and hooks.\n',
    'src/web/GEMINI.md': '# Web app (Gemini)\n\n- Use function components.\n',
    'src/web/components/Button.tsx': 'export function Button() {\n  return <button>OK</button>;\n}\n',
    'src/api/handler.ts': 'export function handler() {\n  return { ok: true };\n}\n',
    'src/api/handler.test.ts': "import { handler } from './handler';\n\nconsole.assert(handler().ok);\n",
    'src/legacy/AGENTS.md': LEGACY_NOTES,
    'src/legacy/batch.ts': 'export const batch = true;\n',
    'docs/a/b.md': '# Notes\n',

    // Claude Code 규칙
    '.claude/rules/general.md': '# General\n\n- Write clear commit messages.\n',
    '.claude/rules/md.md': '---\npaths: "*.md"\n---\n# Markdown\n\n- Wrap lines at 100 characters.\n',
    '.claude/rules/ts.md': '---\npaths:\n  - "src/**/*.{ts,tsx}"\n---\n# TypeScript\n\n- Enable strict mode; avoid `any`.\n',
    '.claude/rules/frontend/tsx.md': '---\npaths: "src/**/*.tsx, src/**/*.css"\n---\n# React components\n\n- Keep components small and typed.\n',
    '.claude/rules/globs-only.md': '---\nglobs: "**/*.ts"\n---\n# Copied from Cursor\n\n- This rule was meant for TypeScript files only.\n',
    '.claude/rules/broken.md': '---\npaths: [src/**/*.go\n---\n# Go\n\n- Meant for Go files only.\n',
    '.claude/rules/dead.md': '---\npaths: "packages/**/*.py"\n---\n# Python packages\n\n- Use type hints.\n',

    // GitHub Copilot 지침
    '.github/copilot-instructions.md': '# Repository instructions\n\n- Use npm. Explain non-obvious code in comments.\n',
    '.github/instructions/ts.instructions.md': '---\napplyTo: "**/*.ts, **/*.tsx"\n---\n# TypeScript\n\n- Prefer `unknown` over `any`.\n',
    '.github/instructions/shallow.instructions.md': '---\napplyTo: "*.tsx"\n---\n# React\n\n- Use function components.\n',
    '.github/instructions/arr.instructions.md': '---\napplyTo: ["*.ts","*.tsx"]\n---\n# Array applyTo\n\n- Written as a YAML list by mistake.\n',
    '.github/instructions/api.instructions.md': '---\napplyTo: "src/api/**"\n---\n# API\n\n- Validate every request body.\n',

    // Cursor 규칙
    '.cursor/rules/always.mdc': '---\ndescription: Always on\nalwaysApply: true\nglobs: "src/**/*.ts"\n---\n- Answer in short sentences.\n',
    '.cursor/rules/react.mdc': '---\ndescription: React components\nglobs: src/web/**/*.tsx\nalwaysApply: false\n---\n- Use hooks, not classes.\n',
    '.cursor/rules/req.mdc': '---\ndescription: Database migration guide\n---\n- Write reversible migrations.\n',
    '.cursor/rules/star.mdc': '---\nglobs: **/*.test.ts\nalwaysApply: false\n---\n- Use vitest.\n',
    '.cursor/rules/manual.mdc': '---\nalwaysApply: false\n---\n- Only when mentioned with @manual.\n',
    '.cursor/rules/locked.mdc': '---\nalwaysApply: true\n---\n- This file cannot be read in the practice workspace.\n',

    // CI 기대 매핑(통과·실패 예)
    'ruleprism.expect.json': `${JSON.stringify(
      {
        cases: [
          { file: 'src/api/handler.ts', agent: 'copilot', includes: ['.github/instructions/api.instructions.md'] },
          { file: 'src/web/components/Button.tsx', agent: 'claude', includes: ['.claude/rules/frontend/tsx.md'], excludes: ['AGENTS.md'] },
          { file: 'src/web/components/Button.tsx', agent: 'codex', launchDir: 'src/web/components', includes: ['src/web/AGENTS.md'] },
        ],
      },
      null,
      2,
    )}\n`,
    'ruleprism.expect.fail.json': `${JSON.stringify(
      {
        cases: [
          { file: 'src/api/handler.ts', agent: 'copilot', includes: ['.github/instructions/api.instructions.md', '.github/instructions/arr.instructions.md'] },
          { file: 'src/web/components/Button.tsx', agent: 'codex', includes: ['src/web/AGENTS.md'] },
        ],
      },
      null,
      2,
    )}\n`,
  },
};

export const CLEAN_REPO: DemoWorkspace = {
  name: 'clean-repo',
  focusFile: 'src/index.ts',
  unreadable: [],
  files: {
    'README.md': '# Clean repo (practice workspace)\n',
    'AGENTS.md': '# Agent instructions\n\n- Use npm.\n',
    'GEMINI.md': '# Gemini instructions\n\n- Use npm.\n',
    'src/index.ts': 'export const ok = true;\n',
    '.claude/rules/ts.md': '---\npaths:\n  - "src/**/*.ts"\n---\n- Avoid `any`.\n',
    '.github/copilot-instructions.md': '# Repository instructions\n\n- Use npm.\n',
    '.github/instructions/ts.instructions.md': '---\napplyTo: "**/*.ts"\n---\n- Avoid `any`.\n',
    '.cursor/rules/ts.mdc': '---\ndescription: TypeScript\nglobs: "src/**/*.ts"\nalwaysApply: false\n---\n- Avoid `any`.\n',
  },
};

export const DEMO_WORKSPACES: Record<string, DemoWorkspace> = {
  [MIXED_MONOREPO.name]: MIXED_MONOREPO,
  [CLEAN_REPO.name]: CLEAN_REPO,
};
