// 공용 메시지 카탈로그(영어·한국어). CLI·확장 화면 모델·정적 미리보기가 모두 여기서 문구를 가져온다.
import en from './messages.en.json';
import ko from './messages.ko.json';

export type Lang = 'en' | 'ko';
export type MessageKey = keyof typeof en;
export type Translate = (key: string, args?: Record<string, string | number>) => string;

const CATALOGS: Record<Lang, Record<string, string>> = { en, ko };

/** 'ko', 'ko_KR.UTF-8', 'ko-KR' → 'ko'. 그 밖의 값은 영어. 빈 값은 undefined(다음 후보로 넘어감). */
export function langFromValue(value: string | undefined): Lang | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  return value.trim().toLowerCase().startsWith('ko') ? 'ko' : 'en';
}

/**
 * CLI 언어 결정: --lang > RULEPRISM_LANG > LC_ALL > LC_MESSAGES > LANG.
 * 처음으로 값이 있는 곳이 정한다. 한국어가 아니면 영어.
 */
export function detectLang(flag: string | undefined, env: NodeJS.ProcessEnv = process.env): Lang {
  for (const v of [flag, env.RULEPRISM_LANG, env.LC_ALL, env.LC_MESSAGES, env.LANG]) {
    const lang = langFromValue(v);
    if (lang) return lang;
  }
  return 'en';
}

/** `{name}` 자리를 채운다. 키가 없으면 영어, 그것도 없으면 키 자체. */
export function translate(lang: Lang, key: string, args: Record<string, string | number> = {}): string {
  const template = CATALOGS[lang][key] ?? CATALOGS.en[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (m, name: string) => (name in args ? String(args[name]) : m));
}

export function makeT(lang: Lang): Translate {
  return (key, args) => translate(lang, key, args);
}

export function catalogKeys(lang: Lang): string[] {
  return Object.keys(CATALOGS[lang]).sort();
}
