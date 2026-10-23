import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import BulkCardImport from '../../src/BulkCardImport';
import { request } from '../../src/services/api';

vi.mock('../../src/services/api', () => ({ request: vi.fn() }));
const categories = [{ id: 'food', name: '음식' }, { id: 'object', name: '물건' }];
const defaults = { targetId: 'child-a', targetName: '아동 A', categories, onImported: vi.fn() };
const photo = (name = '검증_연필.png', options = {}) => new File(['synthetic'], name, { type: 'image/png', ...options });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

beforeEach(() => {
  localStorage.setItem('pesc-mate-token', 'synthetic-session');
  defaults.onImported.mockReset();
  request.mockReset().mockImplementation(async (_, { body }) => ({
    id: `saved-${body.get('label')}`, label: body.get('label'), owner_id: body.get('user_id'), status: 'approved',
  }));
});

async function open(props = {}) {
  const user = userEvent.setup();
  const view = render(<StrictMode><BulkCardImport {...defaults} {...props} /></StrictMode>);
  await user.click(screen.getByText('사진 일괄 등록', { selector: 'summary' }));
  const panel = screen.getByRole('region', { name: '사진 일괄 등록' });
  return { user, view, panel: within(panel) };
}
async function choose(panel, user, files) {
  await user.upload(panel.getByLabelText('사진 여러 장 선택'), files);
  await user.selectOptions(panel.getByLabelText('공통 카테고리'), '물건');
  await user.click(panel.getByRole('button', { name: '미등록 항목에 분류 적용' }));
}

test('파일명 밑줄을 공백으로 제안하고 수정한 정보를 대상 아동의 개인 카드로 순차 저장한다', async () => {
  const { user, panel } = await open();
  const first = photo();
  await choose(panel, user, [first, photo('검증_공책.PNG')]);
  expect(panel.getByLabelText('카드명 1').value).toBe('검증 연필');
  expect(panel.getAllByRole('img')).toHaveLength(2);
  await user.clear(panel.getByLabelText('카드 뜻 1'));
  await user.type(panel.getByLabelText('카드 뜻 1'), '글씨를 쓰는 도구');
  await user.click(panel.getByRole('button', { name: '등록 가능한 2개 저장' }));
  await waitFor(() => expect(defaults.onImported).toHaveBeenCalledTimes(2));
  const bodies = request.mock.calls.map(([path, options]) => {
    expect(path).toBe('/cards/submissions'); expect(options.method).toBe('POST'); return options.body;
  });
  expect(bodies.map(body => body.get('label'))).toEqual(['검증 연필', '검증 공책']);
  expect(bodies[0].get('meaning')).toBe('글씨를 쓰는 도구');
  expect(bodies[0].get('image').name).toBe(first.name);
  for (const body of bodies) {
    expect(body.get('user_id')).toBe('child-a'); expect(body.get('visibility')).toBe('private');
    expect(body.get('category')).toBe('물건'); expect(body.get('submission_mode')).toBe('submit');
  }
  expect(panel.getByRole('button', { name: '등록 가능한 0개 저장' }).disabled).toBe(true);
  expect(panel.getByLabelText('카드명 1').disabled).toBe(true);
});

test('현재 아동 및 같은 선택 안의 중복 후보는 전송하지 않고 반려된 이름은 다시 쓸 수 있다', async () => {
  const { user, panel } = await open({ existingCards: [
    { label: '검증 연필', status: 'approved' }, { label: '다시등록', status: 'rejected' },
  ] });
  await choose(panel, user, [photo(), photo('검증__공책.png'), photo('검증공책.png'), photo('다시등록.png')]);
  expect(panel.getAllByText(/중복 후보/)).toHaveLength(3);
  await user.click(panel.getByRole('button', { name: '등록 가능한 1개 저장' }));
  await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
  expect(request.mock.calls[0][1].body.get('label')).toBe('다시등록');
});

test('명확히 거절된 항목만 수정 재시도하고 저장 완료 항목은 재전송하지 않는다', async () => {
  request.mockResolvedValueOnce({ id: 'first' }).mockRejectedValueOnce(Object.assign(new Error('합성 거절'), { status: 422 }));
  const { user, panel } = await open();
  await choose(panel, user, [photo(), photo('검증_공책.png')]);
  await user.click(panel.getByRole('button', { name: '등록 가능한 2개 저장' }));
  await panel.findByText('합성 거절');
  await user.click(panel.getByRole('button', { name: '등록 가능한 1개 저장' }));
  await waitFor(() => expect(defaults.onImported).toHaveBeenCalledTimes(2));
  expect(request.mock.calls.map(([, { body }]) => body.get('label'))).toEqual(['검증 연필', '검증 공책', '검증 공책']);
});

test.each([undefined, 503])('통신 또는 서버 오류 %s는 저장 여부 확인으로 분리해 재전송하지 않는다', async status => {
  request.mockRejectedValueOnce(Object.assign(new Error('결과를 알 수 없음'), { status }));
  const { user, panel } = await open();
  await choose(panel, user, [photo(), photo('검증_공책.png')]);
  await user.click(panel.getByRole('button', { name: '등록 가능한 2개 저장' }));
  await panel.findByText('저장 여부 확인 필요');
  expect(request).toHaveBeenCalledTimes(1);
  await user.click(panel.getByRole('button', { name: '등록 가능한 1개 저장' }));
  await waitFor(() => expect(defaults.onImported).toHaveBeenCalledTimes(1));
  expect(request.mock.calls.map(([, { body }]) => body.get('label'))).toEqual(['검증 연필', '검증 공책']);
  expect(panel.getByLabelText('카드명 1').disabled).toBe(true);
});

test('중단 요청은 진행 중 한 건만 확인한 뒤 다음 요청을 보내지 않는다', async () => {
  const pending = deferred(); request.mockReturnValueOnce(pending.promise);
  const { user, panel } = await open();
  await choose(panel, user, [photo(), photo('검증_공책.png')]);
  await user.click(panel.getByRole('button', { name: '등록 가능한 2개 저장' }));
  expect(request).toHaveBeenCalledTimes(1);
  await user.click(panel.getByRole('button', { name: '다음 항목부터 중단' }));
  await act(async () => pending.resolve({ id: 'first' }));
  expect(request).toHaveBeenCalledTimes(1);
  expect(defaults.onImported).toHaveBeenCalledTimes(1);
  expect(panel.getByRole('button', { name: '등록 가능한 1개 저장' }).disabled).toBe(false);
});

test('다른 아동 화면으로 전환하면 늦은 결과를 버리고 나머지 전송과 미리보기를 폐기한다', async () => {
  const pending = deferred(); request.mockReturnValueOnce(pending.promise);
  const { user, panel, view } = await open();
  await choose(panel, user, [photo(), photo('검증_공책.png')]);
  const urls = panel.getAllByRole('img').map(image => image.src);
  await user.click(panel.getByRole('button', { name: '등록 가능한 2개 저장' }));
  view.rerender(<StrictMode><BulkCardImport key="child-b" {...defaults} targetId="child-b" targetName="아동 B" /></StrictMode>);
  await act(async () => pending.resolve({ id: 'late' }));
  expect(request).toHaveBeenCalledTimes(1);
  expect(defaults.onImported).not.toHaveBeenCalled();
  for (const url of urls) expect(URL.revokeObjectURL).toHaveBeenCalledWith(url);
  expect(screen.queryByLabelText('카드명 1')).toBeNull();
});

test('세션 토큰 교체 후 늦은 응답은 목록에 반영하거나 다음 계정으로 이어서 전송하지 않는다', async () => {
  const pending = deferred(); request.mockReturnValueOnce(pending.promise);
  const { user, panel } = await open();
  await choose(panel, user, [photo(), photo('검증_공책.png')]);
  await user.click(panel.getByRole('button', { name: '등록 가능한 2개 저장' }));
  localStorage.setItem('pesc-mate-token', 'replaced-session');
  await act(async () => pending.resolve({ id: 'late' }));
  expect(request).toHaveBeenCalledTimes(1);
  expect(defaults.onImported).not.toHaveBeenCalled();
  expect(panel.getByText('저장 여부 확인 필요')).toBeTruthy();
});

test.each([401, 403])('인증·권한 거절 %s는 나머지 전송을 중단한다', async status => {
  request.mockRejectedValueOnce(Object.assign(new Error('권한 확인'), { status }));
  const { user, panel } = await open();
  await choose(panel, user, [photo(), photo('검증_공책.png')]);
  await user.click(panel.getByRole('button', { name: '등록 가능한 2개 저장' }));
  await panel.findByText('권한 확인 필요');
  expect(request).toHaveBeenCalledTimes(1);
});

test('파일 형식·용량·개수 제한과 제거 시 URL 해제를 처리한다', async () => {
  const { user, panel, view } = await open();
  const large = new File([new Uint8Array(5 * 1024 * 1024 + 1)], '검증_큰사진.png', { type: 'image/png' });
  fireEvent.change(panel.getByLabelText('사진 여러 장 선택'), { target: { files: [photo(), large, photo('위험.svg', { type: 'image/svg+xml' })] } });
  expect(panel.getAllByRole('img')).toHaveLength(1);
  expect(panel.getByText(/5MiB 이하/)).toBeTruthy();
  expect(panel.getByText(/JPG, PNG, WebP/)).toBeTruthy();
  fireEvent.change(panel.getByLabelText('사진 여러 장 선택'), { target: { files: Array.from({ length: 21 }, () => photo()) } });
  expect(panel.getByRole('alert').textContent).toContain('20장까지');
  expect(panel.getAllByRole('listitem')).toHaveLength(3);
  const url = panel.getByRole('img').src;
  await user.click(panel.getByRole('button', { name: '선택 사진 1 제외' }));
  expect(URL.revokeObjectURL).toHaveBeenCalledWith(url);
  expect(panel.queryByRole('img')).toBeNull();
  view.unmount(); expect(request).not.toHaveBeenCalled();
});

test('오프라인·관리 불가 상태는 저장과 파일 선택을 막는다', async () => {
  const { user, panel, view } = await open();
  await choose(panel, user, [photo()]);
  view.rerender(<StrictMode><BulkCardImport {...defaults} disabled /></StrictMode>);
  expect(panel.getByLabelText('사진 여러 장 선택').disabled).toBe(true);
  expect(panel.getByRole('button', { name: '등록 가능한 1개 저장' }).disabled).toBe(true);
  expect(request).not.toHaveBeenCalled();
});

test('목록 반영에 실패해도 서버가 확인한 저장은 재시도 대상으로 바꾸지 않는다', async () => {
  defaults.onImported.mockImplementation(() => { throw new Error('합성 UI 오류'); });
  const { user, panel } = await open();
  await choose(panel, user, [photo()]);
  await user.click(panel.getByRole('button', { name: '등록 가능한 1개 저장' }));
  await panel.findByText('사진은 저장됐습니다. 등록 목록을 다시 확인해 주세요.');
  expect(panel.getByText('저장 완료')).toBeTruthy();
  expect(panel.getByRole('button', { name: '등록 가능한 0개 저장' }).disabled).toBe(true);
});

test('자르기·회전·밝기는 사진별 미리보기에 반영하고 원본 파일과 보정 설정만 전송한다', async () => {
  const { user, panel } = await open();
  const original = photo();
  await choose(panel, user, [original, photo('검증_공책.png')]);
  await user.click(panel.getByLabelText('1번 사진 중앙 정사각형 자르기'));
  await user.click(panel.getByRole('button', { name: '1번 사진 오른쪽 90도 회전' }));
  fireEvent.change(panel.getByLabelText('1번 사진 밝기'), { target: { value: '125' } });
  const previews = panel.getAllByRole('img');
  expect(previews[0].style.objectFit).toBe('cover');
  expect(previews[0].style.transform).toBe('rotate(90deg)');
  expect(previews[0].style.filter).toBe('brightness(1.25)');
  expect(previews[1].style.filter).toBe('brightness(1)');
  await user.click(panel.getByRole('button', { name: '등록 가능한 2개 저장' }));
  await waitFor(() => expect(defaults.onImported).toHaveBeenCalledTimes(2));
  const bodies = request.mock.calls.map(([, options]) => options.body);
  expect(JSON.parse(bodies[0].get('image_edits'))).toEqual({ crop: 'square', rotation: 90, brightness: 125 });
  expect(bodies[0].get('image').name).toBe(original.name);
  expect(bodies[0].get('image').size).toBe(original.size);
  expect(bodies[1].has('image_edits')).toBe(false);
  expect(panel.getByRole('group', { name: '사진 보정 1' }).disabled).toBe(true);
});

test('네 번 회전과 보정 초기화는 다른 사진이나 원본 선택을 바꾸지 않는다', async () => {
  const { user, panel } = await open();
  await choose(panel, user, [photo()]);
  for (let turn = 0; turn < 4; turn += 1) await user.click(panel.getByRole('button', { name: '1번 사진 오른쪽 90도 회전' }));
  expect(panel.getByRole('img').style.transform).toBe('rotate(0deg)');
  await user.click(panel.getByLabelText('1번 사진 중앙 정사각형 자르기'));
  fireEvent.change(panel.getByLabelText('1번 사진 밝기'), { target: { value: '75' } });
  await user.click(panel.getByRole('button', { name: '1번 사진 보정 초기화' }));
  expect(panel.getByRole('img').style.objectFit).toBe('contain');
  expect(panel.getByRole('img').style.filter).toBe('brightness(1)');
  expect(panel.getByLabelText('1번 사진 중앙 정사각형 자르기').checked).toBe(false);
  await user.click(panel.getByRole('button', { name: '등록 가능한 1개 저장' }));
  await waitFor(() => expect(defaults.onImported).toHaveBeenCalledTimes(1));
  expect(request.mock.calls[0][1].body.has('image_edits')).toBe(false);
});

test('편집 설정도 실패 항목만 수정하며 저장 여부가 불명확한 항목은 잠근다', async () => {
  request.mockRejectedValueOnce(Object.assign(new Error('명확한 거절'), { status: 422 }))
    .mockRejectedValueOnce(new Error('통신 결과 불명'));
  const { user, panel } = await open();
  await choose(panel, user, [photo()]);
  await user.click(panel.getByRole('button', { name: '등록 가능한 1개 저장' }));
  await panel.findByText('명확한 거절');
  await user.click(panel.getByRole('button', { name: '1번 사진 오른쪽 90도 회전' }));
  await user.click(panel.getByRole('button', { name: '등록 가능한 1개 저장' }));
  await panel.findByText('저장 여부 확인 필요');
  expect(JSON.parse(request.mock.calls[1][1].body.get('image_edits')).rotation).toBe(90);
  expect(panel.getByRole('group', { name: '사진 보정 1' }).disabled).toBe(true);
});
