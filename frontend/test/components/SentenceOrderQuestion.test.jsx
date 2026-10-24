import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import SentenceOrderQuestion from '../../src/SentenceOrderQuestion';

const water = { id: 'water', label: '물' }, drink = { id: 'drink', label: '마시다' };
const question = { content_id: 'water-drink', prompt: '물을 마셔요.', sequence: [water, drink], target: drink, options: [drink, water] };
const artStyle = () => ({});
const base = { phase: 'playing', sequenceIds: [], feedback: '' };
function Exercise({ onAnswer, initial = base }) {
  const [game, setGame] = useState(initial);
  return <SentenceOrderQuestion game={game} question={question} artStyle={artStyle}
    onChange={ids => setGame(current => ({ ...current, sequenceIds: ids }))} onAnswer={onAnswer} />;
}

test('완성 전에 확인을 막고 카드 선택·빼기·다시 놓기로 순서를 만들 수 있다', async () => {
  const user = userEvent.setup(), answer = vi.fn(); render(<Exercise onAnswer={answer} />);
  expect(screen.getByRole('heading', { name: '물을 마셔요.' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '순서 확인' }).disabled).toBe(true);
  await user.click(screen.getByRole('button', { name: '마시다 순서에 담기' }));
  expect(screen.getByRole('button', { name: '마시다 순서에 담기' }).disabled).toBe(true);
  await user.click(screen.getByRole('button', { name: '1번째 마시다 빼기' }));
  await user.click(screen.getByRole('button', { name: '물 순서에 담기' }));
  await user.click(screen.getByRole('button', { name: '마시다 순서에 담기' }));
  const choices = within(screen.getByRole('list', { name: '선택한 카드 순서' })).getAllByRole('listitem');
  expect(choices.map(item => item.textContent)).toEqual(['1. 물 ×', '2. 마시다 ×']);
  await user.click(screen.getByRole('button', { name: '순서 확인' }));
  expect(answer).toHaveBeenCalledWith(['water', 'drink']);
});

test('재개한 선택을 보여 주고 같은 오답을 바꾸지 않고 반복 제출하지 않는다', async () => {
  const user = userEvent.setup(); render(<Exercise onAnswer={vi.fn()} initial={{ ...base,
    feedback: 'retry', sequenceIds: ['drink', 'water'], selectedId: 'drink|water' }} />);
  expect(screen.getByRole('button', { name: '순서 확인' }).disabled).toBe(true);
  await user.click(screen.getByRole('button', { name: '1번째 마시다 빼기' }));
  await user.click(screen.getByRole('button', { name: '마시다 순서에 담기' }));
  expect(screen.getByRole('button', { name: '순서 확인' }).disabled).toBe(false);
});

test.each(['correct', 'incorrect', 'saving'])('답변 확정과 저장 중에는 카드와 제출을 잠근다: %s', async status => {
  const answer = vi.fn(), change = vi.fn();
  render(<SentenceOrderQuestion game={{ ...base, sequenceIds: ['water', 'drink'],
    phase: status === 'saving' ? 'saving' : 'playing', feedback: status === 'saving' ? '' : status }}
    question={question} artStyle={artStyle} onAnswer={answer} onChange={change} />);
  for (const button of screen.getAllByRole('button')) expect(button.disabled).toBe(true);
  expect(answer).not.toHaveBeenCalled(); expect(change).not.toHaveBeenCalled();
});
