import { StrictMode } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import App from '../../src/App.jsx';
import { request } from '../../src/services/api';
import { cacheLearningState, cacheSnapshot } from '../../src/services/offlineStore';

vi.mock('../../src/services/api', async original => ({
  ...await original(), request: vi.fn(),
}));
vi.mock('../../src/services/offlineStore', async original => Object.fromEntries(
  Object.keys(await original()).map(name => [name, vi.fn(async () => null)]),
));

const staff = { id: 'synthetic-staff', role: 'support_staff', name: '합성 담당자', profile: { kind: 'preset', preset: 'pink' } };
const allPermissions = ['records_read', 'learning_manage'];
const child = (id, permissions = allPermissions) => ({ id, username: id, name: id, permissions });
const dashboard = (sentence = '합성 문장') => ({
  sessions: 2, selections: 3, today_sessions: 2, today_selections: 3, categories: {},
  daily_activity: [], recent_safety_expressions: [], top_cards: [],
  recent: [{ id: sentence, sentence, cards: [], created_at: '2026-10-20T00:00:00Z' }],
});
const learning = { attempts: 4, familiar_words: [], repeat_words: [], last_completed_at: null };
const settings = { category_ids: ['food'], question_count: 5, option_count: 3,
  repeat_frequency: 1, time_limit_seconds: 60, retry_enabled: true };
let people;

beforeEach(() => {
  people = [child('합성-아동-A'), child('합성-아동-B')];
  localStorage.setItem('pesc-mate-token', 'synthetic-record-session');
  request.mockReset().mockImplementation(async path => {
    if (path === '/auth/me') return staff;
    if (path === '/care/linked-users') return people;
    if (path === '/categories') return [{ id: 'food', name: '음식' }];
    if (path.startsWith('/dashboard?')) return dashboard();
    if (path.startsWith('/learning/settings?')) return settings;
    if (path.startsWith('/learning/progress?')) return learning;
    throw new Error(`Unexpected API path: ${path}`);
  });
});

async function openRecords(name = '의사소통 기록') {
  const user = userEvent.setup();
  render(<StrictMode><App /></StrictMode>);
  await screen.findByText('서비스 연결됨');
  const menu = screen.getByRole('navigation', { name: '주 메뉴' });
  await user.click(within(menu).getByRole('button', { name, exact: true }));
  await screen.findByRole('tabpanel', { name, hidden: false });
  return user;
}

const reads = () => request.mock.calls.filter(([path]) => /^\/(dashboard|learning)\b/.test(path));
const panel = name => within(screen.getByRole('tabpanel', { name, hidden: false }));

test.each(['caregiver', 'support_staff'])('%s 기록 탭은 목적과 지표를 분리하고 선택한 영역만 조회한다', async role => {
  const original = request.getMockImplementation();
  request.mockImplementation((path, options) => path === '/auth/me'
    ? Promise.resolve({ ...staff, role }) : original(path, options));
  const user = await openRecords();
  expect(panel('의사소통 기록').getByText(/저장한 문장과 그 문장에 포함된 카드만/)).toBeTruthy();
  expect(panel('의사소통 기록').getByText('합성 문장')).toBeTruthy();
  expect(screen.getByRole('tab', { name: '의사소통 기록' }).getAttribute('aria-selected')).toBe('true');
  expect(reads().map(([path]) => path)).toEqual([`/dashboard?user_id=${encodeURIComponent(people[0].id)}`]);

  await user.click(screen.getByRole('tab', { name: '학습 기록' }));
  expect(await panel('학습 기록').findByRole('heading', { name: '최근 30일 학습 흐름' })).toBeTruthy();
  expect(panel('학습 기록').getByText(/의사소통 능력의 평가나 진단이 아닙니다/)).toBeTruthy();
  expect(screen.queryByText('합성 문장')).toBeNull();
  expect(reads().map(([path]) => path)).toEqual([
    `/dashboard?user_id=${encodeURIComponent(people[0].id)}`,
    `/learning/settings?user_id=${encodeURIComponent(people[0].id)}`,
    `/learning/progress?user_id=${encodeURIComponent(people[0].id)}&days=30`,
  ]);
  expect(cacheLearningState).not.toHaveBeenCalled();
  expect(cacheSnapshot).not.toHaveBeenCalled();
});

test.each([
  ['records_read', '의사소통 기록', '학습 기록', '/learning'],
  ['learning_manage', '학습 기록', '의사소통 기록', '/dashboard'],
])('%s만 있으면 다른 영역을 열거나 조회하지 않는다', async (permission, allowed, denied, blockedPath) => {
  people = [child('합성-제한-아동', [permission])];
  const user = await openRecords(allowed);
  const disabled = screen.getByRole('tab', { name: `${denied}조회 권한 없음` });
  expect(disabled.disabled).toBe(true);
  await user.click(disabled);
  expect(reads().some(([path]) => path.startsWith(blockedPath))).toBe(false);
  expect(within(screen.getByRole('navigation', { name: '주 메뉴' })).queryByRole('button', { name: denied, exact: true })).toBeNull();
  const active = screen.getByRole('tab', { name: allowed, exact: true });
  active.focus();
  await user.keyboard('{ArrowRight}{End}{Home}');
  expect(document.activeElement).toBe(active);
});

test('기록 탭은 방향키와 Home·End로 전환하고 활성 패널과 연결된다', async () => {
  const user = await openRecords();
  const communication = screen.getByRole('tab', { name: '의사소통 기록' });
  communication.focus();
  await user.keyboard('{ArrowRight}');
  const learningTab = screen.getByRole('tab', { name: '학습 기록' });
  expect(document.activeElement).toBe(learningTab);
  expect(learningTab.getAttribute('aria-selected')).toBe('true');
  expect(screen.getByRole('tabpanel', { name: '학습 기록' }).id).toBe(learningTab.getAttribute('aria-controls'));
  await user.keyboard('{Home}');
  expect(document.activeElement).toBe(communication);
  await user.keyboard('{End}{ArrowLeft}');
  expect(document.activeElement).toBe(communication);
  expect(communication.getAttribute('aria-selected')).toBe('true');
});

test('같은 사용자의 미저장 메모는 탭 이동 시 유지하고 다른 사용자로 바꾸면 비운다', async () => {
  people = people.map(person => ({ ...person, permissions: [...allPermissions, 'notes_write'] }));
  const user = await openRecords();
  fireEvent.change(await screen.findByLabelText('합성 문장 지원 메모'), { target: { value: '합성 메모 초안' } });
  await user.click(screen.getByRole('tab', { name: '학습 기록' }));
  await user.click(screen.getByRole('tab', { name: '의사소통 기록' }));
  expect((await screen.findByLabelText('합성 문장 지원 메모')).value).toBe('합성 메모 초안');
  await user.selectOptions(screen.getByLabelText('조회 사용자'), people[1].id);
  expect((await screen.findByLabelText('합성 문장 지원 메모')).value).toBe('');
});

test.each(['의사소통 기록', '학습 기록'])('%s에서 사용자 변경 후 늦은 이전 응답은 새 사용자 기록을 덮어쓰지 않는다', async domain => {
  const user = await openRecords(domain);
  const original = request.getMockImplementation();
  let finish;
  const delayed = new Promise(resolve => { finish = resolve; });
  const prefix = domain === '의사소통 기록' ? '/dashboard?' : '/learning/progress?';
  request.mockImplementation((path, options) => path.startsWith(prefix) && path.includes(encodeURIComponent(people[1].id))
    ? delayed : original(path, options));
  // Start B's read, return to A, then let B finish last.
  fireEvent.change(screen.getByLabelText('조회 사용자'), { target: { value: people[1].id } });
  expect(screen.queryByText('합성 문장')).toBeNull();
  fireEvent.change(screen.getByLabelText('조회 사용자'), { target: { value: people[0].id } });
  if (domain === '의사소통 기록') await panel(domain).findByText('합성 문장');
  else await panel(domain).findByRole('heading', { name: '최근 30일 학습 흐름' });
  await act(async () => finish(domain === '의사소통 기록' ? dashboard('표시되면 안 되는 B의 문장') : { ...learning, attempts: 999 }));
  expect(screen.getByLabelText('조회 사용자').value).toBe(people[0].id);
  expect(screen.queryByText('표시되면 안 되는 B의 문장')).toBeNull();
  expect(screen.queryByText('999')).toBeNull();
});

test('이전 영역의 늦은 조회 실패는 현재 영역의 지표와 오류 상태에 영향을 주지 않는다', async () => {
  const user = await openRecords();
  const original = request.getMockImplementation();
  let fail;
  request.mockImplementation((path, options) => path.includes('days=7')
    ? new Promise((_resolve, reject) => { fail = reject; }) : original(path, options));
  await user.click(screen.getByRole('button', { name: '최근 7일', exact: true }));
  await user.click(screen.getByRole('tab', { name: '학습 기록' }));
  await panel('학습 기록').findByRole('heading', { name: '최근 30일 학습 흐름' });
  await act(async () => fail(new Error('표시되면 안 되는 이전 오류')));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.queryByText('표시되면 안 되는 이전 오류')).toBeNull();
  expect(screen.getByRole('tab', { name: '학습 기록' }).getAttribute('aria-selected')).toBe('true');
});

test.each(['offline', 'denied', 'expired'])('%s로 기록을 닫은 뒤 도착한 응답을 표시하거나 캐시하지 않는다', async reason => {
  const user = await openRecords();
  const original = request.getMockImplementation();
  let finish;
  request.mockImplementation((path, options) => path.startsWith('/learning/progress?')
    ? new Promise(resolve => { finish = resolve; }) : original(path, options));
  await user.click(screen.getByRole('tab', { name: '학습 기록' }));
  act(() => window.dispatchEvent(new Event(reason === 'offline' ? 'offline'
    : reason === 'denied' ? 'pesc-mate:access-denied' : 'pesc-mate:session-expired')));
  await act(async () => finish({ ...learning, attempts: 999 }));
  expect(screen.queryByText('999')).toBeNull();
  expect(screen.queryByRole('tabpanel', { name: '학습 기록' })).toBeNull();
  expect(cacheLearningState).not.toHaveBeenCalled();
  expect(cacheSnapshot).not.toHaveBeenCalled();
});

test('학습 조회 실패는 이전 지표를 0회로 바꿔 보여주지 않고 의사소통으로 이동할 수 있다', async () => {
  const user = await openRecords();
  const original = request.getMockImplementation();
  request.mockImplementation((path, options) => path.startsWith('/learning/progress?')
    ? Promise.reject(new Error('합성 학습 조회 실패')) : original(path, options));
  await user.click(screen.getByRole('tab', { name: '학습 기록' }));
  expect((await screen.findByRole('alert')).textContent).toContain('합성 학습 조회 실패');
  expect(screen.queryByRole('heading', { name: '최근 30일 학습 흐름' })).toBeNull();
  await user.click(screen.getByRole('tab', { name: '의사소통 기록' }));
  expect(await panel('의사소통 기록').findByText('합성 문장')).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
});
