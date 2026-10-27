import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import RfidChipRegistration from '../../src/RfidChipRegistration';
import { request } from '../../src/services/api';

vi.mock('../../src/services/api', () => ({ request: vi.fn(), requestBlob: vi.fn() }));
vi.mock('../../src/UsbRfidReader', () => ({ default: ({ onUid, registration, eventScope }) => <div>
  <span>{registration && eventScope === 'shared' ? '관리자 등록 전용' : '잘못된 모드'}</span>
  <button onClick={() => onUid('01010101')}>첫 칩 읽기</button><button onClick={() => onUid('02020202')}>다음 칩 읽기</button>
</div> }));
const cards = [{ id: 'water', label: '물', category: '음식' }, { id: 'rice', label: '밥', category: '음식' }];
let bindings;
beforeEach(() => {
  localStorage.setItem('pesc-mate-token', 'synthetic-operator'); bindings = [];
  request.mockReset().mockImplementation(async (path, options) => {
    if (path === '/rfid/admin/catalog') return { cards, bindings };
    if (path === '/rfid/admin/bindings') {
      const body = JSON.parse(options.body);
      return { saved: true, binding: body.card_id ? { uid: body.uid, card_id: body.card_id, label: cards.find(card => card.id === body.card_id).label, available: true, revision: 42 } : null };
    }
    throw new Error('Unexpected admin RFID request');
  });
});
async function start() {
  const user = userEvent.setup(); render(<RfidChipRegistration accountId="operator" />);
  await waitFor(() => expect(screen.queryByText('공용 칩 목록을 불러오는 중입니다…')).toBeNull());
  return user;
}
test('첫 칩은 확인 동안 고정하고 카드 미리보기와 비밀번호 확인 뒤에만 저장한다', async () => {
  const user = await start(); await user.click(screen.getByRole('button', { name: '첫 칩 읽기', exact: true }));
  await user.selectOptions(screen.getByRole('combobox', { name: '연결할 공용 그림카드' }), 'water');
  await user.click(screen.getByRole('button', { name: '다음 칩 읽기', exact: true }));
  expect(screen.getByLabelText('인식한 칩 UID').textContent).toBe('01010101');
  expect(screen.getByRole('img', { name: '물 그림' })).toBeTruthy();
  expect(request.mock.calls.filter(([, options]) => options?.method === 'PUT')).toHaveLength(0);
  await user.click(screen.getByRole('button', { name: '칩 등록 저장' }));
  const dialog = within(screen.getByRole('dialog'));
  expect(dialog.getByText(/모든 사용자에게 적용됩니다/)).toBeTruthy();
  await user.type(dialog.getByLabelText('본인 비밀번호'), 'synthetic-password');
  await user.click(dialog.getByRole('button', { name: '확인 후 실행' }));
  await screen.findByText(/저장 완료/);
  const write = request.mock.calls.find(([, options]) => options?.method === 'PUT');
  expect(JSON.parse(write[1].body)).toEqual({ uid: '01010101', card_id: 'water', expected_revision: null, password: 'synthetic-password' });
  expect(localStorage.getItem('synthetic-password')).toBeNull();
  await user.click(screen.getByRole('button', { name: '다음 칩 인식', exact: true }));
  await user.click(screen.getByRole('button', { name: '다음 칩 읽기', exact: true }));
  expect(screen.getByLabelText('인식한 칩 UID').textContent).toBe('02020202');
  expect(screen.getByRole('combobox', { name: '연결할 공용 그림카드' }).value).toBe('');
});
test('기존 칩의 중복 안내와 연결 해제 확인 취소는 원본을 보존한다', async () => {
  bindings = [{ uid: '01010101', card_id: 'rice', label: '밥', available: true, revision: 7 }];
  const user = await start(); await user.click(screen.getByRole('button', { name: '첫 칩 읽기', exact: true }));
  expect(screen.getByText('이미 등록된 칩: 밥')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: '연결 해제', exact: true }));
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '취소', exact: true }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(request.mock.calls.some(([, options]) => options?.method === 'PUT')).toBe(false);
  expect(within(screen.getByRole('list', { name: '등록된 공용 칩' })).getByText('밥')).toBeTruthy();
});
test('서버 충돌은 칩과 선택 카드를 보존하고 새로고침 안내를 표시한다', async () => {
  const original = request.getMockImplementation();
  request.mockImplementation((path, options) => options?.method === 'PUT' ? Promise.reject(new Error('등록 버전 충돌')) : original(path, options));
  const user = await start(); await user.click(screen.getByRole('button', { name: '첫 칩 읽기', exact: true }));
  await user.selectOptions(screen.getByRole('combobox', { name: '연결할 공용 그림카드' }), 'water');
  await user.click(screen.getByRole('button', { name: '칩 등록 저장' }));
  await user.type(screen.getByLabelText('본인 비밀번호'), 'synthetic-password');
  await user.click(screen.getByRole('button', { name: '확인 후 실행' }));
  await screen.findByRole('alert');
  expect(screen.getByLabelText('인식한 칩 UID').textContent).toBe('01010101');
  expect(screen.getByRole('combobox', { name: '연결할 공용 그림카드' }).value).toBe('water');
  expect(screen.getByRole('alert').textContent).toContain('새로고침');
});
