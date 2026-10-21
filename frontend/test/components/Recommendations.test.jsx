import { useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import RecommendationsPanel from '../../src/RecommendationsPanel.jsx';
import RecommendationSettings from '../../src/RecommendationSettings.jsx';
import { request } from '../../src/services/api';

vi.mock('../../src/services/api', async original => ({ ...await original(), request: vi.fn() }));
const card = { id: 'water', label: '물', category: '음식', reason: '최근 저장한 문장에 포함', algorithm_version: 'aac-candidates-v1' };
const feed = { batch_id: 'synthetic-batch', cards: [card], enabled: true, mode: 'automatic', algorithm_version: 'aac-candidates-v1' };
const settings = { enabled: true, mode: 'automatic', approved_card_ids: [], hidden_card_ids: [],
  situation: 'unspecified', use_time_of_day: true, revision: 0, available_cards: [card], history: [] };
const tile = (item, selected) => <button onClick={selected}>{item.label}<small>{item.reason}</small></button>;
const props = () => ({ accountId: 'child-a', selectedIds: [], cards: [card], offline: false, renderCard: tile, onCards: vi.fn(), onOpenLibrary: vi.fn() });
const flush = async () => act(async () => { await vi.advanceTimersByTimeAsync(160); });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const calls = suffix => request.mock.calls.filter(([path]) => path.endsWith(suffix));
let observers;

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.setItem('pesc-mate-token', 'synthetic-session');
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  observers = [];
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback) { this.callback = callback; this.nodes = []; this.disconnect = vi.fn(); observers.push(this); }
    observe(node) { this.nodes.push(node); }
  });
  request.mockReset().mockImplementation(async path => {
    if (path === '/recommendations/feed') return feed;
    if (path.startsWith('/recommendations/settings?')) return settings;
    return { recorded: true };
  });
});
afterEach(() => { vi.useRealTimers(); });

test('후보 조회는 노출이 아니며 보이는 후보만 관찰자에서 중복 없이 기록한다', async () => {
  const input = props();
  render(<RecommendationsPanel {...input} />);
  await flush();
  expect(input.onCards).toHaveBeenLastCalledWith(feed.cards);
  expect(screen.getByText(card.reason)).toBeTruthy();
  expect(calls('/exposures')).toHaveLength(0);
  const observer = observers.at(-1);
  await act(async () => observer.callback([{ target: observer.nodes[0], isIntersecting: false, intersectionRatio: 0 }]));
  await act(async () => observer.callback([{ target: observer.nodes[0], isIntersecting: true, intersectionRatio: 0.05 }]));
  expect(calls('/exposures')).toHaveLength(0);
  await act(async () => observer.callback([{ target: observer.nodes[0], isIntersecting: true, intersectionRatio: 1 }]));
  await act(async () => observer.callback([{ target: observer.nodes[0], isIntersecting: true, intersectionRatio: 1 }]));
  expect(calls('/exposures')).toHaveLength(1);
  expect(JSON.parse(calls('/exposures')[0][1].body)).toEqual({ card_ids: ['water'] });
  fireEvent.click(screen.getByRole('button', { name: '전체 카드에서 고르기' }));
  expect(input.onOpenLibrary).toHaveBeenCalledOnce();
});

test('숨겨진 문서나 화면 밖 후보는 노출로 기록하지 않는다', async () => {
  render(<RecommendationsPanel {...props()} />);
  await flush();
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  const observer = observers.at(-1);
  await act(async () => observer.callback([{ target: observer.nodes[0], isIntersecting: true, intersectionRatio: 1 }]));
  expect(calls('/exposures')).toHaveLength(0);
});

test('카드를 즉시 추가해 후보가 갱신되어도 실제 클릭의 노출 확인 뒤 선택을 기록한다', async () => {
  const exposure = deferred();
  request.mockImplementation(path => path.endsWith('/exposures') ? exposure.promise : Promise.resolve(feed));
  function Harness() {
    const [ids, setIds] = useState([]);
    return <><output aria-label="선택 수">{ids.length}</output><RecommendationsPanel {...props()} selectedIds={ids}
      renderCard={(item, selected) => <button onClick={() => { selected(); setIds([item.id]); }}>{item.label}</button>} /></>;
  }
  render(<Harness />);
  await flush();
  fireEvent.click(screen.getByRole('button', { name: '물', exact: true }));
  expect(screen.getByLabelText('선택 수').textContent).toBe('1');
  expect(calls('/selections')).toHaveLength(0);
  await act(async () => exposure.resolve({ recorded: true }));
  expect(calls('/selections')).toHaveLength(1);
  expect(JSON.parse(calls('/selections')[0][1].body)).toEqual({ card_id: 'water' });
});

test.each(['session', 'offline', 'unmount'])('%s 전환 후 늦은 노출 확인으로 다른 세션의 선택을 기록하지 않는다', async transition => {
  const exposure = deferred();
  request.mockImplementation(path => path.endsWith('/exposures') ? exposure.promise : Promise.resolve(feed));
  const input = props();
  const view = render(<RecommendationsPanel {...input} />);
  await flush();
  fireEvent.click(screen.getByRole('button', { name: /물/ }));
  if (transition === 'session') localStorage.setItem('pesc-mate-token', 'different-session');
  if (transition === 'offline') view.rerender(<RecommendationsPanel {...input} offline />);
  if (transition === 'unmount') view.unmount();
  await act(async () => exposure.resolve({ recorded: true }));
  expect(calls('/selections')).toHaveLength(0);
});

test('지연된 이전 선택·계정 응답을 버리고 오프라인에서는 후보를 숨긴다', async () => {
  const delayed = deferred();
  request.mockReturnValueOnce(delayed.promise);
  const input = props();
  const view = render(<RecommendationsPanel {...input} />);
  await flush();
  view.rerender(<RecommendationsPanel {...input} accountId="child-b" selectedIds={['water']} offline />);
  await act(async () => delayed.resolve(feed));
  expect(screen.queryByRole('button', { name: /물/ })).toBeNull();
  expect(screen.getByText(/오프라인에서는 저장된 추천 대신/)).toBeTruthy();
  expect(input.onCards).toHaveBeenLastCalledWith([]);
  await flush();
  expect(calls('/feed')).toHaveLength(1);
});

test('추천 실패는 후보 영역에서만 안내하고 재시도할 수 있다', async () => {
  request.mockRejectedValueOnce(new Error('synthetic outage'));
  render(<RecommendationsPanel {...props()} />);
  await flush();
  expect(screen.getByText(/전체 카드에서 계속 선택할 수 있어요/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '추천 다시 불러오기' }));
  await flush();
  expect(screen.getByRole('button', { name: /물/ })).toBeTruthy();
});

test.each([
  [{ ...feed, cards: [], enabled: false }, /추천을 껐습니다/],
  [{ ...feed, cards: [], mode: 'approval' }, /현재 설정에 맞는 추천 후보가 없습니다/],
])('추천 꺼짐·승인 목록 비어 있음은 전체 카드 링크를 유지한다', async (result, message) => {
  request.mockResolvedValue(result);
  render(<RecommendationsPanel {...props()} />);
  await flush();
  expect(screen.getByText(message)).toBeTruthy();
  expect(screen.getByRole('button', { name: '전체 카드에서 고르기' })).toBeTruthy();
  expect(calls('/exposures')).toHaveLength(0);
});

test('설정 변경으로 노출 확인이 거절되면 선택을 보내지 않고 새 정책으로 갱신한다', async () => {
  request.mockImplementation(path => path.endsWith('/exposures')
    ? Promise.reject(Object.assign(new Error('policy changed'), { status: 409 })) : Promise.resolve(feed));
  render(<RecommendationsPanel {...props()} />);
  await flush();
  await act(async () => fireEvent.click(screen.getByRole('button', { name: /물/ })));
  await flush();
  expect(calls('/selections')).toHaveLength(0);
  expect(calls('/feed')).toHaveLength(2);
});

test('시간·선택 맥락을 제한된 본문으로 전송하고 포커스와 주기 갱신을 지원한다', async () => {
  render(<RecommendationsPanel {...props()} selectedIds={['help']} />);
  await flush();
  const body = JSON.parse(calls('/feed')[0][1].body);
  expect(body.selected_card_ids).toEqual(['help']);
  expect(body.hour).toBe(new Date().getHours());
  expect(body.utc_offset_minutes).toBe(new Date().getTimezoneOffset());
  expect(Object.keys(body).sort()).toEqual(['hour', 'request_id', 'selected_card_ids', 'utc_offset_minutes']);
  act(() => window.dispatchEvent(new Event('focus')));
  await flush();
  expect(calls('/feed')).toHaveLength(2);
  await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
  await flush();
  expect(calls('/feed')).toHaveLength(3);
});

test('보호자 설정은 대상·기대 버전을 전송하고 카드판 변경 없이 저장한다', async () => {
  request.mockImplementation(async (path, options) => options?.method === 'PUT' ? { ...settings, revision: 1 } : settings);
  render(<RecommendationSettings targetId="child 한글" />);
  await act(async () => {});
  fireEvent.change(screen.getByLabelText('추천 허용 방식'), { target: { value: 'approval' } });
  fireEvent.click(screen.getByLabelText('물 추천 승인'));
  fireEvent.click(screen.getByRole('button', { name: '추천 설정 저장' }));
  await act(async () => {});
  const saved = request.mock.calls.find(([, options]) => options?.method === 'PUT');
  expect(saved[0]).toBe(`/recommendations/settings?user_id=${encodeURIComponent('child 한글')}`);
  expect(JSON.parse(saved[1].body)).toEqual({ enabled: true, mode: 'approval', approved_card_ids: ['water'],
    hidden_card_ids: [], situation: 'unspecified', use_time_of_day: true, expected_revision: 0 });
  expect(screen.getByText(/고정 카드판은 바꾸지 않았습니다/)).toBeTruthy();
  expect(request.mock.calls.some(([path]) => path.includes('/board/'))).toBe(false);
});

test('설정 충돌은 초안을 유지하며 확인한 경우에만 최신 설정으로 교체한다', async () => {
  request.mockImplementation((path, options) => options?.method === 'PUT'
    ? Promise.reject(Object.assign(new Error('다른 기기에서 변경했습니다.'), { status: 409 })) : Promise.resolve(settings));
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  render(<RecommendationSettings targetId="child-a" />);
  await act(async () => {});
  fireEvent.click(screen.getByLabelText('물 추천 숨김'));
  fireEvent.click(screen.getByRole('button', { name: '추천 설정 저장' }));
  await act(async () => {});
  expect(screen.getByRole('alert').textContent).toContain('초안은 자동으로 덮어쓰지 않습니다');
  expect(screen.getByLabelText('물 추천 숨김').checked).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '최신 추천 설정 불러오기' }));
  expect(confirm).toHaveBeenCalledOnce();
  expect(screen.getByLabelText('물 추천 숨김').checked).toBe(true);
  confirm.mockReturnValue(true);
  fireEvent.click(screen.getByRole('button', { name: '최신 추천 설정 불러오기' }));
  await act(async () => {});
  expect(screen.getByLabelText('물 추천 숨김').checked).toBe(false);
});

test('설정 대상 전환 후 늦은 응답을 표시하지 않는다', async () => {
  const delayed = deferred();
  request.mockReturnValueOnce(delayed.promise).mockResolvedValue({ ...settings, available_cards: [{ ...card, label: '다른 사용자 카드' }] });
  const view = render(<RecommendationSettings targetId="child-a" />);
  view.rerender(<RecommendationSettings targetId="child-b" />);
  await act(async () => delayed.resolve(settings));
  expect(screen.queryByLabelText('물 추천 승인')).toBeNull();
  expect(screen.getByLabelText('다른 사용자 카드 추천 승인')).toBeTruthy();
});

test('보드 관리만으로 사용 기록을 조회하지 않으며 별도 권한으로 반복 노출을 점검한다', async () => {
  const view = render(<RecommendationSettings targetId="child-a" />);
  await act(async () => {});
  expect(screen.queryByRole('button', { name: '추천 반복 노출 점검' })).toBeNull();
  expect(request.mock.calls.some(([path]) => path.includes('monitoring'))).toBe(false);
  request.mockImplementation(async path => path.includes('monitoring') ? {
    limit: 50, sampled_batches: 3, algorithm_versions: ['aac-candidates-v1'], categories: { 음식: 3 },
    repeated_card_ids: ['water'], cards: [{ id: 'water', exposed_batches: 3, selected_batches: 1 }],
    notice: '미선택은 거절이나 지원 불필요를 뜻하지 않습니다.',
  } : settings);
  view.rerender(<RecommendationSettings targetId="child-a" canReadRecords />);
  fireEvent.click(screen.getByRole('button', { name: '추천 반복 노출 점검' }));
  await act(async () => {});
  expect(screen.getByText(/최근 3회 연속 표시된 카드: 물/)).toBeTruthy();
  expect(screen.getByText(/미선택은 거절이나 지원 불필요/)).toBeTruthy();
});
