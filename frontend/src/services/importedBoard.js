import { lockedSlotsPreserved } from './boardLocks';

export function importedBoardPlan(layout, imported, mode = 'append') {
  const before = (layout?.slots || []).map(slot => slot.card_id);
  const available = new Set((layout?.available_cards || []).map(card => card.id));
  const ids = imported.map(card => card.id);
  const issues = [];
  if (!ids.length || new Set(ids).size !== ids.length) issues.push('저장 완료한 서로 다른 카드가 필요합니다.');
  if (ids.some(id => !available.has(id))) issues.push('사용할 수 없는 가져온 카드가 있습니다. 최신 목록을 확인해 주세요.');
  if (!['append', 'replace'].includes(mode)) issues.push('카드판 적용 방식을 확인해 주세요.');
  const after = mode === 'replace' ? ids : [...before, ...ids.filter(id => !before.includes(id))];
  if (after.length > 30) issues.push('카드판은 최대 30장입니다. 기존 카드판을 정리하거나 교체 방식을 선택해 주세요.');
  if (!lockedSlotsPreserved(layout, after)) issues.push('잠긴 핵심 카드의 위치를 변경할 수 없습니다. 카드판 관리에서 확인해 주세요.');
  return { before, after, issues, changed: JSON.stringify(before) !== JSON.stringify(after) };
}
