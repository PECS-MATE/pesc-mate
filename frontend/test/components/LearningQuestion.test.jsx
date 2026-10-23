import { StrictMode } from 'react';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import LearningQuestion from '../../src/LearningQuestion';

const question = { target: { id: 'water', label: '물' }, options: [{ id: 'water', label: '물' }, { id: 'rice', label: '밥' }] };
const game = { phase: 'playing', activity_type: 'sound_picture_match', feedback: '', selectedId: '' };
const artStyle = card => ({ backgroundImage: `url(/synthetic-${card.id}.png)` });

test('기존 그림·단어 연습은 소리 요청 없이 같은 보기를 선택한다', async () => {
  const answer = vi.fn(); const listen = vi.fn(); const user = userEvent.setup();
  render(<LearningQuestion game={{ ...game, activity_type: 'word_picture_match' }} question={question} artStyle={artStyle} onAnswer={answer} onListen={listen} />);
  expect(screen.getByRole('img', { name: '문제 그림' })).toBeTruthy();
  await user.click(within(screen.getByRole('group', { name: '단어 보기' })).getByRole('button', { name: '물', exact: true }));
  expect(answer).toHaveBeenCalledWith('water'); expect(listen).not.toHaveBeenCalled();
});

test('문제 소리는 자동 재생하지 않고 실제 시작 콜백 후에만 카드를 고른다', async () => {
  const answer = vi.fn(); let callbacks; const cancel = vi.fn(); const user = userEvent.setup();
  const listen = vi.fn((_, events) => { callbacks = events; return cancel; });
  const view = render(<StrictMode><LearningQuestion game={game} question={question} artStyle={artStyle} onAnswer={answer} onListen={listen} /></StrictMode>);
  const options = within(screen.getByRole('group', { name: '카드 보기' }));
  expect(listen).not.toHaveBeenCalled(); expect(screen.queryByRole('img', { name: '문제 그림' })).toBeNull();
  expect(options.getByRole('button', { name: '물' }).disabled).toBe(true);
  await user.click(screen.getByRole('button', { name: '문제 소리 듣기' }));
  expect(listen).toHaveBeenCalledWith(question.target, expect.any(Object));
  expect(options.getByRole('button', { name: '물' }).disabled).toBe(true);
  act(() => callbacks.onStart());
  await user.click(options.getByRole('button', { name: '물' }));
  expect(answer).toHaveBeenCalledWith('water'); view.unmount(); expect(cancel).toHaveBeenCalled();
});

test('음성 오류는 시작·정답으로 처리하지 않고 안내 후 다시 재생할 수 있다', async () => {
  const answer = vi.fn(); const user = userEvent.setup();
  const listen = vi.fn((_, events) => { events.onError('합성 기기 음성 오류'); return vi.fn(); });
  render(<LearningQuestion game={game} question={question} artStyle={artStyle} onAnswer={answer} onListen={listen} />);
  await user.click(screen.getByRole('button', { name: '문제 소리 듣기' }));
  expect(screen.getByRole('alert').textContent).toContain('합성 기기 음성 오류');
  expect(screen.getByRole('button', { name: '물' }).disabled).toBe(true);
  await user.click(screen.getByRole('button', { name: '문제 소리 듣기' }));
  expect(listen).toHaveBeenCalledTimes(2); expect(answer).not.toHaveBeenCalled();
});

test('문제가 바뀐 뒤 이전 음성 콜백으로 다음 보기의 잠금을 해제하지 않는다', async () => {
  let callbacks; const cancel = vi.fn(); const user = userEvent.setup();
  const listen = vi.fn((_, events) => { callbacks = events; return cancel; });
  const props = { game, question, artStyle, onAnswer: vi.fn(), onListen: listen };
  const view = render(<LearningQuestion key="first" {...props} />);
  await user.click(screen.getByRole('button', { name: '문제 소리 듣기' }));
  view.rerender(<LearningQuestion key="second" {...props} />);
  act(() => callbacks.onStart());
  expect(screen.getByRole('button', { name: '물' }).disabled).toBe(true); expect(cancel).toHaveBeenCalled();
});

test('이미 답한 문제와 저장 중에는 추가 선택을 막고 끝난 뒤에만 문제 단어를 표시한다', () => {
  const view = render(<LearningQuestion game={{ ...game, feedback: 'correct', selectedId: 'water' }} question={question} artStyle={artStyle} onAnswer={vi.fn()} onListen={vi.fn()} />);
  expect(screen.getByText('문제 단어: 물')).toBeTruthy();
  expect(screen.getByRole('button', { name: '물' }).disabled).toBe(true);
  view.rerender(<LearningQuestion game={{ ...game, phase: 'saving' }} question={question} artStyle={artStyle} onAnswer={vi.fn()} onListen={vi.fn()} />);
  expect(screen.getByRole('button', { name: '문제 소리 듣기' }).disabled).toBe(true);
});
