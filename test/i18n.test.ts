// AC-7: 영어·한국어 — 언어 결정 순서, 카탈로그 키 일치, 확장 nls·l10n 번들.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { catalogKeys, detectLang, translate } from '../src/i18n/i18n';
import { REPO, runCli } from './helpers';

const readJson = (p: string) => JSON.parse(fs.readFileSync(path.join(REPO, p), 'utf8'));

describe('language selection', () => {
  it('--lang ko / --lang en switch the help text', () => {
    const ko = runCli(['--help', '--lang', 'ko']);
    const en = runCli(['--help', '--lang', 'en']);
    expect(ko.code).toBe(0);
    expect(ko.stdout).toContain('사용법:');
    expect(en.stdout).toContain('Usage:');
    expect(en.stdout).not.toContain('사용법:');
  });

  it('--lang ko / --lang en switch the which output', () => {
    const args = ['which', 'src/web/components/Button.tsx', '--example', 'mixed-monorepo'];
    expect(runCli([...args, '--lang', 'ko']).stdout).toContain('(작업 폴더: .)');
    expect(runCli([...args, '--lang', 'en']).stdout).toContain('(launch folder: .)');
  });

  it('falls back through RULEPRISM_LANG, LC_ALL, LC_MESSAGES, LANG (non-Korean is English)', () => {
    expect(runCli(['--help'], { env: { RULEPRISM_LANG: 'ko' } }).stdout).toContain('사용법:');
    expect(runCli(['--help'], { env: { LANG: 'ko_KR.UTF-8' } }).stdout).toContain('사용법:');
    expect(runCli(['--help'], { env: { LANG: 'fr_FR.UTF-8' } }).stdout).toContain('Usage:');
    expect(runCli(['--help'], { env: {} }).stdout).toContain('Usage:');
    // 앞 순위가 이긴다.
    expect(runCli(['--help', '--lang', 'en'], { env: { RULEPRISM_LANG: 'ko' } }).stdout).toContain('Usage:');
    expect(runCli(['--help'], { env: { RULEPRISM_LANG: 'en', LANG: 'ko_KR.UTF-8' } }).stdout).toContain('Usage:');
    expect(runCli(['--help'], { env: { LC_ALL: 'en_US.UTF-8', LANG: 'ko_KR.UTF-8' } }).stdout).toContain('Usage:');
  });

  it('detectLang order as a unit', () => {
    expect(detectLang(undefined, {})).toBe('en');
    expect(detectLang(undefined, { LC_MESSAGES: 'ko_KR' })).toBe('ko');
    expect(detectLang('ko', { RULEPRISM_LANG: 'en' })).toBe('ko');
    expect(detectLang(undefined, { RULEPRISM_LANG: '', LANG: 'ko_KR.UTF-8' })).toBe('ko');
  });

  it('fills placeholders', () => {
    expect(translate('en', 'reason.paths-matched', { detail: '*.md' })).toBe('paths matched "*.md"');
    expect(translate('ko', 'reason.paths-matched', { detail: '*.md' })).toBe('paths 일치 "*.md"');
  });
});

describe('catalog parity', () => {
  it('messages.en.json and messages.ko.json have the same keys', () => {
    expect(catalogKeys('ko')).toEqual(catalogKeys('en'));
  });

  it('every reason code and diagnostic key used by the core has a message', async () => {
    const types = fs.readFileSync(path.join(REPO, 'src/core/types.ts'), 'utf8');
    const block = types.slice(types.indexOf('export type ReasonCode'), types.indexOf('/** 한 에이전트가'));
    const reasons = [...block.matchAll(/\| '([a-z-]+)'/g)].map((m) => m[1]);
    expect(reasons.length).toBeGreaterThan(20);
    const keys = new Set(catalogKeys('en'));
    for (const r of reasons) expect(keys.has(`reason.${r}`), `reason.${r}`).toBe(true);
    const src = ['diagnostics.ts', 'fixes.ts'].map((f) => fs.readFileSync(path.join(REPO, 'src/core', f), 'utf8')).join('\n');
    for (const m of src.matchAll(/'((?:diag|fix)\.[A-Za-z0-9.]+)'/g)) expect(keys.has(m[1]), m[1]).toBe(true);
  });

  it('package.nls.json and package.nls.ko.json have the same keys', () => {
    expect(Object.keys(readJson('package.nls.ko.json')).sort()).toEqual(Object.keys(readJson('package.nls.json')).sort());
  });

  it('every %key% in package.json exists in package.nls.json', () => {
    const manifest = fs.readFileSync(path.join(REPO, 'package.json'), 'utf8');
    const used = [...manifest.matchAll(/"%([\w.]+)%"/g)].map((m) => m[1]);
    expect(used.length).toBeGreaterThan(5);
    const nls = readJson('package.nls.json');
    for (const k of used) expect(nls[k], k).toBeTypeOf('string');
  });

  it('every vscode.l10n.t string in the extension exists in l10n/bundle.l10n.ko.json', () => {
    const ext = fs.readFileSync(path.join(REPO, 'src/extension/extension.ts'), 'utf8');
    const used = [...ext.matchAll(/l10n\.t\('((?:[^'\\]|\\.)*)'/g)].map((m) => m[1]);
    expect(used.length).toBeGreaterThan(5);
    const bundle = readJson('l10n/bundle.l10n.ko.json');
    for (const s of used) expect(bundle[s], s).toBeTypeOf('string');
    // 번들에 쓰이지 않는 문자열이 남지 않게
    for (const k of Object.keys(bundle)) expect(used, k).toContain(k);
  });

  it('package.json points VS Code at the l10n folder', () => {
    expect(readJson('package.json').l10n).toBe('./l10n');
  });
});
