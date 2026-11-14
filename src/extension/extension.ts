// VS Code 확장: 코어 판정 결과를 트리·상태 표시줄·CodeLens·Problems·빠른 수정으로 보여 주는 얇은 어댑터.
// 판정 로직은 전부 src/core 에 있고(vitest 로 검증), 여기서는 VS Code API 로 옮기기만 한다.
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { computeDiagnostics, ruleMatches } from '../core/diagnostics';
import { diskReader, IGNORED_DIRS } from '../core/fsreader';
import { explainPattern } from '../core/glob';
import { launchDirFor, resolveFile } from '../core/resolve';
import { classify, type RuleFile, type RuleIndex, scanUserFiles, scanWorkspace } from '../core/scan';
import { ALL_AGENTS, type AgentId, DEFAULT_OPTIONS, type Diagnostic, type InstructionFilesMode, type Resolution, type ResolveOptions } from '../core/types';
import { langFromValue, makeT, type Translate } from '../i18n/i18n';
import { buildTree, codeLensText, diagnosticMessage, statusText, type TreeNode } from '../view/model';

/** 작업 공간 폴더 하나의 색인과 진단(파일이 바뀌면 버린다). */
interface FolderState {
  index: RuleIndex;
  diags: Diagnostic[];
}

const RULE_GLOB = '**/{CLAUDE.md,CLAUDE.local.md,AGENTS.md,AGENTS.override.md,GEMINI.md,*.instructions.md,copilot-instructions.md,*.mdc,.claude/rules/**/*.md}';
const REBUILD_DELAY_MS = 300;

export function activate(context: vscode.ExtensionContext): void {
  const cache = new Map<string, FolderState>();
  let userRules: RuleFile[] | undefined;
  let current: { folder: vscode.WorkspaceFolder; res: Resolution } | undefined;
  // 빠른 수정에 쓰려고 VS Code 진단 → 코어 진단을 이어 둔다(진단이 다시 계산되면 함께 사라진다).
  const fixes = new WeakMap<vscode.Diagnostic, Diagnostic>();

  const collection = vscode.languages.createDiagnosticCollection('ruleprism');
  const tree = new RulesTree();
  context.subscriptions.push(tree);
  const view = vscode.window.createTreeView('ruleprism.rules', { treeDataProvider: tree, showCollapseAll: true });
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  status.command = 'ruleprism.rules.focus';
  const lensChanged = new vscode.EventEmitter<void>();
  context.subscriptions.push(collection, view, status, lensChanged);

  // ---- 설정 읽기 ----
  function translator(): Translate {
    const setting = vscode.workspace.getConfiguration('ruleprism').get<string>('language', 'auto');
    const lang = setting === 'auto' ? langFromValue(vscode.env.language) ?? 'en' : setting === 'ko' ? 'ko' : 'en';
    return makeT(lang);
  }

  function readOptions(): { opts: ResolveOptions; launchSetting: string; includeUser: boolean } {
    const cfg = vscode.workspace.getConfiguration('ruleprism');
    const chat = vscode.workspace.getConfiguration('chat');
    const agents = cfg.get<string[]>('agents', [...ALL_AGENTS]).filter((a): a is AgentId => ALL_AGENTS.includes(a as AgentId));
    const opts: ResolveOptions = {
      ...DEFAULT_OPTIONS,
      agents,
      claudeInstructionFiles: cfg.get<InstructionFilesMode>('claude.instructionFiles', 'claude-md-or-agents-md'),
      codexMaxBytes: Math.max(1, cfg.get<number>('codex.maxBytes', DEFAULT_OPTIONS.codexMaxBytes)),
      geminiFileNames: cfg.get<string[]>('gemini.fileNames', ['GEMINI.md']),
      // Copilot 동작은 사용자의 실제 VS Code 설정값을 따른다.
      copilotUseAgentsMd: chat.get<boolean>('useAgentsMdFile', true),
      copilotUseClaudeMd: chat.get<boolean>('useClaudeMdFile', true),
    };
    return { opts, launchSetting: cfg.get<string>('launchFolder', 'workspaceRoot'), includeUser: cfg.get<boolean>('includeUserFiles', true) };
  }

  function getUserRules(): RuleFile[] {
    if (!readOptions().includeUser) return [];
    if (!userRules) {
      const home = os.homedir();
      userRules = scanUserFiles(diskReader(home), diskReader(path.join(home, '.claude', 'rules')), readOptions().opts.geminiFileNames);
    }
    return userRules;
  }

  // ---- 색인·진단 ----
  function folderState(folder: vscode.WorkspaceFolder): FolderState {
    const key = folder.uri.toString();
    let state = cache.get(key);
    if (!state) {
      const { opts } = readOptions();
      const index = scanWorkspace(diskReader(folder.uri.fsPath), opts.geminiFileNames);
      state = { index, diags: computeDiagnostics(index, opts) };
      cache.set(key, state);
      publish(folder, state);
    }
    return state;
  }

  function publish(folder: vscode.WorkspaceFolder, state: FolderState): void {
    const t = translator();
    const byFile = new Map<string, vscode.Diagnostic[]>();
    for (const d of state.diags) {
      const line = Math.max(0, d.line - 1);
      const vd = new vscode.Diagnostic(new vscode.Range(line, 0, line, Number.MAX_SAFE_INTEGER), diagnosticMessage(d, t), severityOf(d));
      vd.code = d.code;
      vd.source = 'ruleprism';
      if (d.fix) fixes.set(vd, d);
      const list = byFile.get(d.file) ?? [];
      list.push(vd);
      byFile.set(d.file, list);
    }
    // 이 폴더의 이전 진단을 지우고 새로 넣는다.
    collection.forEach((uri) => {
      if (vscode.workspace.getWorkspaceFolder(uri)?.uri.toString() === folder.uri.toString()) collection.delete(uri);
    });
    for (const [file, list] of byFile) collection.set(vscode.Uri.joinPath(folder.uri, file), list);
  }

  function rebuildAll(): void {
    cache.clear();
    userRules = undefined;
    for (const folder of vscode.workspace.workspaceFolders ?? []) folderState(folder);
    lensChanged.fire();
    refreshActive();
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  function scheduleRebuild(): void {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      rebuildAll();
    }, REBUILD_DELAY_MS);
  }
  // 규칙 파일이 아닌 일반 파일이 생기거나 지워지면 전체를 다시 훑지 않고 파일 목록만 고친 뒤 진단을 다시 계산한다.
  let lightTimer: ReturnType<typeof setTimeout> | undefined;
  const pendingFiles = new Map<string, boolean>(); // uri 문자열 → 생성(true)/삭제(false)
  function onPlainFileChange(uri: vscode.Uri, created: boolean): void {
    pendingFiles.set(uri.toString(), created);
    if (lightTimer) clearTimeout(lightTimer);
    lightTimer = setTimeout(applyPlainFileChanges, REBUILD_DELAY_MS);
  }
  function applyPlainFileChanges(): void {
    lightTimer = undefined;
    const changes = [...pendingFiles];
    pendingFiles.clear();
    const { opts } = readOptions();
    const touched = new Set<string>();
    for (const [uriText, created] of changes) {
      const uri = vscode.Uri.parse(uriText);
      const folder = vscode.workspace.getWorkspaceFolder(uri);
      const state = folder ? cache.get(folder.uri.toString()) : undefined;
      if (!folder || !state) continue;
      const rel = path.relative(folder.uri.fsPath, uri.fsPath).split(path.sep).join('/');
      if (rel === '' || rel.startsWith('..') || rel.split('/').some((s) => IGNORED_DIRS.has(s) || s === '.git')) continue;
      if (classify(rel, opts.geminiFileNames)) {
        // 규칙 파일은 내용을 읽어야 하므로 전체 다시 읽기로 넘긴다.
        scheduleRebuild();
        continue;
      }
      const i = state.index.files.indexOf(rel);
      if (created && i < 0) state.index.files.push(rel);
      if (!created && i >= 0) state.index.files.splice(i, 1);
      touched.add(folder.uri.toString());
    }
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const state = cache.get(folder.uri.toString());
      if (!state || !touched.has(folder.uri.toString())) continue;
      state.diags = computeDiagnostics(state.index, opts);
      publish(folder, state);
    }
    if (touched.size > 0) {
      lensChanged.fire();
      refreshActive();
    }
  }
  // 종료할 때 남은 타이머를 지운다.
  context.subscriptions.push({
    dispose: () => {
      if (timer) clearTimeout(timer);
      if (lightTimer) clearTimeout(lightTimer);
    },
  });

  // ---- 활성 파일 판정 ----
  function refreshActive(): void {
    const t = translator();
    const editor = vscode.window.activeTextEditor;
    const uri = editor?.document.uri;
    const folder = uri ? vscode.workspace.getWorkspaceFolder(uri) : undefined;
    if (!uri || !folder) {
      current = undefined;
      tree.set([], uri ? t('view.outsideWorkspace') : t('view.noFile'));
      view.message = uri ? t('view.outsideWorkspace') : t('view.noFile');
      status.hide();
      return;
    }
    const rel = path.relative(folder.uri.fsPath, uri.fsPath).split(path.sep).join('/');
    const { opts, launchSetting } = readOptions();
    const res = resolveFile(folderState(folder).index, rel, { ...opts, launchDir: launchDirFor(launchSetting, rel) }, getUserRules());
    current = { folder, res };
    view.message = undefined;
    tree.set(buildTree(res, t), undefined, folder);
    status.text = `$(list-ordered) ${statusText(res, t)}`;
    status.tooltip = t('view.statusTooltip', { file: res.file, launch: res.launchDir === '' ? '.' : res.launchDir });
    status.show();
  }

  // ---- CodeLens: 규칙 파일 맨 위에 "N개 파일에 일치" ----
  const lensProvider: vscode.CodeLensProvider = {
    onDidChangeCodeLenses: lensChanged.event,
    provideCodeLenses(doc) {
      const folder = vscode.workspace.getWorkspaceFolder(doc.uri);
      if (!folder) return [];
      const rel = path.relative(folder.uri.fsPath, doc.uri.fsPath).split(path.sep).join('/');
      const state = folderState(folder);
      const rule = state.index.rules.find((r) => r.path === rel);
      const title = rule ? codeLensText(ruleMatches(state.index, rule), translator()) : undefined;
      return title ? [new vscode.CodeLens(new vscode.Range(0, 0, 0, 0), { title, command: '' })] : [];
    },
  };

  // ---- 빠른 수정(RP001·RP002) ----
  const actionProvider: vscode.CodeActionProvider = {
    provideCodeActions(doc, _range, ctx) {
      const t = translator();
      const actions: vscode.CodeAction[] = [];
      for (const vd of ctx.diagnostics) {
        const d = fixes.get(vd);
        if (!d?.fix) continue;
        const action = new vscode.CodeAction(t(d.fix.titleKey), vscode.CodeActionKind.QuickFix);
        const end = doc.lineAt(Math.min(doc.lineCount - 1, d.fix.endLine - 1)).range.end;
        action.edit = new vscode.WorkspaceEdit();
        action.edit.replace(doc.uri, new vscode.Range(d.fix.startLine - 1, 0, end.line, end.character), d.fix.newText);
        action.diagnostics = [vd];
        action.isPreferred = true;
        actions.push(action);
      }
      return actions;
    },
  };

  const ruleDocs: vscode.DocumentSelector = [{ scheme: 'file', pattern: RULE_GLOB }];
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(ruleDocs, lensProvider),
    vscode.languages.registerCodeActionsProvider(ruleDocs, actionProvider, { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }),
  );

  // ---- 명령 ----
  context.subscriptions.push(
    vscode.commands.registerCommand('ruleprism.refresh', () => rebuildAll()),

    vscode.commands.registerCommand('ruleprism.explainPattern', async () => {
      const t = translator();
      const pattern = await vscode.window.showInputBox({ prompt: vscode.l10n.t('Glob pattern to explain'), value: '*.ts' });
      if (!pattern) return;
      const file = await vscode.window.showInputBox({
        prompt: vscode.l10n.t('File path relative to the workspace root'),
        value: current?.res.file ?? 'src/x.ts',
      });
      if (!file) return;
      const items = explainPattern(pattern, file).map((row) => ({
        label: `${row.matches ? '$(check)' : '$(x)'} ${t(`agent.${row.agent}`)}`,
        description: row.matches ? t('explain.matches') : t('explain.noMatch'),
        detail: `${t(`explain.${row.key}`)} — ${row.doc}`,
      }));
      await vscode.window.showQuickPick(items, { title: `"${pattern}" → ${file}` });
    }),

    vscode.commands.registerCommand('ruleprism.copyJson', async () => {
      if (!current) {
        void vscode.window.showInformationMessage(vscode.l10n.t('Open a file in a workspace folder first.'));
        return;
      }
      const json = { schemaVersion: 1, root: current.folder.uri.fsPath, file: current.res.file, launchDir: current.res.launchDir, agents: current.res.agents };
      await vscode.env.clipboard.writeText(JSON.stringify(json, null, 2));
      void vscode.window.showInformationMessage(vscode.l10n.t('Copied the result as JSON.'));
    }),

    vscode.commands.registerCommand('ruleprism.setLaunchFolder', async () => {
      const picks = [
        { label: vscode.l10n.t('Workspace root'), value: 'workspaceRoot' },
        { label: vscode.l10n.t('Folder of the current file'), value: 'fileFolder' },
        { label: vscode.l10n.t('Another folder…'), value: '' },
      ];
      const pick = await vscode.window.showQuickPick(picks, { title: vscode.l10n.t('Where was the agent started?') });
      if (!pick) return;
      let value = pick.value;
      if (value === '') {
        const typed = await vscode.window.showInputBox({ prompt: vscode.l10n.t('Folder relative to the workspace root'), value: 'src' });
        if (!typed) return;
        value = typed;
      }
      await vscode.workspace.getConfiguration('ruleprism').update('launchFolder', value, vscode.ConfigurationTarget.Workspace);
    }),
  );

  // ---- 이벤트 ----
  const watcher = vscode.workspace.createFileSystemWatcher(RULE_GLOB);
  // 죽은 규칙·CodeLens 수는 일반 파일이 생기거나 지워져도 바뀐다(내용 변경은 무시).
  const anyFile = vscode.workspace.createFileSystemWatcher('**/*', false, true, false);
  context.subscriptions.push(
    watcher,
    anyFile,
    watcher.onDidCreate(scheduleRebuild),
    watcher.onDidChange(scheduleRebuild),
    watcher.onDidDelete(scheduleRebuild),
    anyFile.onDidCreate((uri) => onPlainFileChange(uri, true)),
    anyFile.onDidDelete((uri) => onPlainFileChange(uri, false)),
    vscode.window.onDidChangeActiveTextEditor(() => refreshActive()),
    vscode.workspace.onDidChangeWorkspaceFolders(() => scheduleRebuild()),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('ruleprism') || e.affectsConfiguration('chat.useAgentsMdFile') || e.affectsConfiguration('chat.useClaudeMdFile')) scheduleRebuild();
    }),
  );

  rebuildAll();
}

export function deactivate(): void {
  // 모든 자원은 context.subscriptions 로 정리된다.
}

function severityOf(d: Diagnostic): vscode.DiagnosticSeverity {
  if (d.severity === 'error') return vscode.DiagnosticSeverity.Error;
  if (d.severity === 'warning') return vscode.DiagnosticSeverity.Warning;
  return vscode.DiagnosticSeverity.Information;
}

/** 화면 모델(TreeNode)을 그대로 보여 주는 트리. */
class RulesTree implements vscode.TreeDataProvider<TreeNode>, vscode.Disposable {
  private nodes: TreeNode[] = [];
  private folder: vscode.WorkspaceFolder | undefined;
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;

  dispose(): void {
    this.changed.dispose();
  }

  set(nodes: TreeNode[], _message?: string, folder?: vscode.WorkspaceFolder): void {
    this.nodes = nodes;
    this.folder = folder;
    this.changed.fire();
  }

  getChildren(node?: TreeNode): TreeNode[] {
    return node ? node.children ?? [] : this.nodes;
  }

  getTreeItem(node: TreeNode): vscode.TreeItem {
    const item = new vscode.TreeItem(node.label, node.children ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
    item.id = node.id;
    item.description = node.description;
    item.tooltip = node.tooltip;
    if (node.kind === 'entry') {
      item.iconPath = new vscode.ThemeIcon(node.certainty === 'certain' ? 'pass' : node.certainty === 'conditional' ? 'history' : 'question');
    } else if (node.kind === 'skipped') {
      item.iconPath = new vscode.ThemeIcon('circle-slash');
    }
    if (node.file && this.folder) {
      const uri = node.file.startsWith('~/') ? vscode.Uri.file(path.join(os.homedir(), node.file.slice(2))) : vscode.Uri.joinPath(this.folder.uri, node.file);
      item.resourceUri = uri;
      item.command = { command: 'vscode.open', title: 'Open', arguments: [uri] };
    }
    return item;
  }
}
