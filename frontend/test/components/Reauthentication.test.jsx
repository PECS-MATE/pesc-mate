import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import useReauthentication from '../../src/useReauthentication';

function Harness({ context = 'operator:admin', onResult }) {
  const { askPassword, confirmation } = useReauthentication(context);
  return <><button onClick={async () => onResult(await askPassword('공용 카드 승인', '대상: 합성 카드'))}>작업 시작</button>{confirmation}</>;
}

test('대상과 작업을 표시하고 비밀번호는 제출 뒤 폐기해 다음 작업에서 다시 묻는다', async () => {
  const onResult = vi.fn();
  const user = userEvent.setup();
  render(<StrictMode><Harness onResult={onResult} /></StrictMode>);
  await user.click(screen.getByRole('button', { name: '작업 시작' }));
  expect(screen.getByRole('dialog', { name: '운영 작업 확인' }).textContent).toContain('대상: 합성 카드');
  expect(document.activeElement).toBe(screen.getByLabelText('본인 비밀번호'));
  expect(screen.getByRole('button', { name: '확인 후 실행' }).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('본인 비밀번호'), { target: { value: 'verification-only' } });
  await user.click(screen.getByRole('button', { name: '확인 후 실행' }));
  expect(onResult).toHaveBeenCalledExactlyOnceWith('verification-only');
  expect(screen.queryByRole('dialog')).toBeNull();
  await user.click(screen.getByRole('button', { name: '작업 시작' }));
  expect(screen.getByLabelText('본인 비밀번호').value).toBe('');
  expect(localStorage.length).toBe(0);
});

test.each(['cancel', 'escape', 'offline', 'expired', 'storage'])('%s는 재인증을 취소하고 비밀번호를 반환하지 않는다', async method => {
  const user = userEvent.setup();
  const onResult = vi.fn();
  render(<Harness onResult={onResult} />);
  await user.click(screen.getByRole('button', { name: '작업 시작' }));
  fireEvent.change(screen.getByLabelText('본인 비밀번호'), { target: { value: 'never-submit' } });
  if (method === 'cancel') await user.click(screen.getByRole('button', { name: '취소' }));
  else if (method === 'escape') fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
  else act(() => window.dispatchEvent(new Event({ offline: 'offline', expired: 'pesc-mate:session-expired', storage: 'storage' }[method])));
  await act(async () => {});
  expect(onResult).toHaveBeenCalledExactlyOnceWith(null);
  expect(screen.queryByRole('dialog')).toBeNull();
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: '작업 시작' })));
});

test('다른 계정·화면으로 이동하거나 컴포넌트가 종료되면 대기 중 확인을 취소한다', async () => {
  const user = userEvent.setup();
  const onResult = vi.fn();
  const { rerender, unmount } = render(<Harness onResult={onResult} />);
  await user.click(screen.getByRole('button', { name: '작업 시작' }));
  rerender(<Harness context="operator:profile" onResult={onResult} />);
  await act(async () => {});
  expect(onResult).toHaveBeenLastCalledWith(null);
  await user.click(screen.getByRole('button', { name: '작업 시작' }));
  unmount();
  await act(async () => {});
  expect(onResult.mock.calls).toEqual([[null], [null]]);
});

test('오프라인 상태에서는 비밀번호 창을 열거나 이전 비밀번호를 재사용하지 않는다', async () => {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  const user = userEvent.setup();
  const onResult = vi.fn();
  render(<Harness onResult={onResult} />);
  await user.click(screen.getByRole('button', { name: '작업 시작' }));
  expect(onResult).toHaveBeenCalledExactlyOnceWith(null);
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('비활성 버튼을 제외해 확인 창의 처음과 끝에서 Tab·Shift+Tab 포커스를 순환한다', async () => {
  const user = userEvent.setup();
  render(<Harness onResult={vi.fn()} />);
  await user.click(screen.getByRole('button', { name: '작업 시작' }));
  const input = screen.getByLabelText('본인 비밀번호');
  const cancel = screen.getByRole('button', { name: '취소' });
  const confirm = screen.getByRole('button', { name: '확인 후 실행' });
  await user.tab({ shift: true });
  expect(document.activeElement).toBe(cancel);
  await user.tab();
  expect(document.activeElement).toBe(input);
  fireEvent.change(input, { target: { value: 'verification-only' } });
  await user.tab({ shift: true });
  expect(document.activeElement).toBe(confirm);
  await user.tab();
  expect(document.activeElement).toBe(input);
});
