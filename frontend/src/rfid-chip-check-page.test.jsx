import { expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import RfidChipCheckPage from './rfid-chip-check-page';
import { request } from './services/api';

vi.mock('./services/api', () => ({ request: vi.fn(), requestBlob: vi.fn() }));
vi.mock('./UsbRfidReader', () => ({ default: ({ onUid }) => <>
  <button onClick={() => onUid('AABBCCDD')}>scan A</button>
  <button onClick={() => onUid('11223344')}>scan B</button>
  <button onClick={() => onUid('FFFFFFFF')}>scan unknown</button>
</> }));
const catalog = {
  cards: [{ id: 'water', label: '물', category: '음료' }, { id: 'apple', label: '사과', category: '음식' }],
  bindings: [{ uid: 'AABBCCDD', card_id: 'water', available: true }, { uid: '11223344', card_id: 'apple', available: true }],
};
function setup() {
  localStorage.setItem('pesc-mate-token', 'synthetic');
  request.mockReset(); request.mockResolvedValue(catalog);
  return render(<RfidChipCheckPage accountId="synthetic" />);
}
it('replaces the card on every new scan without a rearm step and shows unmapped chips', async () => {
  setup();
  fireEvent.click(screen.getByText('scan A'));
  expect(await screen.findByRole('img', { name: '물 그림' })).toBeInTheDocument();
  fireEvent.click(screen.getByText('scan B'));
  expect(await screen.findByRole('img', { name: '사과 그림' })).toBeInTheDocument();
  expect(screen.queryByRole('img', { name: '물 그림' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByText('scan unknown'));
  expect(await screen.findByText('공용 카드에 등록되지 않은 칩입니다.')).toBeInTheDocument();
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  expect(request).toHaveBeenCalledTimes(3);
});
it('ignores an old lookup that completes after the latest scan', async () => {
  setup();
  let resolveOld;
  request.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
  fireEvent.click(screen.getByText('scan A'));
  fireEvent.click(screen.getByText('scan B'));
  await screen.findByRole('img', { name: '사과 그림' });
  await act(async () => resolveOld(catalog));
  expect(screen.getByRole('img', { name: '사과 그림' })).toBeInTheDocument();
  expect(screen.queryByRole('img', { name: '물 그림' })).not.toBeInTheDocument();
});
it('shows lookup failure without labeling it as an unmapped chip', async () => {
  setup(); request.mockRejectedValueOnce(new Error('서버 연결 오류'));
  fireEvent.click(screen.getByText('scan A'));
  expect(await screen.findByRole('alert')).toHaveTextContent('서버 연결 오류');
  expect(screen.queryByText('공용 카드에 등록되지 않은 칩입니다.')).not.toBeInTheDocument();
});
