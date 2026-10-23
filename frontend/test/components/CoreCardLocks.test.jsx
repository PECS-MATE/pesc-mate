import { StrictMode } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import CoreCardLocks from '../../src/CoreCardLocks';
import BoardSlotsEditor from '../../src/BoardSlotsEditor';
import { lockedSlotsPreserved } from '../../src/services/boardLocks';
import { request } from '../../src/services/api';

vi.mock('../../src/services/api', () => ({ request: vi.fn() }));
const cards = [{ id: 'help', label: '도움' }, { id: 'custom:a', label: '연필' }, { id: 'water', label: '물' }];
const layout = { revision: 2, available_cards: cards, locked_card_ids: [],
  slots: cards.map((card, index) => ({ card_id: card.id, position: index + 1 })) };
const saved = vi.fn(); const refresh = vi.fn();
beforeEach(() => {
  localStorage.setItem('pesc-mate-token', 'synthetic-session'); saved.mockReset(); refresh.mockReset();
  request.mockReset().mockResolvedValue({ ...layout, revision: 3, locked_card_ids: ['custom:a'] });
});
async function open(props = {}) {
  const user = userEvent.setup();
  const view = render(<StrictMode><CoreCardLocks layout={layout} targetId="child-a" onSaved={saved} onRefresh={refresh} {...props} /></StrictMode>);
  return { user, view };
}
async function confirm(user) {
  await user.click(screen.getByLabelText('잠금 또는 해제가 사진·위치 보호에 미치는 영향을 확인했습니다'));
}

test('저장된 슬롯에서 선택과 별도 확인 후에만 revision 조건부 잠금을 저장한다', async () => {
  const { user } = await open();
  expect(screen.getByRole('button', { name: '핵심 잠금 저장' }).disabled).toBe(true);
  await user.click(screen.getByLabelText('연필'));
  expect(request).not.toHaveBeenCalled(); await confirm(user);
  await user.click(screen.getByRole('button', { name: '핵심 잠금 저장' }));
  await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
  expect(request.mock.calls[0][0]).toBe('/board/layout/locks?user_id=child-a');
  expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({ expected_revision: 2, card_ids: ['custom:a'] });
  expect(screen.getByRole('button', { name: '핵심 잠금 저장' }).disabled).toBe(true);
});

test('마지막 잠금 해제는 빈 목록으로 저장하며 선택을 바꾸면 확인을 폐기한다', async () => {
  const { user } = await open({ layout: { ...layout, locked_card_ids: ['custom:a'] } });
  await user.click(screen.getByLabelText('연필')); await confirm(user);
  await user.click(screen.getByLabelText('물'));
  expect(screen.getByRole('button', { name: '핵심 잠금 저장' }).disabled).toBe(true);
  await user.click(screen.getByLabelText('물')); await confirm(user);
  await user.click(screen.getByRole('button', { name: '핵심 잠금 저장' }));
  await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
  expect(JSON.parse(request.mock.calls[0][1].body).card_ids).toEqual([]);
});

test.each([409, 503, undefined])('충돌·서버·통신 오류 %s 뒤에는 재조회 없이 다시 쓰지 않는다', async status => {
  request.mockRejectedValueOnce(Object.assign(new Error('합성 잠금 오류'), { status }));
  const { user } = await open(); await user.click(screen.getByLabelText('연필')); await confirm(user);
  await user.click(screen.getByRole('button', { name: '핵심 잠금 저장' })); await screen.findByRole('alert');
  expect(screen.getByRole('button', { name: '핵심 잠금 저장' }).disabled).toBe(true);
  await user.click(screen.getByRole('button', { name: '최신 잠금·카드판 확인' }));
  expect(refresh).toHaveBeenCalledTimes(1); expect(request).toHaveBeenCalledTimes(1);
});

test('다른 대상 또는 세션으로 전환하면 늦은 잠금 결과를 반영하지 않는다', async () => {
  let resolve; request.mockReturnValueOnce(new Promise(done => { resolve = done; }));
  const { user, view } = await open(); await user.click(screen.getByLabelText('연필')); await confirm(user);
  await user.click(screen.getByRole('button', { name: '핵심 잠금 저장' }));
  localStorage.setItem('pesc-mate-token', 'new-session');
  view.rerender(<StrictMode><CoreCardLocks key="other" layout={layout} targetId="child-b" onSaved={saved} onRefresh={refresh} /></StrictMode>);
  await act(async () => resolve({ ...layout, revision: 3 })); expect(saved).not.toHaveBeenCalled();
});

test('버전 갱신은 선택과 확인을 초기화하고 비활성 상태에서는 쓰지 않는다', async () => {
  const { user, view } = await open(); await user.click(screen.getByLabelText('연필')); await confirm(user);
  view.rerender(<StrictMode><CoreCardLocks layout={{ ...layout, revision: 3, locked_card_ids: ['water'] }} targetId="child-a" onSaved={saved} onRefresh={refresh} disabled /></StrictMode>);
  expect(screen.getByLabelText('연필').checked).toBe(false); expect(screen.getByLabelText('물').checked).toBe(true);
  expect(screen.getByLabelText('물').closest('fieldset').disabled).toBe(true);
  expect(request).not.toHaveBeenCalled();
});

test('저장된 잠금은 이웃 카드 제거·이동으로 밀리는 변경도 막고 잠금 밖 변경은 허용한다', async () => {
  const change = vi.fn(); const user = userEvent.setup();
  const locked = { ...layout, locked_card_ids: ['custom:a'] };
  render(<BoardSlotsEditor layout={locked} value={cards.map(card => card.id)} onChange={change} onSave={vi.fn()} />);
  for (const label of ['연필 앞으로', '연필 뒤로', '연필 제외', '도움 뒤로', '도움 제외', '물 앞으로']) {
    expect(screen.getByRole('button', { name: label, exact: true }).disabled).toBe(true);
  }
  await user.click(screen.getByRole('button', { name: '물 제외', exact: true }));
  expect(change).toHaveBeenCalledWith(['help', 'custom:a']);
  expect(lockedSlotsPreserved(locked, ['help', 'water'])).toBe(false);
});

test('부모의 미저장 초안이 새 잠금과 다르면 저장을 막는다', () => {
  render(<BoardSlotsEditor layout={{ ...layout, locked_card_ids: ['custom:a'] }} value={['custom:a', 'help']} onChange={vi.fn()} onSave={vi.fn()} />);
  expect(screen.getByRole('alert').textContent).toContain('최신 카드판');
  expect(screen.getByRole('button', { name: '카드판 저장' }).disabled).toBe(true);
});
