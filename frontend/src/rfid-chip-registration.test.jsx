import { expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import RfidChipRegistration from './RfidChipRegistration';
import { request } from './services/api';

vi.mock('./services/api', () => ({ request: vi.fn(), requestBlob: vi.fn() }));
vi.mock('./UsbRfidReader', () => ({ default: ({ onUid }) => <button onClick={() => onUid('AABBCCDD')}>테스트 칩 읽기</button> }));

function setup(bindings = []) {
  localStorage.setItem('pesc-mate-token', 'synthetic-token');
  const cards = [
    ...Array.from({ length: 8 }, (_, i) => ({ id: `card-${i}`, label: `과일 ${i}`, category: '음식' })),
    { id: 'water', label: '물', category: '음료' },
    { id: 'juice', label: 'Juice', category: '음료' },
  ];
  request.mockReset();
  request.mockImplementation(async (_path, options) => options?.method === 'PUT'
    ? { binding: { uid: 'AABBCCDD', card_id: 'water', label: '물', revision: 1 } }
    : { cards, bindings });
  render(<RfidChipRegistration accountId="synthetic" />);
  return screen.findByText(`검색 결과 ${10 - new Set(bindings.map(row => row.card_id)).size}개`);
}

it('searches public card names and categories without a long dropdown', async () => {
  await setup();
  const results = within(screen.getByRole('list', { name: '연결할 공용 그림카드' }));
  expect(results.getAllByRole('button')).toHaveLength(8);
  expect(results.queryByRole('button', { name: /물/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '다음' }));
  expect(results.getByRole('button', { name: /물/ })).toBeDisabled();
  fireEvent.change(screen.getByRole('searchbox', { name: '공용 카드 검색' }), { target: { value: ' 음료 JUICE ' } });
  expect(results.getAllByRole('button')).toHaveLength(1);
  expect(results.getByRole('button', { name: /Juice/ })).toBeInTheDocument();
  expect(screen.queryByRole('navigation', { name: '공용 카드 검색 결과 페이지' })).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '없는카드' } });
  expect(screen.getByText(/검색 결과가 없습니다/)).toBeInTheDocument();
});

it('preserves the explicitly selected card through search changes and saves its ID', async () => {
  await setup();
  fireEvent.click(screen.getByRole('button', { name: '테스트 칩 읽기' }));
  const search = screen.getByRole('searchbox', { name: '공용 카드 검색' });
  fireEvent.change(search, { target: { value: '물' } });
  fireEvent.click(screen.getByRole('button', { name: '물 음료' }));
  expect(screen.getByRole('button', { name: '물 음료 선택됨' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.change(search, { target: { value: '과일' } });
  fireEvent.click(screen.getByRole('button', { name: '칩 등록 저장' }));
  await waitFor(() => expect(request).toHaveBeenCalledWith('/rfid/admin/bindings', expect.objectContaining({
    method: 'PUT', body: JSON.stringify({ uid: 'AABBCCDD', card_id: 'water', expected_revision: null }),
  })));
  fireEvent.change(search, { target: { value: '물' } });
  await waitFor(() => expect(within(screen.getByRole('list', { name: '연결할 공용 그림카드' })).queryByRole('button', { name: /물/ })).not.toBeInTheDocument());
});

it('only shows unmapped public cards even when searching for a mapped card', async () => {
  await setup([{ uid: '11223344', card_id: 'water', label: '물', available: true, revision: 1 }]);
  const search = screen.getByRole('searchbox', { name: '공용 카드 검색' });
  fireEvent.change(search, { target: { value: '음료' } });
  const results = within(screen.getByRole('list', { name: '연결할 공용 그림카드' }));
  expect(results.getAllByRole('button')).toHaveLength(1);
  expect(results.getByRole('button', { name: /Juice/ })).toBeInTheDocument();
  fireEvent.change(search, { target: { value: '물' } });
  expect(results.queryByRole('button')).not.toBeInTheDocument();
  expect(screen.getByText(/검색 결과가 없습니다/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '연결 수정' }));
  expect(screen.getByText('저장할 연결:', { exact: false })).toHaveTextContent('물');
  expect(results.queryByRole('button', { name: /물/ })).not.toBeInTheDocument();
});
