# How each agent is resolved (sources)

ruleprism follows each tool's **documentation**, checked on **2026-11-14**. It does not watch a running agent, and tool behavior can change between versions. Each resolver in `src/core/agents/` repeats its sources in a header comment; update both places together.

Certainty levels used in the output:

| Level | Mark | Meaning |
|---|---|---|
| `certain` | `[=]` | Loaded at session start, or attached as soon as the file is in context |
| `conditional` | `[~]` | Loaded when the agent reads, writes or edits this file (on demand) |
| `uncertain` | `[?]` | The agent decides (description-only rules) or the behavior is not documented |

## Claude Code

Source: https://code.claude.com/docs/en/memory (checked 2026-11-14)

| What | ruleprism behavior |
|---|---|
| `CLAUDE.md`, `.claude/CLAUDE.md`, `CLAUDE.local.md` in the launch folder and above | Loaded at launch, root first; within a folder `CLAUDE.md`, `.claude/CLAUDE.md`, rules without `paths`, then `CLAUDE.local.md` |
| Same files in subfolders below the launch folder | On demand (`conditional`) when the file is in that subfolder |
| `.claude/rules/**/*.md` without `paths` | Loaded at launch, same priority as `.claude/CLAUDE.md` |
| `.claude/rules/**/*.md` with `paths` | `conditional`; YAML list or comma string; brace expansion; a pattern without `/` matches at any depth; a leading `/` anchors to the folder that holds `.claude` |
| Front matter that does not parse | Treated as having no `paths` (loaded for every file) — RP004 |
| `globs` / `applyTo` instead of `paths` | Ignored by Claude, rule loads for every file — RP009 |
| `AGENTS.md` | Default `claude-md-or-agents-md`: read only when no `CLAUDE.md`/`.claude/CLAUDE.md`/`CLAUDE.local.md` is in the launch folder or above — RP005. `claude-md-and-agents-md`: read after each folder's CLAUDE files |
| User level | `~/.claude/CLAUDE.md`, `~/.claude/rules` (`paths` relative to the launch folder) |

Not modeled yet: `@path` imports, `claudeMdExcludes`, managed policy files, symlinked rules, the 1,000-pattern brace budget, the per-file size limit for on-demand files.

## GitHub Copilot (VS Code)

Sources (checked 2026-11-14):
- https://code.visualstudio.com/docs/agents/reference/custom-instructions-reference
- https://code.visualstudio.com/docs/agents/reference/ai-settings
- https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions

| What | ruleprism behavior |
|---|---|
| `.github/copilot-instructions.md` | Always attached |
| `.github/instructions/**/*.instructions.md` | Attached when `applyTo` matches; comma-separated patterns relative to the workspace root; `*.py` matches root files only (RP002); no `applyTo` means not attached automatically |
| `applyTo` written as a YAML list | Not documented; shown as `uncertain` — RP001 |
| Workspace-root `AGENTS.md` | Attached when `chat.useAgentsMdFile` is on (default `true`) |
| Workspace-root `CLAUDE.md`, `.claude/CLAUDE.md`, `CLAUDE.local.md`, `~/.claude/CLAUDE.md` | Attached when `chat.useClaudeMdFile` is on (default `true`) |
| `.claude/rules` | Read with `chat.useClaudeMdFile`; matching details are not documented, so `uncertain` |
| Order | "There is no precedence rule" — shown as merged |

The extension reads your real `chat.useAgentsMdFile` / `chat.useClaudeMdFile` values; the CLI uses the documented defaults. Nested `AGENTS.md` (`chat.useNestedAgentsMdFiles`, experimental, default off) is not modeled.

## Cursor

Source: https://cursor.com/docs/context/rules (checked 2026-11-14)

| What | ruleprism behavior |
|---|---|
| `.cursor/rules/**/*.mdc` with `alwaysApply: true` | Always attached; `globs` are ignored — RP003 |
| With `globs` | Attached when a pattern matches (comma-separated). Whether a slash-less pattern such as `*.ts` matches only the top level is not documented for Cursor; ruleprism assumes it does (as in VS Code) and reports it as RP002 info, not a warning |
| With `description` only | Agent-requested: `uncertain` |
| Neither | Manual (`@` mention), not attached automatically |
| `.md` without front matter in `.cursor/rules` | Ignored |
| Unquoted `globs: **/*.ts` | Not strict YAML; read leniently — RP004 (info) |
| `.cursor/rules` in subfolders | Not documented, reports differ (https://forum.cursor.com/t/nested-cursor-rules-subdirectories/110303) — `uncertain` |
| `AGENTS.md` | Root and nested, the closest one wins |

## Codex

Source: https://learn.chatgpt.com/docs/agent-configuration/agents-md (moved from developers.openai.com/codex/guides/agents-md, checked 2026-11-14)

| What | ruleprism behavior |
|---|---|
| `~/.codex/AGENTS.override.md` or `AGENTS.md` | First non-empty one (user level) |
| Project root (nearest folder with `.git`, else the workspace root) down to the launch folder | One file per folder: `AGENTS.override.md`, then `AGENTS.md`; empty files skipped |
| Subfolders below the launch folder | Not read (shown as skipped with the reason) |
| Total over `project_doc_max_bytes` (default 32 KiB) | Cut; the file where the cut happens is marked — RP006 |

Not modeled: `project_doc_fallback_filenames`.

## Gemini CLI

Sources (checked 2026-11-14):
- https://geminicli.com/docs/cli/gemini-md/
- https://geminicli.com/docs/reference/configuration/

| What | ruleprism behavior |
|---|---|
| `~/.gemini/GEMINI.md` | User level |
| `GEMINI.md` in the launch folder and above, stopping at the folder with `.git` | Loaded at launch |
| `GEMINI.md` in the file's folder and its parents not loaded yet | Just in time (`conditional`) |
| `context.fileName` | Setting `ruleprism.gemini.fileNames` (default `["GEMINI.md"]`) |

Not modeled: `@file.md` imports, `context.discoveryMaxDirs`.
