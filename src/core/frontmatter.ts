// 앞머리(front matter) 파서.
// 1) 엄격 YAML(`yaml` 패키지)로 먼저 읽고, 2) 실패하면 줄 단위 관대한 파서로 다시 읽는다.
// Cursor 규칙은 따옴표 없는 `globs: **/*.ts` 를 흔히 쓰는데, 엄격 YAML 에서는 별칭(*) 오류가 난다.
import { parse as parseYaml } from 'yaml';

export interface FrontMatter {
  /** 파일이 `---` 줄로 시작하는가. */
  present: boolean;
  /** 닫는 `---` 줄이 있는가. */
  closed: boolean;
  /** 엄격 YAML 결과(성공 시) 또는 관대한 파서 결과(실패 시). */
  data: Record<string, unknown>;
  /** 엄격 YAML 오류(첫 줄)와 파일 기준 줄 번호. 닫히지 않은 앞머리도 오류로 본다. */
  strictError?: { message: string; line: number };
  /** 키 → 파일 기준 줄 번호(1부터). */
  keyLines: Record<string, number>;
  /** 키 → 그 키 값이 끝나는 줄(블록 목록이면 마지막 `- ` 줄). */
  keyEndLines: Record<string, number>;
  /** 앞머리를 뺀 본문. 앞머리가 깨졌으면 파일 전체. */
  body: string;
}

const NONE: Omit<FrontMatter, 'body'> = { present: false, closed: false, data: {}, keyLines: {}, keyEndLines: {} };

export function parseFrontMatter(text: string): FrontMatter {
  const src = text.replace(/^﻿/, '');
  const lines = src.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return { ...NONE, body: src };

  // 닫는 `---` 찾기(두 번째 줄부터).
  let close = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      close = i;
      break;
    }
  }
  if (close < 0) {
    // 닫히지 않은 앞머리: 도구들은 앞머리로 인식하지 못한다 → 본문 전체가 그대로 들어간다.
    return { ...NONE, present: true, closed: false, strictError: { message: 'front matter is not closed with ---', line: 1 }, body: src };
  }

  const yamlLines = lines.slice(1, close);
  const yamlText = yamlLines.join('\n');
  const body = lines.slice(close + 1).join('\n');
  const { keyLines, keyEndLines } = findKeyLines(yamlLines);

  try {
    const parsed: unknown = yamlText.trim() === '' ? {} : parseYaml(yamlText);
    if (parsed === null || parsed === undefined) {
      return { present: true, closed: true, data: {}, keyLines, keyEndLines, body };
    }
    if (typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {
        present: true,
        closed: true,
        data: lenientParse(yamlLines),
        strictError: { message: 'front matter is not a key: value mapping', line: 2 },
        keyLines,
        keyEndLines,
        body,
      };
    }
    return { present: true, closed: true, data: parsed as Record<string, unknown>, keyLines, keyEndLines, body };
  } catch (e) {
    const err = e as Error & { linePos?: { line: number }[] };
    // yaml 의 linePos 는 앞머리 안에서 1부터 → 파일 기준으로 +1(첫 `---` 줄).
    const inner = err.linePos?.[0]?.line ?? 1;
    // "… at line 1, column 20:" 꼬리는 줄 번호로 따로 알려 주므로 뗀다.
    const message = (err.message ?? String(e)).split('\n')[0].replace(/\s+at line \d+, column \d+:?\s*$/, '');
    return {
      present: true,
      closed: true,
      data: lenientParse(yamlLines),
      strictError: { message, line: inner + 1 },
      keyLines,
      keyEndLines,
      body,
    };
  }
}

/** 최상위 `key:` 줄 번호를 찾는다(파일 기준: 앞머리 첫 줄이 2번 줄). */
function findKeyLines(yamlLines: string[]): { keyLines: Record<string, number>; keyEndLines: Record<string, number> } {
  const keyLines: Record<string, number> = {};
  const keyEndLines: Record<string, number> = {};
  let current: string | undefined;
  yamlLines.forEach((line, i) => {
    const fileLine = i + 2;
    const m = /^([A-Za-z_][\w-]*)\s*:/.exec(line);
    if (m) {
      current = m[1];
      if (!(current in keyLines)) keyLines[current] = fileLine;
      keyEndLines[current] = fileLine;
    } else if (current && /^\s+-\s/.test(line)) {
      // 블록 목록 항목은 바로 위 키에 속한다.
      keyEndLines[current] = fileLine;
    } else if (line.trim() !== '' && !/^\s/.test(line)) {
      current = undefined;
    }
  });
  return { keyLines, keyEndLines };
}

/** 따옴표를 벗긴다. */
function unquote(s: string): string {
  const t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) return t.slice(1, -1);
  return t;
}

/** 줄 단위 관대한 파서: `key: value`, `key: [a, b]`, 블록 목록, true/false. */
export function lenientParse(yamlLines: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  let listKey: string | undefined;
  for (const line of yamlLines) {
    const item = /^\s+-\s+(.*)$/.exec(line);
    if (item && listKey) {
      (out[listKey] as string[]).push(unquote(item[1]));
      continue;
    }
    const m = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const [, key, rawValue] = m;
    const value = rawValue.trim();
    listKey = undefined;
    if (value === '') {
      out[key] = [];
      listKey = key;
    } else if (value.startsWith('[') && value.endsWith(']')) {
      out[key] = value
        .slice(1, -1)
        .split(',')
        .map(unquote)
        .filter((s) => s !== '');
    } else if (value === 'true' || value === 'false') {
      out[key] = value === 'true';
    } else {
      out[key] = unquote(value);
    }
  }
  return out;
}
