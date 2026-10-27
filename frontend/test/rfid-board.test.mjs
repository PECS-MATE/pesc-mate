import assert from 'node:assert/strict';
import test from 'node:test';
import { rfidFingerprint, rfidSelection } from '../src/services/rfidBoard.js';

const cards = [{ id: 'water' }, { id: 'drink' }];
const state = { online: true, session_id: 'synthetic', device: { device_id: 'board' }, readers: [
  { reader_id: 3, status: 'PRESENT', card_id: 'drink' },
  { reader_id: 1, status: 'PRESENT', card_id: 'water' },
  { reader_id: 2, status: 'EMPTY', card_id: null },
] };
test('RFID 배열은 도착 시각 대신 위치 순서를 사용하고 현재 문장을 직접 바꾸지 않는다', () => {
  assert.deepEqual(rfidSelection(state, cards), cards);
  assert.equal(state.readers[0].reader_id, 3);
  assert.deepEqual(rfidSelection({ ...state, readers: state.readers.map(r => ({ ...r, status: 'EMPTY' })) }, cards), []);
});
test('오류·미등록·오래된 상태·다른 아동 카드는 문장에 적용하지 않는다', () => {
  for (const status of ['ERROR', 'UNMAPPED', 'UNAVAILABLE', 'STALE']) {
    assert.equal(rfidSelection({ ...state, readers: [{ ...state.readers[0], status }, ...state.readers.slice(1)] }, cards), null);
  }
  assert.equal(rfidSelection({ ...state, online: false }, cards), null);
  assert.equal(rfidSelection(state, [cards[0]]), null);
  assert.equal(rfidSelection({ ...state, readers: [state.readers[0], state.readers[0], state.readers[0]] }, cards), null);
});
test('서로 다른 태그가 같은 개념을 가리키면 반복 카드를 보존하고 단순 heartbeat는 변경 안내하지 않는다', () => {
  const repeated = { ...state, readers: state.readers.map(row => row.status === 'PRESENT' ? { ...row, card_id: 'water' } : row) };
  assert.deepEqual(rfidSelection(repeated, cards), [cards[0], cards[0]]);
  assert.equal(rfidFingerprint(state), rfidFingerprint({ ...state, event_id: 99, state_revision: 99 }));
  assert.notEqual(rfidFingerprint(state), rfidFingerprint({ ...state, session_id: 'new' }));
});
