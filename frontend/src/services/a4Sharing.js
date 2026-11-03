import { validateA4Project } from './a4Layout';

export const A4_TOPICS = ['일상', '식사', '감정', '외출', '학교', '기타'];
export const A4_STATUS = { private: '비공개', pending: '승인 대기', approved: '공개 중', rejected: '반려', withdrawn: '공유 중단' };

// Sharing is a separate derivative: omit child IDs, source IDs and unused photos.
export async function makeShareProject(rows, layout, duplex = false) {
  const used = new Set(layout.slots.filter(Boolean).map(slot => slot.rowId));
  if (!used.size) throw new Error('공유할 카드를 A4에 먼저 배치해 주세요.');
  const mapping = new Map(), cards = [];
  for (const row of rows.filter(item => used.has(item.id))) {
    const id = `c${cards.length + 1}`; mapping.set(row.id, id);
    const image = new Image(); image.src = row.preview; await image.decode();
    const ratio = Math.min(1, 768 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    const printedLabel = layout.settings.labels || duplex ? layout.slots.find(slot => slot?.rowId === row.id && slot.label)?.label || (duplex ? row.label || '' : '') : '';
    cards.push({ id, label: printedLabel, image: canvas.toDataURL('image/webp', .88) });
  }
  if (cards.length !== used.size) throw new Error('배치에 없는 원본이 있어요. 빈칸을 확인해 주세요.');
  const project = { format: 'pecsmate-a4-share', version: 1, duplex, cards,
    layout: { settings: { ...layout.settings }, slots: layout.slots.map(slot => slot ? {
      rowId: mapping.get(slot.rowId), label: layout.settings.labels || duplex ? slot.label || (duplex ? rows.find(row => row.id === slot.rowId)?.label || '' : '') : '', zoom: slot.zoom, fontSize: slot.fontSize, fit: slot.fit,
    } : null) } };
  if (new Blob([JSON.stringify(project)]).size > 11 * 1024 * 1024) throw new Error('공유할 사진 수나 이미지 용량을 줄여 주세요.');
  return project;
}

export function editorProject(project, targetId = null) {
  return validateA4Project({ format: 'pecsmate-a4', version: 1, targetId, layout: project.layout,
    cards: project.cards.map(card => ({ id: card.id, label: card.label, meaning: '', category: '', status: 'ready', image: card.image })) }, targetId);
}

export function projectRows(project) {
  return project.cards.map(card => ({ ...card, preview: card.image }));
}
