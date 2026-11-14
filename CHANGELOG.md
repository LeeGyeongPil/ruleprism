# Changelog

## 0.1.0

- Rule files are always found even when the workspace has more than 20,000 files; RP010 (info) notes that dead-rule counts are then approximate.
- First release: per-agent resolution for Claude Code, GitHub Copilot (VS Code), Cursor, Codex and Gemini CLI.
- VS Code extension: "Rules for this file" view, status bar summary, CodeLens on rule files, Problems diagnostics RP001-RP009 with quick fixes for RP001 and RP002, commands and settings.
- CLI `ruleprism`: `which`, `explain`, `lint`, `check`, `demo`; JSON output (`schemaVersion: 1`).
- English and Korean.
