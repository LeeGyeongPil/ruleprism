// 파일 읽기 인터페이스. 디스크와 메모리(예제·테스트 픽스처) 두 구현이 같은 모양을 가진다.
// 판정 코어는 이 인터페이스만 보므로, 테스트는 디스크에 아무것도 쓰지 않고 돌 수 있다.
import * as fs from 'node:fs';
import * as path from 'node:path';

/** 색인할 때 들어가지 않는 폴더. 큰 모노레포에서 느려지지 않게 한다. */
export const IGNORED_DIRS = new Set(['node_modules', '.git', 'out', 'dist', '.next', 'build', 'coverage', '.venv', '__pycache__']);
export const DEFAULT_MAX_FILES = 20000;

export interface ListResult {
  /** 루트 기준 상대 경로('/' 구분), 정렬됨. */
  files: string[];
  /** 파일 수 상한에 걸려 목록이 잘렸는가. */
  truncated: boolean;
  /** `.git` 이 있는 폴더(루트 기준, '' = 루트). Codex·Gemini 경계에 쓴다. */
  gitDirs: string[];
  /** 읽지 못한 폴더와 오류 코드. */
  unreadableDirs: { dir: string; error: string }[];
}

export interface FsReader {
  /** isRule: paths that must always be listed, even past the file limit (rule files). */
  list(isRule?: (rel: string) => boolean): ListResult;
  /** 파일 내용을 읽는다. 실패하면 예외를 던진다(호출자가 RP008 로 바꾼다). */
  readText(rel: string): string;
}

/** 오류 객체에서 짧은 코드(EACCES 등)를 뽑는다. */
export function errorCode(e: unknown): string {
  if (e && typeof e === 'object' && 'code' in e && typeof (e as { code: unknown }).code === 'string') {
    return (e as { code: string }).code;
  }
  return e instanceof Error ? e.message : String(e);
}

/** 디스크 작업 공간 읽기. 심볼릭 링크는 따라가지 않는다. */
export function diskReader(root: string, maxFiles = DEFAULT_MAX_FILES): FsReader {
  return {
    list(isRule?: (rel: string) => boolean): ListResult {
      const files: string[] = [];
      const gitDirs: string[] = [];
      const unreadableDirs: { dir: string; error: string }[] = [];
      let truncated = false;
      // 재귀 대신 스택: 깊은 폴더에서도 호출 스택이 넘치지 않는다.
      const stack: string[] = [''];
      while (stack.length > 0) {
        const rel = stack.pop() as string;
        let dirents: fs.Dirent[];
        try {
          dirents = fs.readdirSync(path.join(root, rel), { withFileTypes: true });
        } catch (e) {
          unreadableDirs.push({ dir: rel, error: errorCode(e) });
          continue;
        }
        for (const d of dirents) {
          const childRel = rel ? `${rel}/${d.name}` : d.name;
          if (d.name === '.git') {
            gitDirs.push(rel);
            continue;
          }
          if (d.isDirectory()) {
            if (!IGNORED_DIRS.has(d.name)) stack.push(childRel);
          } else if (d.isFile()) {
            // 규칙 파일은 상한과 무관하게 항상 담는다(조용히 빠지면 판정이 틀어진다).
            if (files.length >= maxFiles && !(isRule && isRule(childRel))) {
              truncated = true;
              continue;
            }
            files.push(childRel);
          }
          // 심볼릭 링크·특수 파일은 건너뛴다(0.1 범위 밖).
        }
      }
      files.sort();
      gitDirs.sort();
      return { files, truncated, gitDirs, unreadableDirs };
    },
    readText(rel: string): string {
      return fs.readFileSync(path.join(root, rel), 'utf8');
    },
  };
}

export interface MemoryReaderOptions {
  /** 읽으려 하면 EACCES 를 던질 경로(견고성 테스트용). */
  unreadable?: string[];
  maxFiles?: number;
}

/**
 * 메모리 작업 공간: { "경로": "내용" } 맵.
 * `.git/HEAD` 같은 키가 있으면 그 폴더에 `.git` 이 있는 것으로 본다.
 */
export function memoryReader(files: Record<string, string>, opts: MemoryReaderOptions = {}): FsReader {
  const unreadable = new Set(opts.unreadable ?? []);
  const maxFiles = opts.maxFiles ?? DEFAULT_MAX_FILES;
  return {
    list(isRule?: (rel: string) => boolean): ListResult {
      const out: string[] = [];
      const gitDirs = new Set<string>();
      let truncated = false;
      for (const p of Object.keys(files).sort()) {
        const parts = p.split('/');
        const gitIdx = parts.indexOf('.git');
        if (gitIdx >= 0) {
          gitDirs.add(parts.slice(0, gitIdx).join('/'));
          continue;
        }
        if (parts.some((s) => IGNORED_DIRS.has(s))) continue;
        if (out.length >= maxFiles && !(isRule && isRule(p))) {
          truncated = true;
          continue;
        }
        out.push(p);
      }
      return { files: out, truncated, gitDirs: [...gitDirs].sort(), unreadableDirs: [] };
    },
    readText(rel: string): string {
      if (unreadable.has(rel)) {
        const err = new Error(`EACCES: permission denied, open '${rel}'`) as Error & { code: string };
        err.code = 'EACCES';
        throw err;
      }
      const text = files[rel];
      if (text === undefined) {
        const err = new Error(`ENOENT: no such file, open '${rel}'`) as Error & { code: string };
        err.code = 'ENOENT';
        throw err;
      }
      return text;
    },
  };
}
