import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import AccountPermissions from '../../src/AccountPermissions';
import { request } from '../../src/services/api';

vi.mock('../../src/services/api', () => ({ request: vi.fn() }));
const staff = { id: 'staff', username: 'staff', name: '합성 담당자', content_manage: false, permission_revision: 0 };
const history = [{ id: 'audit-id', actor_id: 'manager', target_id: 'staff', before: false, after: true,
  before_revision: 0, after_revision: 1, status: 'applied', reason: '담당 업무 변경', created_at: '2026-10-18T00:00:00Z' }];

beforeEach(() => {
  request.mockReset().mockImplementation(async path => {
    if (path.startsWith('/admin/accounts/lookup?')) return staff;
    if (path.endsWith('/permission-audit')) return [];
    throw new Error('Unexpected component API path');
  });
});

async function openTarget(accountId = 'manager') {
  const onSessionExpired = vi.fn();
  render(<AccountPermissions accountId={accountId} onSessionExpired={onSessionExpired} />);
  const user = userEvent.setup();
  fireEvent.change(screen.getByLabelText('담당자 아이디'), { target: { value: 'staff' } });
  await user.click(screen.getByRole('button', { name: '담당자 조회' }));
  await screen.findByRole('heading', { name: '합성 담당자 (staff)' });
  return { user, onSessionExpired };
}

function fillChange() {
  fireEvent.click(screen.getByRole('checkbox', { name: '공용 콘텐츠 운영 허용' }));
  fireEvent.change(screen.getByLabelText('변경 사유'), { target: { value: '담당 업무 변경' } });
  fireEvent.change(screen.getByLabelText('관리 책임자 비밀번호'), { target: { value: 'verification-only' } });
}

test('조회한 담당자·버전·재인증 정보로만 변경하고 비밀번호는 바로 비운다', async () => {
  const { user } = await openTarget();
  expect(screen.getByRole('button', { name: '운영 권한 변경' }).disabled).toBe(true);
  fillChange();
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  request.mockImplementation(path => path.endsWith('/content-permission') ? pending : Promise.resolve(history));
  await user.click(screen.getByRole('button', { name: '운영 권한 변경' }));
  expect(screen.getByLabelText('관리 책임자 비밀번호').value).toBe('');
  expect(screen.getByRole('button', { name: '확인 중…' }).disabled).toBe(true);
  const [, options] = request.mock.calls.find(([path]) => path.endsWith('/content-permission'));
  expect(JSON.parse(options.body)).toEqual({ content_manage: true, expected_revision: 0,
    reason: '담당 업무 변경', password: 'verification-only' });
  await act(async () => finish({ ...staff, changed: true, content_manage: true, permission_revision: 1 }));
  expect(await screen.findByRole('status')).toHaveProperty('textContent', '운영 권한을 변경했습니다. 대상 계정은 다시 로그인해야 합니다.');
  expect(screen.getByRole('list', { name: '운영 권한 감사 기록' }).textContent).toContain('반영 완료');
  expect(screen.getByRole('button', { name: '운영 권한 변경' }).disabled).toBe(true);
});

test.each([403, 409, 503])('변경 오류 %i는 기존 대상을 닫고 재조회하도록 안내한다', async status => {
  const { user } = await openTarget();
  fillChange();
  request.mockRejectedValueOnce(Object.assign(new Error('현재 상태를 확인해 주세요.'), { status }));
  await user.click(screen.getByRole('button', { name: '운영 권한 변경' }));
  expect((await screen.findByRole('alert')).textContent).toContain('다시 조회');
  expect(screen.queryByLabelText('관리 책임자 비밀번호')).toBeNull();
  expect(screen.queryByRole('heading', { name: '합성 담당자 (staff)' })).toBeNull();
});

test('자신의 권한 변경은 재로그인 경로로 이동한다', async () => {
  const { user, onSessionExpired } = await openTarget('staff');
  fillChange();
  request.mockResolvedValueOnce({ ...staff, changed: true, content_manage: true, permission_revision: 1 });
  await user.click(screen.getByRole('button', { name: '운영 권한 변경' }));
  expect(onSessionExpired).toHaveBeenCalledTimes(1);
});

test('조회 중 세션이 만료되면 재로그인 경로로 이동한다', async () => {
  const { user, onSessionExpired } = await openTarget();
  request.mockRejectedValueOnce(Object.assign(new Error('다시 로그인해 주세요.'), { status: 401 }));
  await user.click(screen.getByRole('button', { name: '담당자 조회' }));
  expect(onSessionExpired).toHaveBeenCalledTimes(1);
  expect(screen.queryByLabelText('관리 책임자 비밀번호')).toBeNull();
});

test('오프라인 전환 후 늦게 도착한 응답으로 대상과 비밀번호를 복원하지 않는다', async () => {
  const { user } = await openTarget();
  fillChange();
  let finish;
  request.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  await user.click(screen.getByRole('button', { name: '운영 권한 변경' }));
  act(() => window.dispatchEvent(new Event('offline')));
  expect(screen.queryByLabelText('관리 책임자 비밀번호')).toBeNull();
  await act(async () => finish({ ...staff, changed: true, content_manage: true, permission_revision: 1 }));
  expect(screen.queryByRole('heading', { name: '합성 담당자 (staff)' })).toBeNull();
  expect(screen.getByRole('alert').textContent).toContain('온라인에서만');
});

test('다른 아이디를 입력하면 이전 대상과 재인증 정보를 제거한다', async () => {
  await openTarget();
  fillChange();
  fireEvent.change(screen.getByLabelText('담당자 아이디'), { target: { value: 'other-staff' } });
  await waitFor(() => expect(screen.queryByLabelText('관리 책임자 비밀번호')).toBeNull());
  expect(screen.queryByRole('button', { name: '운영 권한 변경' })).toBeNull();
});

test('비활성화는 콘텐츠 권한 초안과 분리해 접근 API로만 저장하고 감사 내용을 표시한다', async () => {
  const { user } = await openTarget();
  fillChange();
  fireEvent.click(screen.getByRole('checkbox', { name: '계정 활성' }));
  request.mockImplementation(async path => path.endsWith('/access')
    ? { ...staff, changed: true, account_active: false, access_expires_at: null, permission_revision: 1 }
    : [{ ...history[0], action: 'account_access', after: { account_active: false, access_expires_at: null } }]);
  await user.click(screen.getByRole('button', { name: '계정 접근 변경' }));
  const [, options] = request.mock.calls.find(([path]) => path.endsWith('/access'));
  expect(JSON.parse(options.body)).toEqual({ account_active: false, access_expires_at: null, expected_revision: 0,
    reason: '담당 업무 변경', password: 'verification-only' });
  expect((await screen.findByRole('status')).textContent).toContain('계정 접근 설정을 변경');
  expect(screen.getByLabelText('관리 책임자 비밀번호').value).toBe('');
  expect(screen.getByRole('checkbox', { name: '공용 콘텐츠 운영 허용' }).checked).toBe(true);
  expect(screen.getByRole('list', { name: '운영 권한 감사 기록' }).textContent).toContain('계정 비활성');
});

test('기기 현지 만료 시각은 UTC로 전송하고 해제는 명시적인 null로 보낸다', async () => {
  const { user } = await openTarget();
  const local = '2030-12-01T12:34:56.123';
  fireEvent.change(screen.getByLabelText('접근 만료 시각'), { target: { value: local } });
  fireEvent.change(screen.getByLabelText('변경 사유'), { target: { value: '접근 기한 설정' } });
  fireEvent.change(screen.getByLabelText('관리 책임자 비밀번호'), { target: { value: 'verification-only' } });
  request.mockImplementation(async path => path.endsWith('/access') ? {
    ...staff, account_active: true, access_expires_at: new Date(local).toISOString(), changed: true, permission_revision: 1,
  } : []);
  await user.click(screen.getByRole('button', { name: '계정 접근 변경' }));
  expect(JSON.parse(request.mock.calls.find(([path]) => path.endsWith('/access'))[1].body).access_expires_at).toBe(new Date(local).toISOString());
  await screen.findByRole('status');
  await user.click(screen.getByRole('button', { name: '만료 시각 해제' }));
  fireEvent.change(screen.getByLabelText('변경 사유'), { target: { value: '접근 기한 해제' } });
  fireEvent.change(screen.getByLabelText('관리 책임자 비밀번호'), { target: { value: 'verification-only' } });
  request.mockResolvedValueOnce({ ...staff, changed: true, account_active: true, access_expires_at: null, permission_revision: 2 });
  await user.click(screen.getByRole('button', { name: '계정 접근 변경' }));
  const calls = request.mock.calls.filter(([path]) => path.endsWith('/access'));
  expect(JSON.parse(calls[1][1].body)).toMatchObject({ access_expires_at: null, expected_revision: 1 });
});

test('책임자 계정의 비활성화와 만료 입력은 잠그고 이유를 안내한다', async () => {
  request.mockResolvedValueOnce({ ...staff, access_protected: true }).mockResolvedValueOnce([]);
  await openTarget();
  const checkbox = screen.getByRole('checkbox', { name: '계정 활성' });
  expect(checkbox.closest('fieldset').disabled).toBe(true);
  expect(screen.getByLabelText('접근 만료 시각').closest('fieldset').disabled).toBe(true);
  expect(screen.getByRole('button', { name: '계정 접근 변경' }).disabled).toBe(true);
  expect(screen.getByText(/관리 책임자는 비활성화·만료 설정으로 잠글 수 없습니다/)).toBeTruthy();
});

test('접근 변경 충돌은 대상과 재인증 입력을 제거하고 재조회를 요구한다', async () => {
  const { user } = await openTarget();
  fillChange();
  fireEvent.click(screen.getByRole('checkbox', { name: '계정 활성' }));
  request.mockRejectedValueOnce(Object.assign(new Error('다른 곳에서 변경했습니다.'), { status: 409 }));
  await user.click(screen.getByRole('button', { name: '계정 접근 변경' }));
  expect((await screen.findByRole('alert')).textContent).toContain('다시 조회');
  expect(screen.queryByLabelText('관리 책임자 비밀번호')).toBeNull();
});
