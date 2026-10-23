import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import CardPhotoReplacement from '../../src/CardPhotoReplacement';
import { request } from '../../src/services/api';

vi.mock('../../src/services/api', () => ({ request: vi.fn() }));
const card = { id: 'synthetic-card', label: '검증 연필', image_revision: 2 };
const defaults = { card, targetId: 'child-a', onReplaced: vi.fn(), onRefresh: vi.fn() };
const file = () => new File(['synthetic-original'], '새_연필.png', { type: 'image/png' });
const pending = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
beforeEach(() => {
  localStorage.setItem('pesc-mate-token', 'synthetic-session');
  defaults.onReplaced.mockReset().mockResolvedValue(undefined); defaults.onRefresh.mockReset();
  request.mockReset().mockResolvedValue({ ...card, image_revision: 3 });
});
async function open(props = {}) {
  const user = userEvent.setup();
  const view = render(<StrictMode><CardPhotoReplacement {...defaults} {...props} /></StrictMode>);
  await user.click(screen.getByRole('button', { name: '검증 연필 사진 교체' }));
  return { user, view };
}
function save() {
  // jsdom's required-file validation does not see user-event's synthetic FileList.
  // Exercise the form handler here; Chromium E2E verifies native file submission.
  fireEvent.submit(screen.getByRole('button', { name: '사진만 교체 저장' }).closest('form'));
}

test('대상·사진 버전·원본 파일만 교체 요청하고 기존 문구·보드 설정은 전송하지 않는다', async () => {
  const { user } = await open();
  expect(screen.getByRole('dialog', { name: '개인 카드 사진 교체' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '사진만 교체 저장' }).disabled).toBe(true);
  const original = file(); await user.upload(screen.getByLabelText('교체할 사진'), original);
  const url = screen.getByRole('img', { name: '교체할 사진 미리보기' }).src;
  save();
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  const [path, options] = request.mock.calls[0];
  expect(path).toBe('/cards/submissions/synthetic-card/image'); expect(options.method).toBe('PUT');
  expect([...options.body.keys()].sort()).toEqual(['expected_revision', 'image', 'user_id']);
  expect(options.body.get('expected_revision')).toBe('2'); expect(options.body.get('user_id')).toBe('child-a');
  expect(options.body.get('image').size).toBe(original.size);
  expect(defaults.onReplaced).toHaveBeenCalledWith({ ...card, image_revision: 3 });
  expect(URL.revokeObjectURL).toHaveBeenCalledWith(url);
});

test.each([409, 503, undefined])('충돌·서버·통신 오류 %s는 최신 확인 전 재전송을 막는다', async status => {
  request.mockRejectedValueOnce(Object.assign(new Error('합성 교체 오류'), { status }));
  const { user } = await open(); await user.upload(screen.getByLabelText('교체할 사진'), file());
  save();
  await screen.findByRole('alert');
  expect(screen.getByRole('button', { name: '사진만 교체 저장' }).disabled).toBe(true);
  await user.click(screen.getByRole('button', { name: '닫고 최신 등록 목록 확인' }));
  expect(defaults.onRefresh).toHaveBeenCalledTimes(1); expect(request).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('명확한 형식 거절 뒤에는 새 파일로 같은 버전을 다시 요청할 수 있다', async () => {
  request.mockRejectedValueOnce(Object.assign(new Error('안전성 확인 실패'), { status: 422 }));
  const { user } = await open(); await user.upload(screen.getByLabelText('교체할 사진'), file());
  save();
  await screen.findByRole('alert');
  await user.upload(screen.getByLabelText('교체할 사진'), file());
  save();
  await waitFor(() => expect(defaults.onReplaced).toHaveBeenCalledTimes(1));
  expect(request.mock.calls.map(([, options]) => options.body.get('expected_revision'))).toEqual(['2', '2']);
});

test('늦은 교체 결과는 변경된 세션이나 새 대상에 반영하지 않는다', async () => {
  const gate = pending(); request.mockReturnValueOnce(gate.promise);
  const { user, view } = await open(); await user.upload(screen.getByLabelText('교체할 사진'), file());
  save();
  localStorage.setItem('pesc-mate-token', 'new-session');
  view.rerender(<StrictMode><CardPhotoReplacement key="other-target" {...defaults} targetId="child-b" /></StrictMode>);
  await act(async () => gate.resolve({ ...card, image_revision: 3 }));
  expect(defaults.onReplaced).not.toHaveBeenCalled(); expect(request).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('조회된 사진 버전이 바뀌면 이전 선택 파일을 그대로 덮어쓰지 않는다', async () => {
  const { user, view } = await open(); await user.upload(screen.getByLabelText('교체할 사진'), file());
  view.rerender(<StrictMode><CardPhotoReplacement {...defaults} card={{ ...card, image_revision: 3 }} /></StrictMode>);
  expect(screen.getByRole('button', { name: '사진만 교체 저장' }).disabled).toBe(true);
  expect(screen.getByRole('alert').textContent).toContain('버전이 바뀌었습니다');
  expect(request).not.toHaveBeenCalled();
});

test('지원하지 않는 파일과 비활성 상태는 교체 요청을 보내지 않는다', async () => {
  const { view } = await open();
  fireEvent.change(screen.getByLabelText('교체할 사진'), { target: { files: [new File(['x'], 'bad.svg', { type: 'image/svg+xml' })] } });
  expect(screen.getByRole('alert').textContent).toContain('JPG, PNG, WebP');
  expect(screen.getByRole('button', { name: '사진만 교체 저장' }).disabled).toBe(true);
  view.rerender(<StrictMode><CardPhotoReplacement {...defaults} disabled /></StrictMode>);
  expect(screen.getByLabelText('교체할 사진').disabled).toBe(true);
  expect(request).not.toHaveBeenCalled();
});

test('목록 갱신 실패는 서버가 확인한 사진 교체를 재전송 대상으로 바꾸지 않는다', async () => {
  defaults.onReplaced.mockRejectedValueOnce(new Error('합성 목록 오류'));
  const { user } = await open(); await user.upload(screen.getByLabelText('교체할 사진'), file());
  save();
  await screen.findByText(/사진은 교체됐습니다/);
  expect(screen.getByRole('button', { name: '사진만 교체 저장' }).disabled).toBe(true);
  expect(request).toHaveBeenCalledTimes(1);
});
