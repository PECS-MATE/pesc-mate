import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import App from '../../src/App.jsx';
import { request } from '../../src/services/api';
import { cacheLearningGame, cachedAccount, cachedSnapshot } from '../../src/services/offlineStore';

const player = vi.hoisted(() => ({ speak: vi.fn(), pause: vi.fn(), resume: vi.fn(), stop: vi.fn() }));
const synchronizer = vi.hoisted(() => ({ sync: vi.fn() }));

vi.mock('../../src/services/api', async importOriginal => ({
  ...await importOriginal(), request: vi.fn(), requestBlob: vi.fn(),
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
vi.mock('../../src/services/offlineSync', () => ({ createOfflineSync: () => synchronizer }));

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
  synchronizer.sync.mockReset().mockResolvedValue({ cancelled: false, remaining: 0, failed: 0, syncedAttemptIds: [] });
  request.mockReset().mockImplementation(async (path, options = {}) => {
    if (path === '/auth/me') return account;
    if (path === '/cards' || path === '/recommendations') return cards;
    if (path === '/recommendations/feed') return { cards, enabled: true, mode: 'automatic', algorithm_version: 'aac-candidates-v1', batch_id: null };
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
    if (path === '/offline/events/sync') return { accepted_ids: JSON.parse(options.body).events.map(event => event.id) };
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

async function openSentencePractice() {
  const original = request.getMockImplementation();
  request.mockImplementation((path, options) => {
    if (path === '/learning/settings') return { category_ids: categories.map(item => item.id), question_count: 5,
      option_count: 3, repeat_frequency: 1, retry_enabled: false, time_limit_seconds: 60 };
    if (path === '/learning/progress?days=30') return { attempts: 0 };
    return original(path, options);
  });
  const user = userEvent.setup(); render(<StrictMode><App /></StrictMode>);
  const menu = await screen.findByRole('navigation', { name: '주 메뉴' });
  await screen.findByText('서비스 연결됨');
  await user.click(within(menu).getByRole('button', { name: '연습하기', exact: true }));
  await user.selectOptions(await screen.findByLabelText('연습 종류'), 'sentence_card_order');
  return user;
}

test('문장 연습은 재도전이 꺼진 오답을 한 번만 집계하고 다음 문제의 선택을 비운다', async () => {
  vi.spyOn(Math, 'random').mockReturnValue(0.999); // Fixed two-card example, not random test runtime.
  const user = await openSentencePractice();
  await user.click(screen.getByRole('button', { name: '연습 시작', exact: true }));
  const exercise = within(screen.getByRole('heading', { name: '물을 마셔요.' }).closest('article'));
  const labels = [...screen.getByRole('list', { name: '예문 카드 순서' }).querySelectorAll('strong')];
  for (const label of labels.map(item => item.textContent).toReversed()) {
    await user.click(exercise.getByRole('button', { name: `${label} 순서에 담기`, exact: true }));
  }
  await user.click(exercise.getByRole('button', { name: '순서 확인', exact: true }));
  expect(exercise.getByRole('button', { name: '순서 확인', exact: true }).disabled).toBe(true);
  expect(screen.getByText(/예문 순서는 .*천천히 다시 살펴봐요/)).toBeTruthy();
  const result = cacheLearningGame.mock.calls.at(-1)[1].game;
  expect(result.results).toHaveLength(1); expect(result.results[0].first_try_correct).toBe(false);
  expect(result.correctAnswers).toBe(0);
  await user.click(exercise.getByRole('button', { name: '다음 문제', exact: true }));
  expect(within(screen.getByRole('list', { name: '선택한 카드 순서' })).queryAllByRole('listitem')).toHaveLength(0);
  expect(cacheLearningGame.mock.calls.at(-1)[1].game.questionIndex).toBe(1);
  expect(request.mock.calls.some(([path]) => ['/sentences', '/tts/events', '/learning/attempts'].includes(path))).toBe(false);
});

test('문장 예문이 없는 카테고리는 다른 범위 안내와 시작 비활성화를 제공한다', async () => {
  const user = await openSentencePractice();
  await user.selectOptions(screen.getByLabelText('연습 범위'), 'food');
  expect(screen.getByRole('button', { name: '연습 시작', exact: true }).disabled).toBe(true);
  expect(screen.getByText(/선택 범위에 예문 카드가 없습니다/)).toBeTruthy();
  await user.selectOptions(screen.getByLabelText('연습 범위'), 'all');
  expect(screen.getByRole('button', { name: '연습 시작', exact: true }).disabled).toBe(false);
});

test('동의가 없어도 기본 말하기를 유지하며 선택·발화·추천 요청과 기기 선택 기록을 남기지 않는다', async () => {
  const original = request.getMockImplementation();
  request.mockImplementation((path, options) => path === '/privacy/settings' ? { guardian_consent: false, retention_days: 365 } : original(path, options));
  const { user, workspace, board } = await openCommunication();
  expect(within(screen.getByRole('navigation', { name: '주 메뉴' })).queryByRole('button', { name: '개인정보', exact: true })).toBeNull();
  expect(screen.queryByRole('heading', { name: '개인정보와 열람 권한' })).toBeNull();
  await user.click(workspace.getByRole('button', { name: '물 문장에 담기', exact: true }));
  await user.click(board.getByRole('button', { name: /선택 카드 그대로 말하기/ }));
  expect(player.speak).toHaveBeenCalled();
  expect(localStorage.getItem(`pesc-mate-board:${account.id}`)).toBeNull();
  expect(request.mock.calls.filter(([, options]) => ['POST', 'PATCH'].includes(options?.method))).toEqual([]);
  expect(synchronizer.sync).not.toHaveBeenCalled();
});

test('보호자 설정의 미저장 동의 체크는 기록 수집을 켜지 않는다', async () => {
  const original = request.getMockImplementation();
  request.mockImplementation((path, options) => path === '/privacy/settings' ? { guardian_consent: false, retention_days: 365 } : original(path, options));
  const { user } = await openCommunication();
  await user.click(screen.getByText('보호자 설정', { selector: 'summary' }));
  await user.click(screen.getByRole('button', { name: '개인정보·동의 관리' }));
  await user.click(screen.getByLabelText('법정대리인이 개인정보 수집·이용에 동의했음을 확인합니다.'));
  await user.click(within(screen.getByRole('navigation', { name: '주 메뉴' })).getByRole('button', { name: /그림으로 말하기/ }));
  await user.click(screen.getByRole('button', { name: '물 문장에 담기', exact: true }));
  await user.click(screen.getByRole('button', { name: /선택 카드 그대로 말하기/ }));
  expect(player.speak).toHaveBeenCalled();
  expect(request.mock.calls.filter(([, options]) => ['POST', 'PUT', 'PATCH'].includes(options?.method))).toEqual([]);
  expect(localStorage.getItem(`pesc-mate-board:${account.id}`)).toBeNull();
});

test('동의 없는 오프라인 계정은 개인정보 화면 대신 기록 없는 카드 말하기를 복원한다', async () => {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  cachedAccount.mockResolvedValueOnce(account);
  cachedSnapshot.mockResolvedValueOnce({ cards, categories, privacy: { guardian_consent: false, retention_days: 365 },
    accessibility: { cards_per_page: 12 }, board_layout: { slots: cards.map((card, index) => ({ card_id: card.id, position: index + 1 })),
      quick_expression_ids: ['help'], available_cards: cards } });
  const user = userEvent.setup(); render(<StrictMode><App /></StrictMode>);
  await screen.findByRole('navigation', { name: '주 메뉴' });
  await user.click(within(screen.getByRole('navigation', { name: '주 메뉴' })).getByRole('button', { name: /그림으로 말하기/ }));
  await screen.findByText(/기록 없이 말하기/);
  await user.click(screen.getByRole('button', { name: '물 문장에 담기', exact: true }));
  await user.click(screen.getByRole('button', { name: /선택 카드 그대로 말하기/ }));
  expect(player.speak).toHaveBeenCalled(); expect(request).not.toHaveBeenCalled();
});

test.each(['caregiver', 'support_staff'])('%s는 연결 아동 개인 카드 관리에서 사진을 일괄 등록한다', async role => {
  const original = request.getMockImplementation();
  const target = { id: 'bulk-child', name: '일괄 등록 아동', username: 'bulk-child', permissions: ['cards_manage'] };
  request.mockImplementation(async (path, options = {}) => {
    if (path === '/auth/me') return { ...account, role };
    if (path === '/care/linked-users') return [target];
    if (path.startsWith('/cards/submissions?')) return [];
    if (path === '/cards/submissions' && options.method === 'POST') return {
      id: 'bulk-saved', label: options.body.get('label'), category: options.body.get('category'),
      visibility: 'private', owner_id: target.id, status: 'approved',
    };
    return original(path, options);
  });
  const user = userEvent.setup();
  render(<StrictMode><App /></StrictMode>);
  await screen.findByText('서비스 연결됨');
  await user.click(within(screen.getByRole('navigation')).getByRole('button', { name: '개인 카드 관리', exact: true }));
  await user.click(screen.getByText('사진 일괄 등록', { selector: 'summary' }));
  const panel = within(screen.getByRole('region', { name: '사진 일괄 등록' }));
  await waitFor(() => expect(panel.getByLabelText('사진 여러 장 선택').disabled).toBe(false));
  await user.upload(panel.getByLabelText('사진 여러 장 선택'), new File(['synthetic'], '검증_연필.png', { type: 'image/png' }));
  await user.selectOptions(panel.getByLabelText('공통 카테고리'), '음식');
  await user.click(panel.getByRole('button', { name: '미등록 항목에 분류 적용' }));
  await user.click(panel.getByRole('button', { name: '등록 가능한 1개 저장' }));
  await waitFor(() => expect(screen.getByRole('heading', { name: '등록 카드' }).nextElementSibling.textContent).toContain('검증 연필'));
  const writes = request.mock.calls.filter(([, settings]) => settings?.method === 'POST');
  expect(writes).toHaveLength(1);
  expect(writes[0][1].body.get('user_id')).toBe(target.id);
  expect(writes[0][1].body.get('visibility')).toBe('private');
});

test('아동 전환 뒤 이전 개인 카드 조회가 늦게 끝나도 새 대상의 목록을 덮어쓰지 않는다', async () => {
  const original = request.getMockImplementation();
  const targets = ['a', 'b'].map(id => ({ id, username: id, name: `아동 ${id}`, permissions: ['cards_manage'] }));
  let finish;
  let delayCardRead = false;
  const old = new Promise(resolve => { finish = resolve; });
  const card = id => ({ id, label: `검증 ${id} 카드`, category: '음식', visibility: 'private', status: 'approved' });
  request.mockImplementation(async (path, options) => {
    if (path === '/auth/me') return { ...account, role: 'caregiver' };
    if (path === '/care/linked-users') return targets;
    if (path === '/cards/submissions?user_id=a') return delayCardRead ? old : [card('a')];
    if (path === '/cards/submissions?user_id=b') return [card('b')];
    return original(path, options);
  });
  const user = userEvent.setup();
  render(<StrictMode><App /></StrictMode>);
  await screen.findByText('서비스 연결됨');
  await act(async () => {});
  delayCardRead = true;
  await user.click(within(screen.getByRole('navigation')).getByRole('button', { name: '개인 카드 관리', exact: true }));
  await user.selectOptions(screen.getByLabelText('관리 사용자'), 'b');
  const list = within(screen.getByRole('heading', { name: '등록 카드' }).parentElement);
  await list.findByText('검증 b 카드');
  await act(async () => finish([card('a')]));
  expect(screen.queryByText('검증 a 카드')).toBeNull();
  expect(list.getByText('검증 b 카드')).toBeTruthy();
});

const selectedLabels = board => board.queryAllByRole('listitem').map(item => item.querySelector('span').textContent.trim());

test('재연결 이벤트의 동기화가 먼저 실패해도 늦게 끝난 화면 로딩으로 다시 전송하지 않는다', async () => {
  await openCommunication();
  await act(async () => {});
  synchronizer.sync.mockClear().mockResolvedValue({ cancelled: false, remaining: 2, failed: 2, syncedAttemptIds: [] });
  const original = request.getMockImplementation();
  let finish;
  const delayedCards = new Promise(resolve => { finish = resolve; });
  request.mockImplementation((path, options) => path === '/cards' ? delayedCards : original(path, options));
  act(() => window.dispatchEvent(new Event('online')));
  await screen.findByTestId('sync-status');
  expect(synchronizer.sync).toHaveBeenCalledTimes(1);
  await act(async () => finish(cards));
  expect(synchronizer.sync).toHaveBeenCalledTimes(1);
});

test('재연결 때 화면 API가 실패해도 저장 기록은 독립적으로 한 번 동기화한다', async () => {
  await openCommunication();
  await act(async () => {});
  synchronizer.sync.mockClear();
  const original = request.getMockImplementation();
  request.mockImplementation((path, options) => path === '/cards' ? Promise.reject(new Error('합성 화면 조회 실패')) : original(path, options));
  act(() => window.dispatchEvent(new Event('online')));
  expect((await screen.findByRole('alert')).textContent).toContain('합성 화면 조회 실패');
  expect(synchronizer.sync).toHaveBeenCalledTimes(1);
});

test.each([false, true])('서버가 지정한 책임자 여부 %s에 따라 운영 권한 관리 메뉴를 분리한다', async allowed => {
  const original = request.getMockImplementation();
  request.mockImplementation((path, options) => {
    if (path === '/auth/me') return Promise.resolve({ ...account, role: 'support_staff', can_manage_account_permissions: allowed });
    if (path === '/care/linked-users') return Promise.resolve([]);
    return original(path, options);
  });
  const user = userEvent.setup();
  render(<StrictMode><App /></StrictMode>);
  await screen.findByText('서비스 연결됨');
  const menu = screen.getByRole('navigation', { name: '주 메뉴' });
  const manage = within(menu).queryByRole('button', { name: '운영 권한 관리', exact: true });
  expect(Boolean(manage)).toBe(allowed);
  if (allowed) {
    await user.click(manage);
    expect(await screen.findByRole('heading', { name: '운영 권한 관리', exact: true })).toBeTruthy();
    expect(screen.getByLabelText('담당자 아이디')).toBeTruthy();
    const denied = new Event('pesc-mate:access-denied');
    denied.apiPath = '/admin/accounts/staff/content-permission';
    act(() => window.dispatchEvent(denied));
    expect(screen.getByRole('heading', { name: '운영 권한 관리', exact: true })).toBeTruthy();
  }
  expect(request.mock.calls.some(([path]) => path.startsWith('/admin/accounts/'))).toBe(false);
});

test('AAC 사용자 화면에는 운영 알림을 표시하거나 요청하지 않는다', async () => {
  await openCommunication();
  expect(screen.queryByRole('region', { name: '운영 알림' })).toBeNull();
  expect(request.mock.calls.some(([path]) => path === '/admin/alerts')).toBe(false);
});

async function openContentAdmin() {
  const original = request.getMockImplementation();
  const card = { id: 'review-card', label: '합성 공용 카드', meaning: '운영 재인증 검증', category: '사람',
    owner_id: 'synthetic-owner', visibility: 'shared', status: 'pending', created_at: '2026-10-19T00:00:00Z' };
  const category = { id: 'synthetic-category', name: '합성 분류', display_order: 1, active: true };
  request.mockImplementation((path, options = {}) => {
    if (path === '/auth/me') return Promise.resolve({ ...account, role: 'support_staff', account_permissions: ['content_manage'] });
    if (path === '/care/linked-users') return Promise.resolve([]);
    if (path === '/admin/alerts') return Promise.resolve({ status: 'ok', alerts: [], generated_at: '2026-10-19T00:00:00Z' });
    if (path === '/admin/card-submissions') return Promise.resolve([card]);
    if (path === '/admin/categories' && !options.method) return Promise.resolve([category]);
    if (path === '/admin/categories' && options.method === 'POST') return Promise.resolve({ ...category, id: 'new-category', name: '추가 분류' });
    if (path === '/admin/categories/synthetic-category') return Promise.resolve({ ...category, name: '변경 분류' });
    if (path === '/admin/card-submissions/review-card') return Promise.resolve({ ...card, status: 'approved' });
    return original(path, options);
  });
  const user = userEvent.setup();
  render(<StrictMode><App /></StrictMode>);
  await screen.findByText('서비스 연결됨');
  await screen.findByRole('heading', { name: '카드 승인 관리', exact: true });
  return user;
}

test('공용 카드 승인은 대상 확인과 본인 비밀번호 없이 전송하지 않고 취소 시 초안을 유지한다', async () => {
  const user = await openContentAdmin();
  fireEvent.change(screen.getByLabelText('합성 공용 카드 검토 사유'), { target: { value: '합성 검수 사유' } });
  await user.click(screen.getByRole('button', { name: '승인', exact: true }));
  expect(screen.getByRole('dialog').textContent).toContain('합성 공용 카드');
  expect(request.mock.calls.some(([path, options]) => options?.method === 'PATCH' && path.includes('card-submissions/'))).toBe(false);
  await user.click(screen.getByRole('button', { name: '취소' }));
  expect(screen.getByLabelText('합성 공용 카드 검토 사유').value).toBe('합성 검수 사유');
  await user.click(screen.getByRole('button', { name: '승인', exact: true }));
  expect(screen.getByLabelText('본인 비밀번호').value).toBe('');
  fireEvent.change(screen.getByLabelText('본인 비밀번호'), { target: { value: 'operator-verification' } });
  await user.click(screen.getByRole('button', { name: '확인 후 실행' }));
  const [, options] = request.mock.calls.find(([path]) => path === '/admin/card-submissions/review-card');
  expect(JSON.parse(options.body)).toEqual({ decision: 'approved', reason: '합성 검수 사유', password: 'operator-verification' });
  expect(screen.queryByLabelText('본인 비밀번호')).toBeNull();
});

test.each(['create', 'update'])('카테고리 %s도 변경 내용을 고정한 뒤 비밀번호와 함께 전송한다', async operation => {
  const user = await openContentAdmin();
  if (operation === 'create') {
    fireEvent.change(screen.getByPlaceholderText('예: 운동'), { target: { value: '추가 분류' } });
    await user.click(screen.getByRole('button', { name: '카테고리 추가', exact: true }));
  } else {
    const article = screen.getByDisplayValue('합성 분류').closest('article');
    fireEvent.change(within(article).getByLabelText('이름'), { target: { value: '변경 분류' } });
    await user.click(within(article).getByRole('button', { name: '수정 저장' }));
  }
  expect(screen.getByRole('dialog').textContent).toContain(operation === 'create' ? '추가 분류' : '변경 분류');
  fireEvent.change(screen.getByLabelText('본인 비밀번호'), { target: { value: 'category-verification' } });
  await user.click(screen.getByRole('button', { name: '확인 후 실행' }));
  const [, options] = request.mock.calls.find(([path, settings]) => path.startsWith('/admin/categories') && settings?.method);
  expect(JSON.parse(options.body)).toMatchObject({ password: 'category-verification', name: operation === 'create' ? '추가 분류' : '변경 분류' });
  expect(screen.queryByRole('dialog')).toBeNull();
});

test.each(['caregiver', 'support_staff'])('%s 인증 만료는 서버 로그아웃을 기다리지 않고 지원 화면을 닫는다', async role => {
  const original = request.getMockImplementation();
  request.mockImplementation((path, options) => {
    if (path === '/auth/me') return Promise.resolve({ ...account, role });
    if (path === '/care/linked-users') return Promise.resolve([]);
    return original(path, options);
  });
  render(<StrictMode><App /></StrictMode>);
  await screen.findByText('서비스 연결됨');
  act(() => window.dispatchEvent(new Event('pesc-mate:session-expired')));
  await waitFor(() => expect(screen.queryByRole('navigation', { name: '주 메뉴' })).toBeNull());
  expect(localStorage.getItem('pesc-mate-token')).toBeNull();
  expect(screen.getByRole('alert').textContent).toContain('다시 로그인');
  expect(request.mock.calls.some(([path]) => path === '/auth/logout')).toBe(false);
});

test('AAC 인증 만료 알림은 오프라인 의사소통 보드와 로컬 음성을 지우지 않는다', async () => {
  const { user, workspace, board } = await openCommunication();
  await user.click(workspace.getByRole('button', { name: '물 문장에 담기', exact: true }));
  act(() => window.dispatchEvent(new Event('pesc-mate:session-expired')));
  expect(selectedLabels(board)).toEqual(['💧 물']);
  expect(screen.getByRole('navigation', { name: '주 메뉴' })).toBeTruthy();
});

test.each(['success', 'unauthorized'])('만료 전 지원 조회의 늦은 %s 응답은 새 로그인 화면을 덮어쓰지 않는다', async outcome => {
  const original = request.getMockImplementation();
  let pending;
  let waiting = false;
  request.mockImplementation((path, options) => {
    if (path === '/auth/me') return Promise.resolve({ ...account, role: 'support_staff' });
    if (path === '/care/linked-users') { if (pending) waiting = true; return pending || Promise.resolve([]); }
    if (path === '/auth/login') return Promise.resolve({ user: account, access_token: 'new-child-session' });
    return original(path, options);
  });
  const user = userEvent.setup();
  render(<StrictMode><App /></StrictMode>);
  await screen.findByText('서비스 연결됨');
  await screen.findByRole('heading', { name: '담당자 지원 홈', exact: true });
  let finish;
  let fail;
  pending = new Promise((resolve, reject) => { finish = resolve; fail = reject; });
  act(() => window.dispatchEvent(new Event('online')));
  await waitFor(() => expect(waiting).toBe(true));
  act(() => window.dispatchEvent(new Event('pesc-mate:session-expired')));
  await screen.findByRole('heading', { name: '로그인', exact: true });
  fireEvent.change(screen.getByLabelText('아이디'), { target: { value: 'component-child' } });
  fireEvent.change(screen.getByLabelText('비밀번호'), { target: { value: 'synthetic-password' } });
  await user.click(screen.getByRole('button', { name: '로그인', exact: true }));
  await screen.findByText('서비스 연결됨');
  await act(async () => {
    if (outcome === 'unauthorized') fail(Object.assign(new Error('Old session expired'), { status: 401 }));
    else finish([{ id: 'old-child', name: '폐기할 이전 아동', permissions: [] }]);
  });
  expect(localStorage.getItem('pesc-mate-token')).toBe('new-child-session');
  expect(screen.getByRole('heading', { name: '오늘은 무엇을 해볼까요?', exact: true })).toBeTruthy();
  expect(screen.queryByText('폐기할 이전 아동')).toBeNull();
});

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

test('듣기는 독립된 기본 버튼이며 Space를 눌러도 카드를 선택하지 않는다', async () => {
  const { user, workspace, board } = await openCommunication();
  const select = workspace.getByRole('button', { name: '물 문장에 담기', exact: true });
  const listen = workspace.getByRole('button', { name: '물 단어 듣기', exact: true });
  expect(listen.tagName).toBe('BUTTON');
  expect(select.contains(listen)).toBe(false);
  expect(document.querySelector('button button, button [role="button"]')).toBeNull();
  select.focus();
  await user.tab();
  expect(document.activeElement).toBe(listen);
  await user.keyboard(' ');
  expect(player.speak).toHaveBeenCalledTimes(1);
  expect(player.speak.mock.calls[0][0].text).toBe('물');
  expect(selectedLabels(board)).toEqual([]);
  await user.tab({ shift: true });
  expect(document.activeElement).toBe(select);
  await user.keyboard(' ');
  expect(selectedLabels(board)).toEqual(['💧 물']);
});

test('중복 카드도 이동·삭제 후 포커스가 이어지고 마지막 삭제는 문장 제목으로 돌아간다', async () => {
  const { user, workspace, board } = await openCommunication();
  const water = workspace.getByRole('button', { name: '물 문장에 담기', exact: true });
  await user.click(water);
  await user.click(water);
  await user.click(workspace.getByRole('button', { name: '나 문장에 담기', exact: true }));
  board.getByRole('button', { name: '3번째 카드 앞으로' }).focus();
  await user.keyboard('{Enter}');
  expect(selectedLabels(board)).toEqual(['💧 물', '🙋 나', '💧 물']);
  expect(document.activeElement).toBe(board.getByRole('button', { name: '2번째 카드 앞으로' }));
  await user.keyboard('{Enter}');
  expect(selectedLabels(board)).toEqual(['🙋 나', '💧 물', '💧 물']);
  expect(document.activeElement).toBe(board.getByRole('button', { name: '1번째 카드 뒤로' }));
  board.getByRole('button', { name: '3번째 카드 삭제' }).focus();
  await user.keyboard('{Enter}');
  expect(document.activeElement).toBe(board.getByRole('button', { name: '2번째 카드 삭제' }));
  await user.keyboard('{Enter}');
  expect(document.activeElement).toBe(board.getByRole('button', { name: '1번째 카드 삭제' }));
  await user.keyboard('{Enter}');
  expect(selectedLabels(board)).toEqual([]);
  expect(document.activeElement).toBe(board.getByRole('heading', { name: /나의 문장/ }));
  expect(localStorage.getItem(`pesc-mate-board:${account.id}`)).toBeNull();
});

test('전체 비우기를 취소하면 선택과 포커스를 유지하고 확인하면 제목으로 돌아간다', async () => {
  const { user, workspace, board } = await openCommunication();
  const card = workspace.getByRole('button', { name: '물 문장에 담기', exact: true });
  await user.click(card);
  expect(document.activeElement).toBe(card);
  const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
  const clear = board.getByRole('button', { name: '비우기' });
  clear.focus();
  await user.keyboard('{Enter}');
  expect(selectedLabels(board)).toEqual(['💧 물']);
  expect(document.activeElement).toBe(clear);
  await user.keyboard('{Enter}');
  expect(selectedLabels(board)).toEqual([]);
  expect(document.activeElement).toBe(board.getByRole('heading', { name: /나의 문장/ }));
  expect(confirm).toHaveBeenCalledTimes(2);
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

test('선택 시각·순서와 직접 지정한 상황을 기록하되 카드 위치를 바꾸지 않는다', async () => {
  const { user, workspace, board } = await openCommunication();
  await user.selectOptions(screen.getByLabelText('기록 상황 (선택)'), 'school');
  await user.click(workspace.getByRole('button', { name: '물 문장에 담기', exact: true }));
  await user.click(workspace.getByRole('button', { name: '나 문장에 담기', exact: true }));
  await user.click(board.getByRole('button', { name: '2번째 카드 앞으로' }));
  const events = request.mock.calls.filter(([path]) => path === '/offline/events/sync')
    .flatMap(([, options]) => JSON.parse(options.body).events);
  expect(events.map(event => event.card_ids)).toEqual([['water'], ['water', 'me'], ['me', 'water']]);
  expect(events.every(event => event.situation === 'school' && event.event_type === 'card_selection')).toBe(true);
  expect(events.map(event => event.sequence)).toEqual([1, 2, 3]);
  expect(new Date(events[0].occurred_at).toISOString()).toBe(events[0].occurred_at);
  expect(selectedLabels(board)).toEqual(['🙋 나', '💧 물']);
});

test('음성 완료·복구 표현 결과를 원문 없이 기록하고 중복 종료 콜백은 무시한다', async () => {
  await openCommunication();
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: '도와주세요 바로 말하기', exact: true }));
  const first = player.speak.mock.calls.at(-1)[0];
  await act(async () => { first.onEnd(); first.onEnd(); });
  await user.click(screen.getByRole('button', { name: '잘못 눌렀어요 복구 표현 말하기' }));
  await act(async () => player.speak.mock.calls.at(-1)[0].onEnd());
  const events = request.mock.calls.filter(([path]) => path === '/offline/events/sync')
    .flatMap(([, options]) => JSON.parse(options.body).events);
  expect(events).toHaveLength(2);
  expect(events[0]).toMatchObject({ event_type: 'speech_result', card_ids: ['help'], speech_status: 'succeeded' });
  expect(events[1]).toMatchObject({ event_type: 'recovery_speech', recovery_id: 'wrong_tap', speech_status: 'succeeded' });
  expect(events.every(event => !('content' in event) && !('sentence' in event))).toBe(true);
});
