import { StrictMode } from 'react';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import CommunicationActivity from '../../src/CommunicationActivity';
import NoteHistory from '../../src/NoteHistory';
import DeletionReceipt from '../../src/DeletionReceipt';
import { SessionDetails } from '../../src/CommunicationInsights';
import { request } from '../../src/services/api';

vi.mock('../../src/services/api', () => ({ request: vi.fn(), requestBlob: vi.fn() }));
const empty = { total: 0, recent_limit: 100, recent: [], situations: [], daily: [], recovery_flows: [] };
const event = { id: 'event', event_type: 'card_selection', card_ids: ['water'], occurred_at: '2026-10-21T08:00:00Z', sequence: 1 };
beforeEach(() => {
  localStorage.setItem('pesc-mate-token', 'details-session');
  request.mockReset().mockResolvedValue(empty);
});
const activity = target => <StrictMode><CommunicationActivity key={target} targetId={target} days={7} cards={{ water: { label: '물' } }} /></StrictMode>;

test('상황별 관찰 수치와 복구 표현의 인접 기록을 평가 없이 표시한다', async () => {
  request.mockResolvedValue({ ...empty, total: 3, recent: [event], situations: [
    { situation: 'school', label: '학교', selections: 1, succeeded: 1, failed: 0, cancelled: 0, legacy_requests: 1 },
  ], recovery_flows: [{ recovery: { ...event, id: 'recovery', recovery_id: 'not_that', speech_status: 'succeeded' }, before: event, after: null }] });
  render(activity('child'));
  expect(await screen.findByText(/선택한 기간의 활동 3건/)).toBeTruthy();
  expect(within(screen.getByRole('table')).getByText('학교')).toBeTruthy();
  expect(screen.getByText(/실제 청취 확인이 아닙니다/)).toBeTruthy();
  expect(screen.getByText('이 조회 기간·같은 기기의 5분 이내에 인접 기록 없음')).toBeTruthy();
  expect(screen.getByRole('button', { name: '활동 CSV 내보내기' })).toBeTruthy();
});

test('이전 사용자 활동의 늦은 응답을 새 대상 화면에 표시하지 않는다', async () => {
  let finish;
  request.mockImplementation(path => path.includes('user_id=A') ? new Promise(resolve => { finish = resolve; }) : Promise.resolve(empty));
  const { rerender } = render(activity('A'));
  rerender(activity('B'));
  await screen.findByText(/선택한 기간의 활동 0건/);
  await act(async () => finish({ ...empty, total: 999 }));
  expect(screen.queryByText(/999/)).toBeNull();
});

test('활동 조회 실패를 0건으로 표시하지 않고 재시도한다', async () => {
  request.mockRejectedValue(new Error('합성 조회 오류'));
  render(activity('child'));
  expect((await screen.findByRole('alert')).textContent).toContain('합성 조회 오류');
  expect(screen.queryByText(/선택한 기간의 활동 0건/)).toBeNull();
  request.mockResolvedValue(empty);
  await userEvent.setup().click(screen.getByRole('button', { name: '활동 조회 다시 시도' }));
  expect(await screen.findByText(/선택한 기간의 활동 0건/)).toBeTruthy();
});

test('메모 이력은 요청한 작성자 범위로만 열고 삭제된 본문은 복원하지 않는다', async () => {
  request.mockResolvedValue({ revision: 2, deleted: true, history: [
    { revision: 1, author_id: 'author', action: 'created', content: null, created_at: '2026-10-21T00:00:00Z' },
    { revision: 2, author_id: 'author', action: 'deleted', content: null, created_at: '2026-10-21T01:00:00Z' },
  ] });
  render(<NoteHistory sessionId="session" targetId="child" authorName="합성 보호자" details={{ author_id: 'author', deleted: true }} />);
  expect(request).not.toHaveBeenCalled();
  await userEvent.setup().click(screen.getByRole('button', { name: '메모 수정·삭제 이력 보기' }));
  expect(request).toHaveBeenCalledWith('/care/notes/session/history?user_id=child');
  expect(screen.getAllByText('본문 삭제됨')).toHaveLength(2);
  expect(screen.getByText(/메모 삭제 완료/)).toBeTruthy();
});

test('닫힌 메모 이력의 늦은 응답은 표시하지 않는다', async () => {
  let finish;
  request.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const { unmount } = render(<NoteHistory sessionId="session" targetId="child" authorName="보호자" />);
  await userEvent.setup().click(screen.getByRole('button', { name: '메모 수정·삭제 이력 보기' }));
  unmount();
  await act(async () => finish({ revision: 1, history: [{ revision: 1, content: 'late private content' }] }));
  expect(screen.queryByText('late private content')).toBeNull();
});

test('삭제 실패는 부분 처리·유지 항목과 백업 한계를 알리며 완료로 표시하지 않는다', () => {
  render(<DeletionReceipt receipt={{ id: 'receipt', status: 'failed', requested_at: '2026-10-21T00:00:00Z',
    counts: { communication_sessions: 3 }, profile_removed: false, preserved: ['로그인 계정', '삭제 확인 기록'],
    limitations: '별도 백업은 자동 삭제되지 않습니다.' }} />);
  expect(screen.getByText(/일부 항목만 삭제/)).toBeTruthy();
  expect(screen.getByText('저장 문장: 3건')).toBeTruthy();
  expect(screen.queryByText('삭제 완료', { exact: true })).toBeNull();
  expect(screen.getByText(/별도 백업/)).toBeTruthy();
});

test('문장 타임라인은 수집한 선택 시각과 연결된 기기 재생 결과만 표시한다', () => {
  const at = '2026-10-21T00:00:00Z';
  render(<SessionDetails record={{ cards: ['water'], card_selected_at: [at], created_at: at,
    speech_results: [{ id: 'speech', speech_status: 'succeeded', completed_at: at }] }}
    cardPicture={() => <span />} fallbackCards={{ water: { id: 'water', label: '물' } }} />);
  expect(screen.getByText('기기 재생 완료', { exact: false })).toBeTruthy();
  expect(screen.queryByText('카드 선택 시각: 기록 없음')).toBeNull();
  expect(screen.getByText(/실제 청취 확인 아님/)).toBeTruthy();
});
