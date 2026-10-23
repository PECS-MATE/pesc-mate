import { StrictMode } from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import ImportedBoardOrder from '../../src/ImportedBoardOrder';
import { importedBoardPlan } from '../../src/services/importedBoard';
import { request } from '../../src/services/api';

vi.mock('../../src/services/api', () => ({ request: vi.fn() }));
const imported = [{ id: 'custom:a', label: '가져온 연필' }, { id: 'custom:b', label: '가져온 공책' }];
const base = { user_id: 'child-a', revision: 3, slots: [{ position: 1, card_id: 'help' }],
  available_cards: [{ id: 'help', label: '도와주세요' }, ...imported] };
const pending = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
beforeEach(() => {
  localStorage.setItem('pesc-mate-token', 'synthetic-session');
  request.mockReset().mockImplementation(async (_, options = {}) => options.method === 'PUT'
    ? { ...base, revision: 4, slots: JSON.parse(options.body).card_ids.map((id, index) => ({ card_id: id, position: index + 1 })) }
    : base);
});
async function open(props = {}) {
  const user = userEvent.setup();
  const view = render(<StrictMode><ImportedBoardOrder targetId="child-a" cards={imported} {...props} /></StrictMode>);
  return { user, view };
}
const prepare = user => user.click(screen.getByRole('button', { name: '최신 카드판과 적용 순서 확인' }));
const confirm = user => user.click(screen.getByLabelText('변경 전후 순서와 기존 슬롯에 미치는 영향을 확인했습니다'));

test('순서 계획은 기존 슬롯 뒤 추가·교체를 구분하며 사용 불가·중복·한도·잠금을 검사한다', () => {
  expect(importedBoardPlan(base, imported).after).toEqual(['help', 'custom:a', 'custom:b']);
  expect(importedBoardPlan(base, imported, 'replace').after).toEqual(['custom:a', 'custom:b']);
  const full = { ...base, slots: Array.from({ length: 30 }, (_, i) => ({ position: i + 1, card_id: `core:${i}` })) };
  expect(importedBoardPlan(full, imported).issues.join()).toContain('최대 30장');
  expect(importedBoardPlan(base, [imported[0], imported[0]]).issues.join()).toContain('서로 다른');
  expect(importedBoardPlan(base, [{ id: 'foreign' }]).issues.join()).toContain('사용할 수 없는');
  expect(importedBoardPlan({ ...base, locked_card_ids: ['help'] }, imported, 'replace').issues.join()).toContain('잠긴');
});

test('직접 조회하고 변경 전후 확인에 동의하기 전에는 쓰지 않으며 revision과 대상만 전송한다', async () => {
  const { user } = await open(); expect(request).not.toHaveBeenCalled();
  await prepare(user);
  expect(request.mock.calls[0][0]).toBe('/board/layout?user_id=child-a');
  expect(within(screen.getByRole('list', { name: '현재 카드판 순서' })).getAllByRole('listitem')).toHaveLength(1);
  expect(within(screen.getByRole('list', { name: '적용할 카드판 순서' })).getAllByRole('listitem')).toHaveLength(3);
  expect(screen.getByRole('button', { name: '확인한 순서로 카드판 저장' }).disabled).toBe(true);
  await confirm(user);
  await user.click(screen.getByRole('button', { name: '확인한 순서로 카드판 저장' }));
  await screen.findByText(/카드판에 저장했습니다/);
  const [path, options] = request.mock.calls[1];
  expect(path).toBe('/board/layout/slots?user_id=child-a');
  expect(JSON.parse(options.body)).toEqual({ expected_revision: 3, card_ids: ['help', 'custom:a', 'custom:b'] });
  expect(screen.getByRole('button', { name: '확인한 순서로 카드판 저장' }).disabled).toBe(true);
  expect(screen.getByText(/이미 같은 순서/)).toBeTruthy();
});

test('교체 선택과 순서 변경은 이전 확인을 폐기한다', async () => {
  const { user, view } = await open(); await prepare(user); await confirm(user);
  await user.selectOptions(screen.getByLabelText('카드판 적용 방식'), 'replace');
  expect(screen.getByLabelText('변경 전후 순서와 기존 슬롯에 미치는 영향을 확인했습니다').checked).toBe(false);
  expect(within(screen.getByRole('list', { name: '적용할 카드판 순서' })).getAllByRole('listitem').map(row => row.textContent)).toEqual(['가져온 연필', '가져온 공책']);
  view.rerender(<StrictMode><ImportedBoardOrder targetId="child-a" cards={[...imported].reverse()} /></StrictMode>);
  expect(screen.queryByRole('list', { name: '적용할 카드판 순서' })).toBeNull();
  expect(request).toHaveBeenCalledTimes(1);
});

test.each([409, 503])('충돌 또는 저장 결과 불명 %s 뒤에는 최신 조회 없이 재전송하지 않는다', async status => {
  const original = request.getMockImplementation();
  request.mockImplementation((path, options) => options?.method === 'PUT'
    ? Promise.reject(Object.assign(new Error('합성 저장 오류'), { status })) : original(path, options));
  const { user } = await open(); await prepare(user); await confirm(user);
  await user.click(screen.getByRole('button', { name: '확인한 순서로 카드판 저장' }));
  await screen.findByText(status === 409 ? /다른 기기에서 카드판/ : /합성 저장 오류/);
  expect(screen.queryByRole('button', { name: '확인한 순서로 카드판 저장' })).toBeNull();
  expect(request).toHaveBeenCalledTimes(2);
  await prepare(user);
  expect(screen.getByLabelText('변경 전후 순서와 기존 슬롯에 미치는 영향을 확인했습니다').checked).toBe(false);
});

test('이전 대상의 늦은 조회는 새 대상에 표시하지 않는다', async () => {
  const gate = pending(); request.mockReturnValueOnce(gate.promise);
  const { user, view } = await open(); await prepare(user);
  view.rerender(<StrictMode><ImportedBoardOrder targetId="child-b" cards={imported} /></StrictMode>);
  await act(async () => gate.resolve(base));
  expect(screen.queryByRole('list')).toBeNull();
  expect(request).toHaveBeenCalledTimes(1);
});

test('권한·오프라인으로 비활성화한 뒤 늦은 조회를 표시하지 않는다', async () => {
  const gate = pending(); request.mockReturnValueOnce(gate.promise);
  const { user, view } = await open(); await prepare(user);
  view.rerender(<StrictMode><ImportedBoardOrder targetId="child-a" cards={imported} disabled /></StrictMode>);
  await act(async () => gate.resolve(base));
  expect(screen.queryByRole('list')).toBeNull();
  expect(screen.getByRole('button', { name: '최신 카드판과 적용 순서 확인' }).disabled).toBe(true);
});

test('조회 중 세션이 교체되거나 화면을 떠나면 결과를 버린다', async () => {
  const gate = pending(); request.mockReturnValueOnce(gate.promise);
  const { user, view } = await open(); await prepare(user);
  localStorage.setItem('pesc-mate-token', 'other-session');
  await act(async () => gate.resolve(base));
  expect(screen.queryByRole('list')).toBeNull();
  view.unmount(); expect(request).toHaveBeenCalledTimes(1);
});
