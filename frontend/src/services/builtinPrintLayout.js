import { DEFAULT_A4, a4Geometry } from './a4Layout.js';

export function builtinPrintLayout(count, mode = 'single') {
  if (!Number.isInteger(count) || count < 1) throw new Error('인쇄할 카드 수를 확인해 주세요.');
  if (mode === 'standard') return { ...DEFAULT_A4, ...a4Geometry(DEFAULT_A4), dense: false };
  if (mode !== 'single') throw new Error('인쇄 배치를 확인해 주세요.');
  const margin = 8, gap = 1, availableWidth = 210 - margin * 2, availableHeight = 297 - margin * 2;
  let best;
  for (let columns = 1; columns <= count; columns++) {
    const rows = Math.ceil(count / columns);
    const cellWidth = (availableWidth - gap * (columns - 1)) / columns;
    const cellHeight = (availableHeight - gap * (rows - 1)) / rows;
    if (cellWidth <= 0 || cellHeight <= 0) continue;
    const capacity = columns * rows;
    const score = Math.abs(Math.log(cellWidth / cellHeight)) + 3 * (capacity - count) / count;
    if (!best || score < best.score) best = { columns, rows, cellWidth, cellHeight, capacity, score };
  }
  if (!best || Math.min(best.cellWidth, best.cellHeight) < 5) throw new Error('카드가 너무 작아져요. 4cm 크기로 나눠 인쇄해 주세요.');
  return { ...best, margin, gap, dense: true };
}
