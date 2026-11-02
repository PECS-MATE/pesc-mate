export const DEFAULT_A4 = { orientation: 'portrait', columns: 4, rows: 6, margin: 10, gap: 3, size: 40, labels: true };
export const MAX_A4_PAGES = 5;
export const MAX_A4_FILE_BYTES = 30 * 1024 * 1024;

export function a4Geometry(settings) {
  const { orientation, columns, rows, margin, gap, size } = settings;
  if (!['portrait', 'landscape'].includes(orientation) || !Number.isInteger(columns) || columns < 1 || columns > 8
    || !Number.isInteger(rows) || rows < 1 || rows > 10 || !Number.isFinite(margin) || margin < 5 || margin > 20
    || !Number.isFinite(gap) || gap < 0 || gap > 10 || ![0, 40, 50, 60].includes(size)
    || typeof settings.labels !== 'boolean') throw new Error('용지 설정을 확인해 주세요.');
  const width = orientation === 'portrait' ? 210 : 297;
  const height = orientation === 'portrait' ? 297 : 210;
  const cellWidth = size || (width - 2 * margin - gap * (columns - 1)) / columns;
  const cellHeight = size || (height - 2 * margin - gap * (rows - 1)) / rows;
  if (cellWidth < 15 || cellHeight < 15 || columns * cellWidth + (columns - 1) * gap > width - 2 * margin + .01
    || rows * cellHeight + (rows - 1) * gap > height - 2 * margin + .01) throw new Error('카드가 A4 영역을 벗어나요. 행·열이나 여백을 줄여 주세요.');
  return { width, height, cellWidth, cellHeight, capacity: columns * rows };
}

export function a4Preset(settings, size) {
  const width = settings.orientation === 'portrait' ? 210 : 297;
  const height = settings.orientation === 'portrait' ? 297 : 210;
  return { ...settings, size, columns: Math.min(8, Math.floor((width - 2 * settings.margin + settings.gap) / (size + settings.gap))),
    rows: Math.min(10, Math.floor((height - 2 * settings.margin + settings.gap) / (size + settings.gap))) };
}

export function a4Resize(layout, settings) {
  const before = a4Geometry(layout.settings), after = a4Geometry(settings);
  const lastFilled = layout.slots.reduce((last, slot, index) => slot ? index : last, -1);
  const pages = Math.max(Math.ceil(layout.slots.length / before.capacity), Math.ceil((lastFilled + 1) / after.capacity));
  if (pages > MAX_A4_PAGES) throw new Error('최대 5쪽까지 편집할 수 있어요. 먼저 배치를 줄여 주세요.');
  return { settings, slots: Array.from({ length: pages * after.capacity }, (_, index) => layout.slots[index] || null) };
}

// Back faces mirror columns for portrait long-edge / landscape short-edge duplex.
export function a4BackSlots(layout) {
  const { columns } = layout.settings;
  return layout.slots.map((_, index) => layout.slots[Math.floor(index / columns) * columns + columns - 1 - index % columns]);
}

export function validateA4Project(project, targetId) {
  if (project?.format !== 'pecs-mate-a4' || project.version !== 1 || project.targetId !== targetId
    || !Array.isArray(project.cards) || project.cards.length > 60 || !Array.isArray(project.layout?.slots)) {
    throw new Error('이 아이의 PECS Mate A4 편집 파일을 선택해 주세요.');
  }
  const { capacity } = a4Geometry(project.layout.settings);
  const slots = project.layout.slots;
  if (!slots.length || slots.length % capacity || slots.length > capacity * MAX_A4_PAGES) throw new Error('쪽 구성이 올바르지 않아요.');
  const ids = new Set();
  for (const card of project.cards) {
    if (typeof card.id !== 'string' || card.id.length > 100 || ids.has(card.id) || typeof card.label !== 'string' || card.label.length > 30
      || typeof card.meaning !== 'string' || card.meaning.length > 120 || typeof card.category !== 'string' || card.category.length > 100
      || !['ready', 'failed', 'saved', 'uncertain'].includes(card.status) || typeof card.image !== 'string'
      || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(card.image)) throw new Error('편집 파일의 카드 정보가 올바르지 않아요.');
    for (const key of ['existingId', 'savedId']) if (card[key] != null && (typeof card[key] !== 'string' || card[key].length > 100)) throw new Error('카드 식별값이 올바르지 않아요.');
    ids.add(card.id);
  }
  for (const slot of slots) {
    if (slot === null) continue;
    if (!slot || !ids.has(slot.rowId) || typeof slot.label !== 'string' || slot.label.length > 30
      || !Number.isFinite(slot.zoom) || slot.zoom < 1 || slot.zoom > 2 || !Number.isFinite(slot.fontSize) || slot.fontSize < 8 || slot.fontSize > 24
      || !['contain', 'cover'].includes(slot.fit)) throw new Error('칸의 편집 정보가 올바르지 않아요.');
  }
  return project;
}
