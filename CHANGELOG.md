# Changelog

## 0.1.7

### Fixed

- `ruleprism which --launch-dir <file>` now warns that the launch folder is a file, not a folder, instead of wrongly saying it does not exist. Warning text only; exit code and results are unchanged.

## 0.1.6

### Fixed

- `ruleprism check` now exits 2 when a case's `file` or `launchDir` points outside the workspace root (for example `../..`), even if that path exists on disk. Previously it passed with exit 0, unlike `ruleprism which --launch-dir ../..`. Expectation files that relied on this will now fail; use paths inside the root.

## 0.1.5

### Fixed

- README install steps now use the matching `ruleprism-0.1.5.vsix` file name and the `v0.1.5` tag in the CI example (README.md and README.ko.md). No code changes.

## 0.1.4

### Fixed

- The extension's prompts, pickers and info messages (Explain pattern, Copy as JSON, Set launch folder) now follow the `ruleprism.language` setting instead of the VS Code display language, so the screen is no longer mixed-language. The command titles and setting descriptions in the manifest still follow the VS Code display language.

## 0.1.3

### Fixed

- `ruleprism check` now exits 2 (`error:` + `hint:`) when a case's `file` or `launchDir` does not exist in the workspace, listing every problem case. Previously a misspelled path was judged without any check, so an `excludes`-only case passed silently. Expectation files that contained such typos will now fail in CI; fix the paths.
- `ruleprism which` prints a warning on stderr (stdout and `--json` output unchanged, exit code still 0) when the file or `--launch-dir` does not exist.

### Known issues

- (Resolved in 0.1.6: `check` now rejects paths outside the workspace root.)

## 0.1.2

### Fixed

- CI workflow stability: runner pinned to ubuntu-24.04, Node 22.x and 26.x matrix, named steps, GitHub Actions test reporter, and a diagnostics step that runs on failure.

### Documentation

- README.ko.md now shows the Korean `check` output (`3건 중 3건 통과`) and notes that the wording follows the output language.

## 0.1.1

### Security

- Override transitive dev dependency minimatch (via @vscode/vsce) to 11.0.8 to address GHSA-g3hv-75wg-m249. Packaging-time only; the published extension and CLI runtime were not affected.

### Fixed

- CI stability: diagnostics are now sorted by code point instead of locale (the order differed on Linux CI), CLI test timeouts are longer for slow shared runners, `.gitattributes` forces LF line endings, and the CI workflow uses least-privilege permissions and `fail-fast: false`.

## 0.1.0

- Rule files are always found even when the workspace has more than 20,000 files; RP010 (info) notes that dead-rule counts are then approximate.
- First release: per-agent resolution for Claude Code, GitHub Copilot (VS Code), Cursor, Codex and Gemini CLI.
- VS Code extension: "Rules for this file" view, status bar summary, CodeLens on rule files, Problems diagnostics RP001-RP009 with quick fixes for RP001 and RP002, commands and settings.
- CLI `ruleprism`: `which`, `explain`, `lint`, `check`, `demo`; JSON output (`schemaVersion: 1`).
- English and Korean.
