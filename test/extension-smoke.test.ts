// 확장 어댑터 연기 시험(smoke test): 실제 VS Code(Electron)는 샌드박스에서 뜨지 않으므로,
// 'vscode' 모듈을 작은 가짜로 바꿔 빌드된 out/extension/extension.js 의 activate 를 돌려 본다.
// 확인하는 것: 명령 등록, 트리·상태 표시줄·진단·CodeLens·빠른 수정 연결, 설정 변경 반영, 정리(dispose).
import * as fs from 'node:fs';
import Module, { createRequire } from 'node:module';
import * as path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { MIXED_MONOREPO } from '../src/core/demo-workspace';
import { REPO, tempDir } from './helpers';

// ---- 예제 작업 공간을 임시 폴더에 푼다 ----
const root = tempDir('ext');
for (const [rel, text] of Object.entries(MIXED_MONOREPO.files)) {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
}

// ---- 가짜 vscode ----
type Listener = (v?: unknown) => void;
const noopEvent = () => ({ dispose() {} });
class EventEmitter {
  private listeners: Listener[] = [];
  event = (l: Listener) => {
    this.listeners.push(l);
    return { dispose() {} };
  };
  fire(v?: unknown) {
    for (const l of this.listeners) l(v);
  }
  dispose() {}
}
class Uri {
  constructor(readonly fsPath: string) {}
  static file(p: string) {
    return new Uri(p);
  }
  static joinPath(u: Uri, ...parts: string[]) {
    return new Uri(path.join(u.fsPath, ...parts));
  }
  toString() {
    return `file://${this.fsPath}`;
  }
}
class Range {
  constructor(
    readonly startLine: number,
    readonly startChar: number,
    readonly endLine: number,
    readonly endChar: number,
  ) {}
}
class VDiagnostic {
  code?: string;
  source?: string;
  constructor(
    readonly range: Range,
    readonly message: string,
    readonly severity: number,
  ) {}
}
class CodeLens {
  constructor(
    readonly range: Range,
    readonly command: { title: string },
  ) {}
}
class CodeAction {
  edit?: WorkspaceEdit;
  diagnostics?: unknown[];
  isPreferred?: boolean;
  constructor(
    readonly title: string,
    readonly kind: string,
  ) {}
}
class WorkspaceEdit {
  edits: { uri: Uri; range: Range; text: string }[] = [];
  replace(uri: Uri, range: Range, text: string) {
    this.edits.push({ uri, range, text });
  }
}
class TreeItem {
  [k: string]: unknown;
  constructor(
    readonly label: string,
    readonly collapsibleState: number,
  ) {}
}
class ThemeIcon {
  constructor(readonly id: string) {}
}

const diags = new Map<string, VDiagnostic[]>();
const commands = new Map<string, (...a: unknown[]) => unknown>();
// 테스트 기계의 ~/.claude·~/.gemini 파일이 결과를 바꾸지 않게 사용자 수준 파일은 끈다.
const config: Record<string, unknown> = { 'ruleprism.includeUserFiles': false };
const folder = { uri: Uri.file(root), name: 'ws', index: 0 };
const editorListeners: Listener[] = [];
const inputs: string[] = [];
let pickAnswer: unknown;
let lastPickItems: unknown[] = [];
let treeProvider: { getChildren(n?: unknown): { label: string; children?: unknown[] }[]; getTreeItem(n: unknown): TreeItem } | undefined;
let lensProvider: { provideCodeLenses(doc: unknown): CodeLens[] } | undefined;
let actionProvider: { provideCodeActions(doc: unknown, r: unknown, ctx: unknown): CodeAction[] } | undefined;
let active: { document: { uri: Uri } } | undefined = { document: { uri: Uri.file(path.join(root, 'src/web/components/Button.tsx')) } };
const status = { text: '', tooltip: '', command: '', visible: false, show() { this.visible = true; }, hide() { this.visible = false; }, dispose() {} };
const clipboard = { text: '', async writeText(s: string) { this.text = s; } };

const vscodeStub = {
  EventEmitter, Uri, Range, Diagnostic: VDiagnostic, CodeLens, CodeAction, WorkspaceEdit, TreeItem, ThemeIcon,
  DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
  StatusBarAlignment: { Left: 1, Right: 2 },
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  CodeActionKind: { QuickFix: 'quickfix' },
  ConfigurationTarget: { Global: 1, Workspace: 2 },
  env: { language: 'en', clipboard },
  l10n: { t: (s: string) => s },
  languages: {
    createDiagnosticCollection: () => ({
      set: (uri: Uri, list: VDiagnostic[]) => diags.set(uri.fsPath, list),
      delete: (uri: Uri) => diags.delete(uri.fsPath),
      forEach: (cb: (uri: Uri, list: VDiagnostic[]) => void) => {
        for (const k of [...diags.keys()]) cb(Uri.file(k), diags.get(k)!);
      },
      dispose() {},
    }),
    registerCodeLensProvider: (_s: unknown, p: typeof lensProvider) => {
      lensProvider = p;
      return { dispose() {} };
    },
    registerCodeActionsProvider: (_s: unknown, p: typeof actionProvider) => {
      actionProvider = p;
      return { dispose() {} };
    },
  },
  window: {
    get activeTextEditor() {
      return active;
    },
    createTreeView: (_id: string, opts: { treeDataProvider: typeof treeProvider }) => {
      treeProvider = opts.treeDataProvider;
      return { message: undefined, dispose() {} };
    },
    createStatusBarItem: () => status,
    onDidChangeActiveTextEditor: (l: Listener) => {
      editorListeners.push(l);
      return { dispose() {} };
    },
    showInformationMessage: async () => undefined,
    showInputBox: async () => inputs.shift(),
    showQuickPick: async (items: unknown[]) => {
      lastPickItems = items;
      return pickAnswer;
    },
  },
  workspace: {
    workspaceFolders: [folder],
    getWorkspaceFolder: (uri: Uri) => (uri.fsPath.startsWith(root) ? folder : undefined),
    getConfiguration: (section: string) => ({
      get: (k: string, d: unknown) => config[`${section}.${k}`] ?? d,
      update: async (k: string, v: unknown) => {
        config[`${section}.${k}`] = v;
      },
    }),
    createFileSystemWatcher: () => ({ onDidCreate: noopEvent, onDidChange: noopEvent, onDidDelete: noopEvent, dispose() {} }),
    onDidChangeWorkspaceFolders: noopEvent,
    onDidChangeConfiguration: noopEvent,
  },
  commands: {
    registerCommand: (id: string, fn: (...a: unknown[]) => unknown) => {
      commands.set(id, fn);
      return { dispose: () => commands.delete(id) };
    },
  },
};

// require('vscode') 를 가짜로 돌린다.
const M = Module as unknown as { _resolveFilename: (req: string, ...rest: unknown[]) => string };
const originalResolve = M._resolveFilename;
M._resolveFilename = function (req: string, ...rest: unknown[]) {
  return req === 'vscode' ? 'vscode-stub' : originalResolve.call(this, req, ...rest);
};
const req = createRequire(path.join(REPO, 'package.json'));
req.cache['vscode-stub'] = { id: 'vscode-stub', filename: 'vscode-stub', loaded: true, exports: vscodeStub } as unknown as NodeJS.Module;
const ext = req(path.join(REPO, 'out/extension/extension.js')) as { activate(ctx: unknown): void; deactivate(): void };
const context = { subscriptions: [] as { dispose(): unknown }[] };

afterAll(() => {
  M._resolveFilename = originalResolve;
  fs.rmSync(root, { recursive: true, force: true });
});

const docFor = (rel: string) => {
  const text = fs.readFileSync(path.join(root, rel), 'utf8');
  const lines = text.split('\n');
  return { uri: Uri.file(path.join(root, rel)), lineCount: lines.length, lineAt: (i: number) => ({ range: { end: { line: i, character: lines[i].length } } }) };
};

describe('extension adapter (stubbed vscode)', () => {
  it('activates and registers every contributed command', () => {
    expect(() => ext.activate(context)).not.toThrow();
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
    for (const c of pkg.contributes.commands as { command: string }[]) expect(commands.has(c.command), c.command).toBe(true);
  });

  it('shows the tree and the status bar for the active file', () => {
    const nodes = treeProvider!.getChildren();
    expect(nodes.map((n) => n.label)).toEqual(['Claude Code', 'GitHub Copilot', 'Cursor', 'Codex', 'Gemini CLI']);
    const first = treeProvider!.getChildren(nodes[0])[0];
    const item = treeProvider!.getTreeItem(first);
    expect(item.label).toBe('1. CLAUDE.md');
    expect((item.command as { command: string }).command).toBe('vscode.open');
    // 디스크 사본에는 읽지 못하는 파일이 없어 Cursor 에 locked.mdc 가 더해진다.
    expect(status.text).toBe('$(list-ordered) Rules: C7 Cp9 Cu6 Cx1 G2');
    expect(status.visible).toBe(true);
  });

  it('publishes diagnostics and offers the RP001 quick fix', () => {
    const file = '.github/instructions/arr.instructions.md';
    const list = diags.get(path.join(root, file))!;
    expect(list.map((d) => d.code)).toEqual(['RP001', 'RP002', 'RP002', 'RP007']);
    expect(list[0].source).toBe('ruleprism');
    const actions = actionProvider!.provideCodeActions(docFor(file), undefined, { diagnostics: [list[0]] });
    expect(actions).toHaveLength(1);
    expect(actions[0].title).toBe('Convert applyTo to one comma-separated string');
    expect(actions[0].edit!.edits[0].text).toBe('applyTo: "*.ts, *.tsx"');
  });

  it('puts a CodeLens with the match count on rule files only', () => {
    expect(lensProvider!.provideCodeLenses(docFor('.github/instructions/api.instructions.md'))[0].command.title).toBe('matches 2 files in this workspace');
    expect(lensProvider!.provideCodeLenses(docFor('src/api/handler.ts'))).toEqual([]);
  });

  it('copies the result as JSON', async () => {
    await commands.get('ruleprism.copyJson')!();
    const json = JSON.parse(clipboard.text);
    expect(json.schemaVersion).toBe(1);
    expect(json.file).toBe('src/web/components/Button.tsx');
  });

  it('explains a pattern per tool', async () => {
    inputs.push('*.ts', 'src/x.ts');
    await commands.get('ruleprism.explainPattern')!();
    expect((lastPickItems as { label: string }[]).map((i) => i.label)).toEqual(['$(check) Claude Code', '$(x) GitHub Copilot', '$(x) Cursor']);
  });

  it('follows the launch folder and language settings', async () => {
    pickAnswer = { label: 'Folder of the current file', value: 'fileFolder' };
    await commands.get('ruleprism.setLaunchFolder')!();
    expect(config['ruleprism.launchFolder']).toBe('fileFolder');
    config['ruleprism.language'] = 'ko';
    await commands.get('ruleprism.refresh')!();
    expect(status.text).toBe('$(list-ordered) 규칙: C7 Cp9 Cu6 Cx2 G2');
  });

  it('hides the status bar when no file is open, and disposes cleanly', () => {
    active = undefined;
    for (const l of editorListeners) l();
    expect(status.visible).toBe(false);
    for (const d of context.subscriptions) expect(() => d.dispose()).not.toThrow();
    expect(commands.size).toBe(0);
    ext.deactivate();
  });
});
