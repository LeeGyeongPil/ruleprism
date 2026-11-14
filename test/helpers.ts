// 테스트 공용: 예제 작업 공간을 메모리로 색인하고, 빌드된 CLI 를 자식 프로세스로 돌린다.
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DEMO_WORKSPACES } from '../src/core/demo-workspace';
import { memoryReader } from '../src/core/fsreader';
import { scanWorkspace, type RuleIndex } from '../src/core/scan';

export const REPO = path.resolve(__dirname, '..');
export const CLI = path.join(REPO, 'out', 'cli', 'main.js');

export function exampleIndex(name: 'mixed-monorepo' | 'clean-repo'): RuleIndex {
  const ws = DEMO_WORKSPACES[name];
  return scanWorkspace(memoryReader(ws.files, { unreadable: ws.unreadable }));
}

export interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** 언어 환경 변수를 비우고(테스트 기계의 LANG 영향 제거) CLI 를 실행한다. */
export function runCli(args: string[], opts: { cwd?: string; env?: Record<string, string> } = {}): CliResult {
  const env: Record<string, string> = { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? os.homedir(), ...(opts.env ?? {}) };
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: opts.cwd ?? REPO, env, encoding: 'utf8', timeout: 20000 });
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** 런타임 임시 폴더($TMPDIR). 테스트가 끝나면 지운다. */
export function tempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `ruleprism-${prefix}-`));
}
