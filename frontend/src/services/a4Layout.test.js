import { expect, it } from 'vitest';
import { DEFAULT_A4, a4BackSlots, a4Geometry, validateA4Project } from './a4Layout';
import { editorProject, projectRows } from './a4Sharing';
it('keeps A4 millimetres and mirrors each duplex row without changing page order', () => {
  expect(a4Geometry(DEFAULT_A4)).toMatchObject({ width: 210, height: 297, capacity: 24, cellWidth: 40 });
  const slots = Array.from({ length: 48 }, (_, index) => index);
  const back = a4BackSlots({ settings: DEFAULT_A4, slots });
  expect(back.slice(0, 8)).toEqual([3, 2, 1, 0, 7, 6, 5, 4]);
  expect(back[24]).toBe(27); expect(slots[0]).toBe(0);
});
it('saves/loads an account-scoped project and rejects another account', () => {
  const card = { id: 'synthetic', label: '물', meaning: '', category: '', status: 'ready', image: 'data:image/png;base64,AA==' };
  const project = { format: 'pecsmate-a4', version: 1, targetId: 'one', cards: [card],
    layout: { settings: DEFAULT_A4, slots: Array(24).fill(null) } };
  const restored = JSON.parse(JSON.stringify(project));
  expect(validateA4Project(restored, 'one')).toEqual(project);
  expect(() => validateA4Project(restored, 'two')).toThrow();
  expect(projectRows(project)[0].preview).toBe(card.image);
  expect(editorProject({ cards: [card], layout: project.layout }, 'two').targetId).toBe('two');
});
it('rejects malformed slots, duplicate cards and geometry overflow', () => {
  expect(() => a4Geometry({ ...DEFAULT_A4, columns: 8 })).toThrow();
  const project = { format: 'pecsmate-a4', version: 1, targetId: 'one', cards: [],
    layout: { settings: DEFAULT_A4, slots: Array(24).fill({ rowId: 'missing' }) } };
  expect(() => validateA4Project(project, 'one')).toThrow();
});
