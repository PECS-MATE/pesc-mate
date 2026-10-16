import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { Avatar, ProfileEditor } from '../../src/Profile.jsx';
import { request, requestBlob } from '../../src/services/api';

vi.mock('../../src/services/api', () => ({ request: vi.fn(), requestBlob: vi.fn() }));

const presets = [{ id: 'pink', label: '핑크' }, { id: 'blue', label: '블루' }];
const account = { id: 'child', name: '검증 사용자', role: 'user', profile: null };
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  request.mockReset().mockImplementation(async path => {
    if (path === '/profile/presets') return presets;
    throw new Error(`Unexpected API path: ${path}`);
  });
  requestBlob.mockReset();
});

describe('프로필 선택과 저장', () => {
  test('선택 전에는 저장할 수 없고 키보드로 선택한 프리셋만 저장한다', async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    render(<ProfileEditor user={account} onSaved={onSaved} />);
    const pink = await screen.findByRole('radio', { name: '핑크' });
    const save = screen.getByRole('button', { name: '프로필 저장' });
    expect(save.disabled).toBe(true);
    pink.focus();
    await user.keyboard(' ');
    expect(pink.checked).toBe(true);
    const response = deferred();
    request.mockImplementationOnce(() => response.promise);
    await user.click(save);
    expect(request).toHaveBeenLastCalledWith('/profile', { method: 'PUT', body: JSON.stringify({ preset: 'pink' }) });
    expect(screen.getByRole('button', { name: '저장 중…' }).disabled).toBe(true);
    await user.click(screen.getByRole('button', { name: '저장 중…' }));
    expect(request.mock.calls.filter(([path]) => path === '/profile')).toHaveLength(1);
    expect(screen.getByRole('radio', { name: '블루' }).matches(':disabled')).toBe(true);
    await user.click(screen.getByRole('radio', { name: '블루' }));
    expect(pink.checked).toBe(true);
    expect(onSaved).not.toHaveBeenCalled();
    await act(async () => response.resolve({ kind: 'preset', preset: 'pink' }));
    expect(onSaved).toHaveBeenCalledExactlyOnceWith({ ...account, profile: { kind: 'preset', preset: 'pink' } });
  });

  test('선택 목록 조회가 실패해도 다시 불러와 선택할 수 있다', async () => {
    request.mockRejectedValueOnce(new Error('목록을 불러오지 못했습니다.'));
    const user = userEvent.setup();
    render(<ProfileEditor user={account} onSaved={vi.fn()} />);
    expect((await screen.findByRole('alert')).textContent).toContain('목록을 불러오지 못했습니다.');
    await user.click(screen.getByRole('button', { name: '선택 목록 다시 불러오기' }));
    await screen.findByRole('radio', { name: '블루' });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  test('저장이 실패하면 선택을 유지하고 다시 저장할 수 있다', async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    render(<ProfileEditor user={account} onSaved={onSaved} />);
    await user.click(await screen.findByRole('radio', { name: '블루' }));
    request.mockRejectedValueOnce(new Error('저장소에 연결할 수 없습니다.'));
    await user.click(screen.getByRole('button', { name: '프로필 저장' }));
    expect((await screen.findByRole('alert')).textContent).toContain('저장소에 연결할 수 없습니다.');
    expect(screen.getByRole('radio', { name: '블루' }).checked).toBe(true);
    expect(onSaved).not.toHaveBeenCalled();
    request.mockResolvedValueOnce({ kind: 'preset', preset: 'blue' });
    await user.click(screen.getByRole('button', { name: '프로필 저장' }));
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  test('닫기는 저장 요청 없이 취소 콜백을 실행한다', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(<ProfileEditor user={{ ...account, profile: { kind: 'preset', preset: 'pink' } }} onSaved={vi.fn()} onCancel={onCancel} />);
    await screen.findByRole('radio', { name: '핑크' });
    await user.click(screen.getByRole('button', { name: '닫기' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(request.mock.calls.every(([, options]) => !options?.method)).toBe(true);
  });
});

describe('직접 등록 사진', () => {
  async function uploadEditor() {
    const user = userEvent.setup({ applyAccept: false });
    const onSaved = vi.fn();
    const view = render(<ProfileEditor user={account} onSaved={onSaved} />);
    await user.click(await screen.findByRole('radio', { name: '직접 등록' }));
    return { user, onSaved, ...view, input: screen.getByLabelText('사진 선택') };
  }

  test.each([
    ['지원하지 않는 형식', () => new File(['text'], 'profile.txt', { type: 'text/plain' })],
    ['5MB 초과', () => new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' })],
  ])('%s 파일은 업로드 요청 없이 거절한다', async (_name, makeFile) => {
    const { user, input, onSaved } = await uploadEditor();
    await user.upload(input, makeFile());
    expect(screen.getByRole('alert').textContent).toContain('5MB 이하');
    expect(screen.getByRole('button', { name: '프로필 저장' }).disabled).toBe(true);
    expect(screen.queryByAltText('선택한 프로필 미리 보기')).toBeNull();
    expect(request.mock.calls.some(([path]) => path === '/profile/image')).toBe(false);
    expect(onSaved).not.toHaveBeenCalled();
  });

  test('PNG 미리 보기를 바꾸면 이전 URL을 해제하고 선택한 파일만 전송한다', async () => {
    const { user, input, onSaved, unmount } = await uploadEditor();
    const first = new File(['first'], '첫번째.png', { type: 'image/png' });
    const second = new File(['second'], '두번째.png', { type: 'image/png' });
    await user.upload(input, first);
    const firstUrl = screen.getByAltText('선택한 프로필 미리 보기').getAttribute('src');
    await user.upload(input, second);
    const secondUrl = screen.getByAltText('선택한 프로필 미리 보기').getAttribute('src');
    expect(secondUrl).not.toBe(firstUrl);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(firstUrl);
    const profile = { kind: 'custom', image_url: '/api/profile/child/image?v=new' };
    request.mockResolvedValueOnce(profile);
    await user.click(screen.getByRole('button', { name: '프로필 저장' }));
    const [path, options] = request.mock.calls.at(-1);
    expect(path).toBe('/profile/image');
    expect(options.method).toBe('POST');
    expect(options.body.get('image')).toBe(second);
    expect(onSaved).toHaveBeenCalledExactlyOnceWith({ ...account, profile });
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(secondUrl);
  });

  test('안전성 검사 실패 후 사진을 유지하면서 기본 캐릭터로 바꿔 저장할 수 있다', async () => {
    const { user, input, onSaved } = await uploadEditor();
    await user.upload(input, new File(['png'], '사진.png', { type: 'image/png' }));
    request.mockRejectedValueOnce(new Error('안전성이 확인된 이미지만 사용할 수 있습니다.'));
    await user.click(screen.getByRole('button', { name: '프로필 저장' }));
    await screen.findByRole('alert');
    expect(screen.getByAltText('선택한 프로필 미리 보기')).toBeTruthy();
    expect(onSaved).not.toHaveBeenCalled();
    await user.click(screen.getByRole('radio', { name: '핑크' }));
    request.mockResolvedValueOnce({ kind: 'preset', preset: 'pink' });
    await user.click(screen.getByRole('button', { name: '프로필 저장' }));
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(request.mock.calls.at(-1)[0]).toBe('/profile');
  });
});

describe('사용자 아바타', () => {
  test('계정 전환 뒤 늦게 도착한 이전 사진을 표시하지 않는다', async () => {
    const first = deferred();
    const second = deferred();
    requestBlob.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const view = render(<Avatar user={{ ...account, profile: { kind: 'custom', image_url: '/first' } }} />);
    view.rerender(<Avatar user={{ ...account, name: '다음 사용자', profile: { kind: 'custom', image_url: '/second' } }} />);
    await act(async () => second.resolve(new Blob(['second'])));
    const image = within(screen.getByRole('img', { name: '다음 사용자 프로필' })).getByRole('presentation');
    const currentUrl = image.getAttribute('src');
    await act(async () => first.resolve(new Blob(['first'])));
    expect(image.getAttribute('src')).toBe(currentUrl);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(currentUrl);
  });

  test('사진 요청이 실패하면 선택한 기본 캐릭터를 유지한다', async () => {
    requestBlob.mockRejectedValueOnce(new Error('이미지 없음'));
    render(<Avatar user={{ ...account, profile: { kind: 'custom', preset: 'blue', image_url: '/missing' } }} />);
    await waitFor(() => expect(requestBlob).toHaveBeenCalledWith('/missing'));
    const image = within(screen.getByRole('img', { name: '검증 사용자 프로필' })).getByRole('presentation');
    expect(image.getAttribute('src')).toContain('PF06_blue');
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
});
