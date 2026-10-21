import { StrictMode } from 'react';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import RecordExport from '../../src/RecordExport';
import { requestBlob } from '../../src/services/api';

vi.mock('../../src/services/api', () => ({ requestBlob: vi.fn() }));

beforeEach(() => {
  localStorage.setItem('pesc-mate-token', 'synthetic-export-session');
  requestBlob.mockReset().mockResolvedValue(new Blob(['synthetic records']));
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});

const view = (domain = 'communication', targetId = 'child-A', days = 7, disabled = false) =>
  <StrictMode><RecordExport key={`${domain}-${targetId}-${days}`} domain={domain} targetId={targetId} days={days} disabled={disabled} /></StrictMode>;

test.each(['csv', 'json'])('%s 내보내기는 영역·기간·대상을 전달하고 임시 URL을 해제한다', async format => {
  const user = userEvent.setup();
  const timer = vi.spyOn(globalThis, 'setTimeout');
  const revoke = vi.spyOn(URL, 'revokeObjectURL');
  const objectURL = vi.spyOn(URL, 'createObjectURL');
  let filename;
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () { filename = this.download; });
  render(view());
  await user.click(screen.getByRole('button', { name: `${format.toUpperCase()} 내보내기` }));
  expect(requestBlob).toHaveBeenCalledWith(`/api/records/export?domain=communication&format=${format}&user_id=child-A&days=7`, expect.any(String));
  expect(filename).toBe(`pesc-mate-communication-7.${format}`);
  expect(objectURL).toHaveBeenCalledTimes(1);
  const scheduled = timer.mock.calls.find(([callback, delay]) => delay === 1000 && String(callback).includes('revokeObjectURL'));
  expect(scheduled).toBeTruthy();
  scheduled[0]();
  expect(revoke).toHaveBeenCalled();
});

test('학습은 별도 영역과 30일을 사용하며 전체 기간은 days를 보내지 않는다', async () => {
  const user = userEvent.setup();
  const { rerender } = render(view('learning', 'child-A', 30));
  await user.click(screen.getByRole('button', { name: 'JSON 내보내기' }));
  expect(requestBlob.mock.calls[0][0]).toContain('domain=learning&format=json&user_id=child-A&days=30');
  rerender(view('communication', 'child-A', null));
  await user.click(screen.getByRole('button', { name: 'CSV 내보내기' }));
  expect(requestBlob.mock.calls[1][0]).not.toContain('days=');
});

test.each(['target', 'domain', 'period', 'session', 'offline', 'closed'])('%s 변경 뒤 늦은 응답은 다운로드하지 않는다', async reason => {
  const user = userEvent.setup();
  let finish;
  requestBlob.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const objectURL = vi.spyOn(URL, 'createObjectURL');
  const { rerender, unmount } = render(view());
  await user.click(screen.getByRole('button', { name: 'CSV 내보내기' }));
  expect(screen.getByRole('button', { name: 'JSON 내보내기' }).disabled).toBe(true);
  if (reason === 'target') rerender(view('communication', 'child-B', 7));
  if (reason === 'domain') rerender(view('learning', 'child-A', 30));
  if (reason === 'period') rerender(view('communication', 'child-A', 30));
  if (reason === 'session') localStorage.setItem('pesc-mate-token', 'replacement-session');
  if (reason === 'offline') vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  if (reason === 'closed') unmount();
  await act(async () => finish(new Blob(['late private data'])));
  expect(objectURL).not.toHaveBeenCalled();
  expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
});

test('오류는 빈 파일 대신 안내하고 재시도할 수 있다', async () => {
  const user = userEvent.setup();
  requestBlob.mockRejectedValueOnce(new Error('조회 기간을 줄여 주세요.'));
  const objectURL = vi.spyOn(URL, 'createObjectURL');
  render(view());
  await user.click(screen.getByRole('button', { name: 'CSV 내보내기' }));
  expect(screen.getByRole('alert').textContent).toContain('조회 기간을 줄여 주세요.');
  expect(objectURL).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'JSON 내보내기' }));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(objectURL).toHaveBeenCalledTimes(1);
});

test('비활성화 상태에서는 기록을 요청하지 않는다', async () => {
  render(view('communication', 'child-A', 7, true));
  await userEvent.setup().click(screen.getByRole('button', { name: 'CSV 내보내기' }));
  expect(requestBlob).not.toHaveBeenCalled();
});
