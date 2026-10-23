import { StrictMode } from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import SituationBoards from '../../src/SituationBoards';
import SituationBoardPicker from '../../src/SituationBoardPicker';
import { request } from '../../src/services/api';

vi.mock('../../src/services/api', () => ({ request: vi.fn() }));
const cards = [{ id: 'help', label: '도움' }, { id: 'water', label: '물' }];
const slots = ids => ids.map((id, index) => ({ position: index + 1, card_id: id }));
const home = { id: 'home', name: '집', slots: slots(['help', 'water']) };
const base = { user_id: 'child-a', revision: 3, slots: slots(['help', 'water']),
  locked_card_ids: [], situations: [home], available_cards: cards,
  situation_names: ['집', '학교', '치료실', '외출', '식사', '병원'], max_situations: 6 };
const saved = vi.fn(); const refresh = vi.fn();
beforeEach(() => {
  localStorage.setItem('pesc-mate-token', 'synthetic-session'); saved.mockReset(); refresh.mockReset();
  request.mockReset().mockResolvedValue({ ...base, revision: 4 });
});
async function open(props = {}) {
  const user = userEvent.setup();
  const view = render(<StrictMode><SituationBoards layout={base} targetId="child-a" onSaved={saved} onRefresh={refresh} {...props} /></StrictMode>);
  return { user, view };
}

test('기본 상황 제안과 복사 위치를 확인한 뒤 현재 아동 revision으로만 새 상황을 만든다', async () => {
  const { user } = await open();
  expect(within(screen.getByLabelText('기본 상황 이름')).getAllByRole('option').map(item => item.value)).toEqual(['', '집', '학교', '치료실', '외출', '식사', '병원']);
  await user.selectOptions(screen.getByLabelText('기본 상황 이름'), '학교');
  expect(screen.getByLabelText('새 상황 이름').value).toBe('학교');
  expect(screen.getByRole('button', { name: '확인한 카드판으로 상황 만들기' }).disabled).toBe(true);
  await user.click(screen.getByLabelText('복사할 위치와 새 상황 이름을 확인했습니다'));
  await user.click(screen.getByRole('button', { name: '확인한 카드판으로 상황 만들기' }));
  await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
  const [path, options] = request.mock.calls[0];
  expect(path).toBe('/board/layout/situations?user_id=child-a');
  expect(JSON.parse(options.body)).toEqual({ expected_revision: 3, operation: 'create', name: '학교' });
});

test('선택한 상황 복사는 해당 원본 ID만 보내고 슬롯 편집은 별도 확인한다', async () => {
  const { user } = await open(); await user.type(screen.getByLabelText('새 상황 이름'), '학교');
  await user.click(screen.getByLabelText('복사할 위치와 새 상황 이름을 확인했습니다'));
  await user.selectOptions(screen.getByLabelText('복사할 카드판'), 'home');
  expect(screen.getByRole('button', { name: '확인한 카드판으로 상황 만들기' }).disabled).toBe(true);
  await user.click(screen.getByLabelText('복사할 위치와 새 상황 이름을 확인했습니다'));
  await user.click(screen.getByRole('button', { name: '확인한 카드판으로 상황 만들기' }));
  await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
  expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({ expected_revision: 3, operation: 'copy', name: '학교', source_id: 'home' });
});

test('상황 슬롯 편집과 삭제는 기본 카드판·사진 변경 필드 없이 명시 요청한다', async () => {
  const { user, view } = await open(); await user.selectOptions(screen.getByLabelText('편집할 상황'), 'home');
  const editor = within(screen.getByRole('article', { name: '상황 슬롯 편집' }));
  await user.click(editor.getByRole('button', { name: '물 앞으로', exact: true }));
  await user.click(screen.getByLabelText('이 상황의 이름과 변경할 슬롯 순서를 확인했습니다'));
  await user.click(editor.getByRole('button', { name: '확인한 상황 저장' }));
  await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
  expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({ expected_revision: 3, operation: 'update', situation_id: 'home', name: '집', card_ids: ['water', 'help'] });
  view.rerender(<StrictMode><SituationBoards layout={{ ...base, revision: 4 }} targetId="child-a" onSaved={saved} onRefresh={refresh} /></StrictMode>);
  await user.click(screen.getByLabelText('집 상황 구성만 삭제하는 것을 확인했습니다'));
  await user.click(screen.getByRole('button', { name: '선택한 상황만 삭제' }));
  await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  expect(JSON.parse(request.mock.calls[1][1].body)).toEqual({ expected_revision: 4, operation: 'delete', situation_id: 'home' });
});

test.each([409, 503, undefined])('불명확한 저장 오류 %s는 최신 구성 확인 전 재전송하지 않는다', async status => {
  request.mockRejectedValueOnce(Object.assign(new Error('합성 상황 저장 오류'), { status }));
  const { user } = await open(); await user.type(screen.getByLabelText('새 상황 이름'), '학교');
  await user.click(screen.getByLabelText('복사할 위치와 새 상황 이름을 확인했습니다'));
  await user.click(screen.getByRole('button', { name: '확인한 카드판으로 상황 만들기' }));
  await screen.findByRole('alert');
  expect(screen.getByRole('button', { name: '확인한 카드판으로 상황 만들기' }).matches(':disabled')).toBe(true);
  await user.click(screen.getByRole('button', { name: '확인한 카드판으로 상황 만들기' }));
  await user.click(screen.getByRole('button', { name: '최신 상황·카드판 확인' }));
  expect(refresh).toHaveBeenCalledTimes(1); expect(request).toHaveBeenCalledTimes(1);
});

test('다른 아동으로 전환하면 늦은 상황 저장을 반영하지 않는다', async () => {
  let resolve; request.mockReturnValueOnce(new Promise(done => { resolve = done; }));
  const { user, view } = await open(); await user.type(screen.getByLabelText('새 상황 이름'), '학교');
  await user.click(screen.getByLabelText('복사할 위치와 새 상황 이름을 확인했습니다'));
  await user.click(screen.getByRole('button', { name: '확인한 카드판으로 상황 만들기' }));
  view.rerender(<StrictMode><SituationBoards key="child-b" layout={base} targetId="child-b" onSaved={saved} onRefresh={refresh} /></StrictMode>);
  await act(async () => resolve({ ...base, revision: 4 })); expect(saved).not.toHaveBeenCalled();
});

test('사용자는 오프라인에서도 위치 미리보기·확인 뒤에만 저장된 상황을 선택한다', async () => {
  const select = vi.fn(); const user = userEvent.setup();
  render(<SituationBoardPicker layout={base} active={null} onSelect={select} offline />);
  await user.click(screen.getByText('상황 카드판 바꾸기', { selector: 'summary' }));
  await user.selectOptions(screen.getByLabelText('사용할 상황 카드판'), 'home');
  expect(select).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: '확인한 상황 카드판 사용' }).disabled).toBe(true);
  expect(screen.getByRole('status').textContent).toContain('이 기기에 저장된 구성');
  await user.click(screen.getByLabelText('바뀔 카드판과 위치를 확인했어요'));
  await user.click(screen.getByRole('button', { name: '확인한 상황 카드판 사용' }));
  expect(select).toHaveBeenCalledWith(home); expect(request).not.toHaveBeenCalled();
});

test('선택 중 최신 구성이 바뀌면 확인을 폐기하고 현재 보관본 위치는 자동 변경하지 않는다', async () => {
  const select = vi.fn(); const user = userEvent.setup();
  const view = render(<SituationBoardPicker layout={base} active={home} onSelect={select} />);
  await user.click(screen.getByText('상황 카드판 바꾸기', { selector: 'summary' }));
  await user.click(screen.getByLabelText('바뀔 카드판과 위치를 확인했어요'));
  view.rerender(<SituationBoardPicker layout={{ ...base, situations: [] }} active={home} onSelect={select} />);
  expect(screen.getByRole('alert').textContent).toContain('이 화면의 위치는 유지');
  expect(screen.getByRole('button', { name: '확인한 상황 카드판 사용' }).disabled).toBe(true);
  expect(select).not.toHaveBeenCalled();
});
