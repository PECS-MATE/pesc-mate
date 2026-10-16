import { StrictMode } from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import App from '../../src/App.jsx';
import { request } from '../../src/services/api';

const player = vi.hoisted(() => ({ speak: vi.fn(), pause: vi.fn(), resume: vi.fn(), stop: vi.fn() }));

vi.mock('../../src/services/api', async importOriginal => ({
  ...await importOriginal(), request: vi.fn(), requestBlob: vi.fn(),
  recordDeviceAccess: vi.fn(async () => {}),
}));
vi.mock('../../src/services/offlineStore', async importOriginal => {
  const actual = await importOriginal();
  return Object.fromEntries(Object.keys(actual).map(name => [name,
    vi.fn(async () => name.startsWith('pending') ? [] : null),
  ]));
});
vi.mock('../../src/services/coreSpeech', () => ({ createCoreSpeechCache: () => ({
  prepare: vi.fn(async () => ({ status: 'ready', ready: 13, saved: 13, total: 13 })),
  urlFor: vi.fn(), dispose: vi.fn(),
}) }));
vi.mock('../../src/services/speechPlayback', () => ({ createSpeechPlayback: () => player }));
vi.mock('../../src/services/offlineSync', () => ({ createOfflineSync: () => ({
  sync: vi.fn(async () => ({ cancelled: false, remaining: 0, failed: 0, syncedAttemptIds: [] })),
}) }));

const account = { id: 'component-child', username: 'component-child', name: '검증 사용자', role: 'user', profile: { kind: 'preset', preset: 'pink' } };
const cards = [
  { id: 'me', label: '나', category: '사람', symbol: '🙋' },
  { id: 'water', label: '물', category: '음식', symbol: '💧' },
  { id: 'drink', label: '마시다', category: '행동', symbol: '🥤' },
  { id: 'help', label: '도와주세요', category: '표현', symbol: '🤝' },
];
const categories = [
  { id: 'people', name: '사람' }, { id: 'food', name: '음식' },
  { id: 'action', name: '행동' }, { id: 'expression', name: '표현' },
];
let volume;

beforeEach(() => {
  volume = 1;
  localStorage.setItem('pesc-mate-token', 'component-test-session');
  player.speak.mockReset().mockImplementation(options => options.onStart());
  request.mockReset().mockImplementation(async (path, options = {}) => {
    if (path === '/auth/me') return account;
    if (path === '/cards' || path === '/recommendations') return cards;
    if (path === '/categories') return categories;
    if (path === '/dashboard') return { sessions: 0, selections: 0, unique_cards: 0, categories: {}, recent: [] };
    if (['/cards/submissions', '/support/links', '/privacy/audit'].includes(path)) return [];
    if (path === '/tts/settings') return { volume };
    if (path === '/accessibility/settings') return {
      display_mode: 'image_text', cards_per_page: 12, card_size: 'medium', text_size: 'medium',
      reduced_motion: false, high_contrast: false,
    };
    if (path === '/privacy/settings') return { guardian_consent: true, retention_days: 365 };
    if (path === '/board/layout') return {
      user_id: account.id, revision: 0, quick_expression_ids: ['help'],
      recovery_expression_ids: ['wrong_tap', 'not_that'], available_cards: cards,
      slots: cards.map((card, index) => ({ position: index + 1, card_id: card.id })),
    };
    if (path === '/tts/events') return { id: JSON.parse(options.body).request_id, status: 'requested' };
    if (path.startsWith('/tts/events/')) return { id: path.split('/').at(-1), ...JSON.parse(options.body) };
    if (path === '/sentences') throw new Error('문장 생성 서버에 연결하지 못했습니다.');
    throw new Error(`Unexpected API path: ${path}`);
  });
});

async function openCommunication() {
  const user = userEvent.setup();
  render(<StrictMode><App /></StrictMode>);
  const menu = await screen.findByRole('navigation', { name: '주 메뉴' });
  await screen.findByText('서비스 연결됨');
  await user.click(within(menu).getByRole('button', { name: /그림으로 말하기/ }));
  const workspace = screen.getByRole('heading', { name: '무엇을 말하고 싶나요?' }).closest('.workspace');
  const board = screen.getByRole('heading', { name: /나의 문장/ }).closest('section');
  return { user, workspace: within(workspace), board: within(board) };
}

const selectedLabels = board => board.queryAllByRole('listitem').map(item => item.querySelector('span').textContent.trim());

test('키보드와 버튼으로 카드를 선택하고 순서 변경·삭제해도 선택 순서가 보존된다', async () => {
  const { user, workspace, board } = await openCommunication();
  workspace.getByRole('button', { name: '나 문장에 담기', exact: true }).focus();
  await user.keyboard('{Enter}');
  await user.click(workspace.getByRole('button', { name: '물 문장에 담기', exact: true }));
  await user.click(workspace.getByRole('button', { name: '마시다 문장에 담기', exact: true }));
  expect(selectedLabels(board)).toEqual(['🙋 나', '💧 물', '🥤 마시다']);
  await user.click(board.getByRole('button', { name: '3번째 카드 앞으로' }));
  expect(selectedLabels(board)).toEqual(['🙋 나', '🥤 마시다', '💧 물']);
  await user.click(board.getByRole('button', { name: '2번째 카드 삭제' }));
  expect(selectedLabels(board)).toEqual(['🙋 나', '💧 물']);
  expect(JSON.parse(localStorage.getItem(`pesc-mate-board:${account.id}`))).toEqual(['me', 'water']);
  expect(player.speak).not.toHaveBeenCalled();
});

test('문장 생성 실패 후 선택 카드를 잃지 않고 선택한 순서 그대로 말할 수 있다', async () => {
  const { user, workspace, board } = await openCommunication();
  await user.click(workspace.getByRole('button', { name: '나 문장에 담기', exact: true }));
  await user.click(workspace.getByRole('button', { name: '물 문장에 담기', exact: true }));
  await user.click(board.getByRole('button', { name: '자연스러운 문장 만들기 · 저장' }));
  expect((await screen.findByRole('alert')).textContent).toContain('선택한 카드는 유지');
  expect(selectedLabels(board)).toEqual(['🙋 나', '💧 물']);
  await user.click(board.getByRole('button', { name: /선택 카드 그대로 말하기/ }));
  expect(player.speak).toHaveBeenCalledTimes(1);
  expect(player.speak.mock.calls[0][0].text).toBe('나 물');
  expect(selectedLabels(board)).toEqual(['🙋 나', '💧 물']);
});

test('동기적인 음성 시작 실패도 표현과 카드를 보존하고 다시 재생한다', async () => {
  const { user, workspace, board } = await openCommunication();
  await user.click(workspace.getByRole('button', { name: '물 문장에 담기', exact: true }));
  player.speak.mockImplementationOnce(options => options.onError('voice-unavailable'));
  await user.click(screen.getByRole('button', { name: '도와주세요 바로 말하기', exact: true }));
  const failure = await screen.findByRole('alert');
  expect(failure.textContent).toContain('전달할 표현: 도와주세요');
  expect(selectedLabels(board)).toEqual(['💧 물']);
  await waitFor(() => expect(request.mock.calls.some(([path, options]) =>
    path.startsWith('/tts/events/') && JSON.parse(options.body).status === 'failed')).toBe(true));
  await user.click(within(failure).getByRole('button', { name: '다시 재생', exact: true }));
  expect(player.speak).toHaveBeenCalledTimes(2);
  expect(player.speak.mock.calls[1][0].text).toBe('도와주세요');
  expect(screen.queryByRole('alert')).toBeNull();
});

test('음량 0은 무음 재생을 기록하지 않고 설정 안내를 표시한다', async () => {
  volume = 0;
  const { user } = await openCommunication();
  await user.click(screen.getByRole('button', { name: '도와주세요 바로 말하기', exact: true }));
  expect((await screen.findByRole('alert')).textContent).toContain('기본 볼륨이 0입니다.');
  expect(player.speak).not.toHaveBeenCalled();
  expect(request.mock.calls.some(([path]) => path === '/tts/events')).toBe(false);
  expect(screen.queryByRole('button', { name: '다시 재생', exact: true })).toBeNull();
});

test('카드 선택 한도를 넘어도 기존 12장은 유지한다', async () => {
  const { user, workspace, board } = await openCommunication();
  const water = workspace.getByRole('button', { name: '물 문장에 담기', exact: true });
  for (let count = 0; count < 13; count += 1) await user.click(water);
  expect(board.getAllByRole('listitem')).toHaveLength(12);
  expect(screen.getByRole('alert').textContent).toContain('최대 12장');
});

test('이전 발화의 늦은 종료 콜백이 현재 발화 상태와 이력을 덮어쓰지 않는다', async () => {
  const { user, workspace } = await openCommunication();
  await user.click(workspace.getByRole('button', { name: '물 단어 듣기', exact: true }));
  const previous = player.speak.mock.calls[0][0];
  await user.click(screen.getByRole('button', { name: '도와주세요 바로 말하기', exact: true }));
  const current = player.speak.mock.calls[1][0];
  await act(async () => previous.onEnd());
  expect(screen.getByText('음성 재생 중')).toBeTruthy();
  await act(async () => current.onEnd());
  await waitFor(() => expect(screen.queryByText('음성 재생 중')).toBeNull());
  const completions = request.mock.calls.filter(([path]) => path.startsWith('/tts/events/'));
  expect(completions).toHaveLength(2);
  expect(completions.map(([, options]) => JSON.parse(options.body).status).sort()).toEqual(['cancelled', 'succeeded']);
});
