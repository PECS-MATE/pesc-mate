import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import OperationalAlerts from '../../src/OperationalAlerts.jsx';
import { request } from '../../src/services/api';

vi.mock('../../src/services/api', () => ({ request: vi.fn() }));

const reviewAlert = { code: 'review_pending', title: '공용 카드 검수 대기', message: '공개 요청을 검토해 주세요.',
  count: 123, severity: 'info', action: 'review' };
const report = (alerts = []) => ({ generated_at: '2026-10-17T00:00:00Z', status: 'ok', alerts });

beforeEach(() => request.mockReset().mockResolvedValue(report()));
afterEach(() => vi.useRealTimers());

test('대기 수와 제목을 별도 요소로 표시하고 검수 목록으로 이동한다', async () => {
  request.mockResolvedValue(report([reviewAlert]));
  const onReview = vi.fn();
  render(<OperationalAlerts onReview={onReview} />);
  expect(await screen.findByText('123건')).toBeTruthy();
  expect(screen.getByText('공용 카드 검수 대기').tagName).toBe('STRONG');
  fireEvent.click(screen.getByRole('button', { name: '검수 목록 열기' }));
  expect(onReview).toHaveBeenCalledTimes(1);
});

test('새로고침 실패는 이전 알림을 유지하고 정상으로 표시하지 않는다', async () => {
  request.mockResolvedValueOnce(report([reviewAlert])).mockRejectedValueOnce(new Error('private-child-query'));
  render(<OperationalAlerts />);
  await screen.findByText('123건');
  fireEvent.click(screen.getByRole('button', { name: '알림 새로고침' }));
  await screen.findByText(/최신 알림을 확인하지 못했습니다/);
  expect(screen.getByText('123건')).toBeTruthy();
  expect(screen.getByText(/이전 확인 결과 · 알림 1건/)).toBeTruthy();
  expect(screen.queryByText(/private-child-query/)).toBeNull();
});

test('최초 조회 실패와 부분 조회 실패를 빈 정상 알림과 구분한다', async () => {
  request.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ ...report([
    { code: 'tts_unavailable', title: '음성 재생 지표 확인 필요', message: '현재 상태를 확인하지 못했습니다.', count: null, severity: 'warning' },
  ]), status: 'partial' });
  render(<OperationalAlerts />);
  await screen.findByText(/최신 알림을 확인하지 못했습니다/);
  expect(screen.queryByText('설정된 기준에 해당하는 운영 알림이 없습니다.')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '알림 새로고침' }));
  await screen.findByText('음성 재생 지표 확인 필요');
  expect(screen.getByText(/일부 상태 확인 불가/)).toBeTruthy();
  expect(screen.queryByText(/최신 알림을 확인하지 못했습니다/)).toBeNull();
});

test('검수 목록이 바뀌면 다시 조회하고 해결된 알림을 제거한다', async () => {
  request.mockResolvedValueOnce(report([reviewAlert])).mockResolvedValueOnce(report());
  const { rerender } = render(<OperationalAlerts refreshKey={1} />);
  await screen.findByText('123건');
  rerender(<OperationalAlerts refreshKey={2} />);
  await screen.findByText('설정된 기준에 해당하는 운영 알림이 없습니다.');
  expect(screen.queryByText('123건')).toBeNull();
});

test('숨긴 탭에서는 조회하지 않고 복귀와 분 단위 갱신에서 중복 요청을 막는다', async () => {
  vi.useFakeTimers();
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  let release;
  request.mockImplementationOnce(() => new Promise(resolve => { release = resolve; })).mockResolvedValue(report());
  const { unmount } = render(<OperationalAlerts />);
  expect(request).not.toHaveBeenCalled();
  visibility.mockReturnValue('visible');
  await act(async () => document.dispatchEvent(new Event('visibilitychange')));
  expect(request).toHaveBeenCalledTimes(1);
  await act(async () => vi.advanceTimersByTimeAsync(120000));
  expect(request).toHaveBeenCalledTimes(1);
  await act(async () => release(report()));
  await act(async () => vi.advanceTimersByTimeAsync(60000));
  expect(request).toHaveBeenCalledTimes(2);
  unmount();
  await act(async () => vi.advanceTimersByTimeAsync(120000));
  expect(request).toHaveBeenCalledTimes(2);
});

test('이전 갱신의 늦은 응답이 최신 결과를 덮어쓰지 않는다', async () => {
  let release;
  request.mockImplementationOnce(() => new Promise(resolve => { release = resolve; })).mockResolvedValueOnce(report());
  const { rerender } = render(<OperationalAlerts refreshKey={1} />);
  rerender(<OperationalAlerts refreshKey={2} />);
  await screen.findByText('설정된 기준에 해당하는 운영 알림이 없습니다.');
  await act(async () => release(report([reviewAlert])));
  await waitFor(() => expect(screen.queryByText('123건')).toBeNull());
});

test('인증 만료나 운영 권한 거절이면 이전 알림도 화면에서 제거한다', async () => {
  request.mockResolvedValueOnce(report([reviewAlert])).mockRejectedValueOnce(Object.assign(new Error('forbidden'), { status: 403 }));
  render(<OperationalAlerts />);
  await screen.findByText('123건');
  fireEvent.click(screen.getByRole('button', { name: '알림 새로고침' }));
  await screen.findByText(/최신 알림을 확인하지 못했습니다/);
  expect(screen.queryByText('123건')).toBeNull();
});
