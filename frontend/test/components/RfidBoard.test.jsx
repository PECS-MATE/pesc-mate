import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import RfidBoard from '../../src/RfidBoard';
import { request } from '../../src/services/api';

vi.mock('../../src/services/api', () => ({ request: vi.fn() }));
const cards = [{ id: 'me', label: '나' }, { id: 'water', label: '물' }, { id: 'drink', label: '마시다' }];
const device = { device_id: 'synthetic', name: '검증 카드판', reader_labels: ['첫째', '둘째', '셋째'], revision: 0, active: true };
let snapshot;
afterEach(() => vi.restoreAllMocks());
beforeEach(() => {
  localStorage.setItem('pesc-mate-token', 'synthetic-token');
  snapshot = { device, online: true, session_id: 'test-session', readers: cards.map((card, index) => ({ reader_id: index + 1,
    status: 'PRESENT', name: device.reader_labels[index], card_id: card.id, label: card.label })) };
  request.mockReset().mockImplementation(async path => {
    if (path.startsWith('/rfid/devices?')) return [device];
    if (path.includes('/state?')) return snapshot;
    if (path.startsWith('/rfid/bindings?')) return [];
    if (path.startsWith('/rfid/cards?')) return cards;
    throw new Error('Unexpected path: ' + path);
  });
});

test('상태는 명시적으로 열고 인식 배열은 적용 버튼 전까지 기존 문장을 바꾸지 않는다', async () => {
  const user = userEvent.setup(), apply = vi.fn();
  render(<RfidBoard targetId="child" cards={cards} onApply={apply} />);
  expect(request).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'RFID 상태 열기' }));
  await user.selectOptions(await screen.findByLabelText('RFID 장치'), 'synthetic');
  await screen.findByText('리더기 상태 수신 중');
  expect(apply).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: '현재 RFID 배열을 문장에 적용' }));
  expect(apply).toHaveBeenCalledWith(cards);
});

test('미등록·오류 상태는 적용하지 않으며 기기 원시 UID를 아동에게 표시하지 않는다', async () => {
  snapshot.readers[1] = { reader_id: 2, status: 'UNMAPPED', name: '둘째' };
  const user = userEvent.setup(), apply = vi.fn(); render(<RfidBoard targetId="child" cards={cards} onApply={apply} />);
  await user.click(screen.getByRole('button', { name: 'RFID 상태 열기' }));
  await user.selectOptions(await screen.findByLabelText('RFID 장치'), 'synthetic');
  await screen.findByText('등록되지 않은 카드');
  expect(screen.getByRole('button', { name: '현재 RFID 배열을 문장에 적용' }).disabled).toBe(true);
  expect(screen.queryByRole('textbox', { name: '태그 UID' })).toBeNull(); expect(apply).not.toHaveBeenCalled();
});

test('사용자 전환 뒤 이전 장치의 늦은 응답을 새 사용자 화면에 넣지 않는다', async () => {
  let resolveOld;
  const original = request.getMockImplementation();
  request.mockImplementation(path => path.includes('/state?user_id=old') ? new Promise(resolve => { resolveOld = resolve; }) : original(path));
  const user = userEvent.setup(), apply = vi.fn();
  const view = render(<RfidBoard targetId="old" cards={cards} onApply={apply} />);
  await user.click(screen.getByRole('button', { name: 'RFID 상태 열기' }));
  await user.selectOptions(await screen.findByLabelText('RFID 장치'), 'synthetic');
  await waitFor(() => expect(resolveOld).toBeTypeOf('function'));
  view.rerender(<RfidBoard targetId="new" cards={cards} onApply={apply} />);
  resolveOld(snapshot);
  await waitFor(() => expect(screen.getByLabelText('RFID 장치').value).toBe(''));
  expect(screen.queryByText('리더기 상태 수신 중')).toBeNull(); expect(apply).not.toHaveBeenCalled();
});

test('목록 수신 중 연결이 끊겨도 복구 후 새로고침 버튼이 잠기지 않는다', async () => {
  let rejectRead;
  const online = vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(true);
  request.mockImplementationOnce(() => new Promise((resolve, reject) => { rejectRead = reject; }));
  const user = userEvent.setup();
  render(<RfidBoard targetId="child" cards={cards} />);
  await user.click(screen.getByRole('button', { name: 'RFID 상태 열기' }));
  await waitFor(() => expect(rejectRead).toBeTypeOf('function'));
  const refresh = screen.getByRole('button', { name: '장치·등록 목록 새로고침' });
  expect(refresh.disabled).toBe(true);
  online.mockReturnValue(false); rejectRead(new Error('연결 끊김'));
  await waitFor(() => expect(refresh.disabled).toBe(false));
  online.mockReturnValue(true);
  await user.click(refresh);
  await waitFor(() => expect(within(screen.getByLabelText('RFID 장치')).getByRole('option', { name: /검증 카드판/ })).toBeTruthy());
});
