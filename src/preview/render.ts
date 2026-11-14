// 정적 HTML 미리보기: 확장과 같은 코어·화면 모델로 사이드바·상태 표시줄·Problems 모양을 그린다.
// VS Code 화면이 아니라 README 촬영용 HTML 이다. 스크립트·외부 자원·서버 주소 없이 file:// 로 열린다.
// 사용: node out/preview/render.js [--out <폴더>]   (기본 docs/preview)
import * as fs from 'node:fs';
import * as path from 'node:path';
import { MIXED_MONOREPO } from '../core/demo-workspace';
import { computeDiagnostics } from '../core/diagnostics';
import { memoryReader } from '../core/fsreader';
import { resolveFile } from '../core/resolve';
import { scanWorkspace } from '../core/scan';
import { type Lang, makeT } from '../i18n/i18n';
import { buildTree, diagnosticMessage, statusText, type TreeNode } from '../view/model';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const ICON: Record<string, string> = { certain: '✔', conditional: '◷', uncertain: '?', skipped: '⊘' };

function nodeHtml(n: TreeNode): string {
  if (n.kind === 'agent') {
    const children = (n.children ?? []).map(nodeHtml).join('\n');
    return `<details open class="agent" data-agent="${esc(n.id)}"><summary><span class="label">${esc(n.label)}</span> <span class="desc">${esc(n.description ?? '')}</span></summary>\n<ul>\n${children}\n</ul></details>`;
  }
  const icon = n.kind === 'skipped' ? ICON.skipped : ICON[n.certainty ?? 'certain'];
  return `<li class="${n.kind} ${n.certainty ?? ''}"><span class="icon">${icon}</span> <span class="label">${esc(n.label)}</span> <span class="desc">${esc(n.description ?? '')}</span></li>`;
}

/** 한 언어의 미리보기 HTML 을 만든다. */
export function renderPreview(lang: Lang): string {
  const t = makeT(lang);
  const ws = MIXED_MONOREPO;
  const index = scanWorkspace(memoryReader(ws.files, { unreadable: ws.unreadable }));
  const res = resolveFile(index, ws.focusFile);
  const diags = computeDiagnostics(index);
  const tree = buildTree(res, t).map(nodeHtml).join('\n');
  const problems = diags
    .map(
      (d) =>
        `<li class="${d.severity}"><span class="sev">${esc(t(`severity.${d.severity}`))}</span> <span class="msg">${esc(diagnosticMessage(d, t))}</span> <span class="where">${esc(d.code)} · ${esc(d.file)}:${d.line}</span></li>`,
    )
    .join('\n');
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<title>${esc(t('preview.title'))}</title>
<style>
  body { margin: 0; font: 13px/1.5 -apple-system, "Segoe UI", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif; background: #1e1e1e; color: #ccc; }
  .caption { padding: 8px 14px; background: #2d2d30; color: #9cdcfe; font-size: 12px; }
  .layout { display: grid; grid-template-columns: 560px 1fr; min-height: 560px; }
  .sidebar { background: #252526; border-right: 1px solid #333; padding: 6px 0; }
  .editor { padding: 14px; color: #d4d4d4; font-family: Menlo, Consolas, monospace; }
  h2 { font-size: 11px; letter-spacing: .06em; text-transform: uppercase; margin: 4px 14px 8px; color: #bbb; }
  details.agent { margin: 0 6px 4px; }
  summary { cursor: default; padding: 2px 4px; }
  summary .label { color: #fff; font-weight: 600; }
  .desc { color: #8c8c8c; margin-left: 6px; }
  ul { list-style: none; margin: 0; padding-left: 18px; }
  li { padding: 1px 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  li.entry .label { color: #e0e0e0; }
  li.skipped { color: #7a7a7a; }
  .icon { display: inline-block; width: 14px; text-align: center; }
  li.certain .icon { color: #89d185; } li.conditional .icon { color: #d7ba7d; } li.uncertain .icon { color: #c586c0; }
  .problems { border-top: 1px solid #333; background: #1e1e1e; padding: 6px 0 10px; }
  .problems li { padding: 2px 14px; white-space: normal; }
  .sev { display: inline-block; min-width: 54px; font-weight: 600; }
  li.warning .sev { color: #cca700; } li.info .sev { color: #3794ff; } li.error .sev { color: #f14c4c; }
  .where { color: #8c8c8c; margin-left: 6px; }
  .status { background: #007acc; color: #fff; padding: 3px 14px; font-size: 12px; }
</style>
</head>
<body>
<div class="caption">${esc(t('preview.caption', { name: ws.name }))}</div>
<div class="layout">
  <section class="sidebar">
    <h2>${esc(t('preview.sidebar'))}</h2>
    ${tree}
  </section>
  <section class="editor">${esc(ws.focusFile)}<pre>${esc(ws.files[ws.focusFile])}</pre></section>
</div>
<section class="problems">
  <h2>${esc(t('preview.problems'))} (${diags.length})</h2>
  <ul>
${problems}
  </ul>
</section>
<div class="status" title="${esc(t('preview.status'))}">${esc(statusText(res, t))}</div>
</body>
</html>
`;
}

/** 두 언어 파일을 쓴다. 돌려주는 값은 쓴 경로. */
export function writePreviews(outDir: string): string[] {
  fs.mkdirSync(outDir, { recursive: true });
  return (['en', 'ko'] as Lang[]).map((lang) => {
    const target = path.join(outDir, `sidebar.${lang}.html`);
    fs.writeFileSync(target, renderPreview(lang), 'utf8');
    return target;
  });
}

if (require.main === module) {
  const i = process.argv.indexOf('--out');
  const outDir = i >= 0 && process.argv[i + 1] ? path.resolve(process.argv[i + 1]) : path.join(__dirname, '..', '..', 'docs', 'preview');
  try {
    for (const p of writePreviews(outDir)) process.stdout.write(`${p}\n`);
  } catch (e) {
    process.stderr.write(`error: cannot write the preview (${(e as Error).message.split('\n')[0]})\nhint: pass a writable folder with --out <dir>\n`);
    process.exitCode = 2;
  }
}
