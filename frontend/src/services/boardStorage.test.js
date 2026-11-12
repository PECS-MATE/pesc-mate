import { expect, it } from 'vitest';
import { loadBoard, saveBoard, clearBoard } from './boardStorage';
it('restores duplicate selections in order, removes unavailable cards and keeps accounts separate', () => {
  const water = { id: 'water' }, drink = { id: 'drink' };
  saveBoard('one', [water, drink, water, { id: 'deleted' }]); saveBoard('two', [drink]);
  expect(localStorage.getItem('pesc-mate-board:one')).toBe('["water","drink","water","deleted"]');
  expect(loadBoard('one', [water, drink])).toEqual([water, drink, water]);
  clearBoard('one'); expect(loadBoard('two', [drink])).toEqual([drink]);
});
it('recovers corrupt storage and caps restored cards at twelve', () => {
  localStorage.setItem('pesc-mate-board:one', '{'); expect(loadBoard('one', [])).toEqual([]);
  saveBoard('one', Array(13).fill({ id: 'water' })); expect(loadBoard('one', [{ id: 'water' }])).toHaveLength(12);
});
