import { CARD_META } from '../config/appDefaults';
import { cardImage } from './cardMedia';
import { DEFAULT_A4 } from './a4Layout';
import { makeShareProject } from './a4Sharing';

// Only bundled cards belong in public starter boards, never account photos.
export function categoryBoards(cards = [], categories = []) {
  const groups = new Map();
  for (const card of cards) {
    if (card.custom || !Object.hasOwn(CARD_META, card.id) || !card.category) continue;
    const label = CARD_META[card.id].label;
    const image = cardImage({ label });
    if (!image) continue;
    if (!groups.has(card.category)) groups.set(card.category, new Map());
    groups.get(card.category).set(card.id, { id: card.id, label, preview: image });
  }
  const names = [...new Set([...categories.map(category => category.name), ...groups.keys()])];
  return names.flatMap(name => {
    const rows = [...(groups.get(name)?.values() || [])];
    // Sharing supports at most 60 distinct cards per project.
    return Array.from({ length: Math.ceil(rows.length / 60) }, (_, index) => ({
      id: `builtin-category:${name}:${index}`, category: name,
      title: `${name} 카드판${rows.length > 60 ? ` ${index + 1}` : ''}`,
      rows: rows.slice(index * 60, (index + 1) * 60),
    }));
  });
}

export async function categoryBoardProject(board) {
  const capacity = DEFAULT_A4.columns * DEFAULT_A4.rows;
  const layout = { settings: { ...DEFAULT_A4 }, slots: Array.from({
    length: Math.ceil(board.rows.length / capacity) * capacity,
  }, (_, index) => board.rows[index] ? {
    rowId: board.rows[index].id, label: board.rows[index].label,
    zoom: 1, fontSize: 14, fit: 'contain',
  } : null) };
  return makeShareProject(board.rows, layout);
}
