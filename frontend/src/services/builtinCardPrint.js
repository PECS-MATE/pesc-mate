import { categoryBoards, categoryBoardProject } from './a4CategoryBoards';
import { DEFAULT_A4, a4Geometry } from './a4Layout';
import printCss from '../assets/cardPrintPage.css?inline';

const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);

// A standalone print document, not a shared project: no 60-card editor limit,
// child identifiers, private photos, remote image URLs or automatic publishing.
export async function builtinCardPrint(cards, { onProgress = () => {}, current = () => true } = {}) {
  const boards = categoryBoards(cards), rows = [];
  if (!boards.length) throw new Error('인쇄할 기본 카드가 없어요.');
  for (const [index, board] of boards.entries()) {
    if (!current()) throw new DOMException('Cancelled', 'AbortError');
    const project = await categoryBoardProject(board);
    rows.push(...project.cards);
    onProgress(index + 1, boards.length);
  }
  if (!current()) throw new DOMException('Cancelled', 'AbortError');
  const { capacity, cellWidth, cellHeight } = a4Geometry(DEFAULT_A4);
  const pages = Math.ceil(rows.length / capacity);
  const sheets = Array.from({ length: pages }, (_, page) => `<div class="a4-sheet-group"><div class="card-print-page" aria-label="A4 ${page + 1}쪽" style="width:210mm;height:297mm;padding:${DEFAULT_A4.margin}mm;gap:${DEFAULT_A4.gap}mm;grid-template-columns:repeat(${DEFAULT_A4.columns},${cellWidth}mm);grid-template-rows:repeat(${DEFAULT_A4.rows},${cellHeight}mm)">${rows.slice(page * capacity, (page + 1) * capacity).map(card => `<div class="card-print-cell"><span class="a4-image-window"><img src="${escapeHtml(card.image)}" alt="${escapeHtml(card.label)}"></span><strong>${escapeHtml(card.label)}</strong></div>`).join('')}</div></div>`).join('');
  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PECS MATE 전체 기본 카드</title><style>${printCss}
@page{size:A4 portrait;margin:0}body{margin:0;font-family:Arial,"Malgun Gothic",sans-serif;color:#344b46;background:#eee}.print-guide{padding:16px;background:white;line-height:1.6}.print-guide p{margin:4px 0}button{padding:12px;font:inherit;cursor:pointer}.card-print-page{margin:12px auto}.card-print-cell strong{font-size:12pt}@media print{body{background:white}.print-guide{display:none}.card-print-page{margin:0}}
</style></head><body><header class="print-guide"><h1>PECS MATE 전체 기본 카드</h1><p>${rows.length}장 · A4 ${pages}쪽 · 카드 4×4cm</p><p>파일을 브라우저에서 열어 인쇄하거나 PDF로 저장하세요. 배율 100%, 용지 A4, 여백 없음, 머리글·바닥글 끄기를 선택하세요.</p><button type="button" onclick="window.print()">인쇄 · PDF 저장</button></header>${sheets}</body></html>`;
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  if (blob.size > 30 * 1024 * 1024) throw new Error('전체 인쇄 파일이 30MiB를 넘어요. 카테고리별 카드판을 이용해 주세요.');
  return { blob, count: rows.length, pages };
}
