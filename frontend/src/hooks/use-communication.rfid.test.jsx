import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { request } from '../services/api';
vi.mock('../services/api', () => ({ request: vi.fn() }));
beforeEach(() => {
  request.mockImplementation(async path => path === '/sentences' ? { id: 'generated', sentence: '물을 마시고 싶어요.' } : {});
});

import useCommunication, { useCommunicationState } from './use-communication';

function harness(overrides = {}) {
  const user = { id: 'synthetic', role: 'user' };
  const dependencies = {
    user, activeUserRef: { current: user }, privacy: { guardian_consent: false },
    offline: false, loaded: true, tab: 'home', myPageOpen: false, busy: false,
    compactSidebar: false, sidebarCollapsed: false, speechState: { status: 'idle' },
    setError: vi.fn(), stopSpeech: vi.fn(async () => {}), setSpeechFailure: vi.fn(),
    setTab: vi.fn(), speakText: vi.fn(), speakBoardSentence: vi.fn(), speechPlayback: { unlock: vi.fn() },
    speechRunRef: { current: 0 }, dashboardPath: () => '/dashboard', setStats: vi.fn(), ...overrides,
  };
  const hook = renderHook(() => {
    const state = useCommunicationState();
    return { state, controls: useCommunication({ ...state, ...dependencies }) };
  });
  return { ...hook, ...dependencies };
}
const water = { id: 'water', label: '물' }, drink = { id: 'drink', label: '마시다' };
it('only updates the board for one tag and preserves its detection timestamp', () => {
  const h = harness();
  act(() => h.result.current.controls.appendRfidSelection([{ ...water, selected_at: '2026-01-01T00:00:00Z' }]));
  expect(h.result.current.state.board).toEqual([{ ...water, selected_at: '2026-01-01T00:00:00Z' }]);
  expect(h.speakText).not.toHaveBeenCalled();
});
it('speaks the complete next board once without using the previous render selection', () => {
  const h = harness();
  act(() => h.result.current.state.setBoard([{ id: 'me', label: '나' }]));
  act(() => h.result.current.controls.appendRfidSelection([water, drink], { autoSpeak: true }));
  expect(h.result.current.state.board.map(c => c.id)).toEqual(['me', 'water', 'drink']);
  expect(h.speakText).toHaveBeenCalledExactlyOnceWith('나 물 마시다', 'sentence', ['me', 'water', 'drink'], '', { freshSelection: true });
  expect(h.result.current.state.rfidBoardRevisionRef.current).toBe(0);
  expect(h.setTab).toHaveBeenCalledWith('cards');
});
it('invalidates queued RFID after a manual board edit but not an RFID append', () => {
  const h = harness();
  act(() => h.result.current.controls.updateBoard([water]));
  expect(h.result.current.state.rfidBoardRevisionRef.current).toBe(1);
  act(() => h.result.current.controls.appendRfidSelection([drink]));
  expect(h.result.current.state.rfidBoardRevisionRef.current).toBe(1);
});
it('does not partially append or auto speak when the board would exceed twelve cards', () => {
  const h = harness();
  act(() => h.result.current.state.setBoard(Array(11).fill(water)));
  let accepted;
  act(() => { accepted = h.result.current.controls.appendRfidSelection([water, drink], { autoSpeak: true }); });
  expect(accepted).toBe(false); expect(h.result.current.state.board).toHaveLength(11);
  expect(h.speakText).not.toHaveBeenCalled(); expect(h.setError).toHaveBeenCalled();
});
it.each([{ myPageOpen: true }, { offline: true }, { speechState: { status: 'playing' } }, { tab: 'practice' }])(
  'does not append or speak outside the active communication context: %o', overrides => {
    const h = harness(overrides);
    let accepted;
    act(() => { accepted = h.result.current.controls.appendRfidSelection([water, drink], { autoSpeak: true }); });
    expect(accepted).toBe(false); expect(h.result.current.state.board).toEqual([]);
    expect(h.speakText).not.toHaveBeenCalled();
  },
);

it('generates an AI sentence for the committed RFID board before speaking', async () => {
  localStorage.setItem('pesc-mate-token', 'synthetic-token');
  let finish;
  request.mockImplementation(path => path === '/sentences' ? new Promise(resolve => { finish = resolve; }) : Promise.resolve({}));
  const h = harness({ privacy: { guardian_consent: true } });
  act(() => h.result.current.controls.appendRfidSelection([water, drink], { autoSpeak: true }));
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  expect(h.speakText).not.toHaveBeenCalled(); expect(h.speakBoardSentence).not.toHaveBeenCalled();
  const options = request.mock.calls.find(([path]) => path === '/sentences')[1];
  expect(JSON.parse(options.body).cards).toEqual(['water', 'drink']);
  expect(JSON.parse(options.body).selected_at).toHaveLength(2);
  await act(async () => finish({ id: 'synthetic-session', sentence: '물을 마시고 싶어요.' }));
  expect(h.speakBoardSentence).toHaveBeenCalledExactlyOnceWith('물을 마시고 싶어요.', 'synthetic-session');
  expect(h.result.current.state.text).toBe('물을 마시고 싶어요.');
});
it('does not speak a late AI result after manual editing or logout', async () => {
  localStorage.setItem('pesc-mate-token', 'synthetic-token');
  let finish;
  request.mockImplementation(path => path === '/sentences' ? new Promise(resolve => { finish = resolve; }) : Promise.resolve({}));
  const h = harness({ privacy: { guardian_consent: true } });
  act(() => h.result.current.controls.appendRfidSelection([water, drink], { autoSpeak: true }));
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  act(() => h.result.current.controls.updateBoard([drink]));
  localStorage.removeItem('pesc-mate-token');
  await act(async () => finish({ id: 'old', sentence: '물을 마시고 싶어요.' }));
  expect(h.speakBoardSentence).not.toHaveBeenCalled(); expect(h.speakText).not.toHaveBeenCalled();
  expect(h.result.current.state.board.map(card => card.id)).toEqual(['drink']);
});
it('keeps basic speech available if automatic AI generation fails', async () => {
  localStorage.setItem('pesc-mate-token', 'synthetic-token');
  request.mockImplementation(path => path === '/sentences' ? Promise.reject(new Error('synthetic network failure')) : Promise.resolve({}));
  const h = harness({ privacy: { guardian_consent: true } });
  await act(async () => h.result.current.controls.appendRfidSelection([water, drink], { autoSpeak: true }));
  await waitFor(() => expect(h.speakText).toHaveBeenCalledExactlyOnceWith('물 마시다', 'sentence', ['water', 'drink'], '', { freshSelection: true }));
  expect(h.result.current.state.board.map(card => card.id)).toEqual(['water', 'drink']);
});
it('waits for a superseded inference to finish then generates only the latest queued board', async () => {
  localStorage.setItem('pesc-mate-token', 'synthetic-token');
  const completions = [];
  request.mockImplementation(path => path === '/sentences'
    ? new Promise(resolve => completions.push(resolve)) : Promise.resolve({}));
  const h = harness({ privacy: { guardian_consent: true } });
  act(() => h.result.current.controls.appendRfidSelection([water, drink], { autoSpeak: true }));
  await waitFor(() => expect(completions).toHaveLength(1));
  act(() => h.result.current.controls.appendRfidSelection([{ id: 'me', label: '나' }], { autoSpeak: true }));
  expect(completions).toHaveLength(1);
  await act(async () => completions[0]({ id: 'old', sentence: '물을 마셔요.' }));
  await waitFor(() => expect(completions).toHaveLength(2));
  expect(h.speakBoardSentence).not.toHaveBeenCalled();
  const latest = request.mock.calls.filter(([path]) => path === '/sentences').at(-1)[1];
  expect(JSON.parse(latest.body).cards).toEqual(['water', 'drink', 'me']);
  await act(async () => completions[1]({ id: 'latest', sentence: '저는 물을 마셔요.' }));
  expect(h.speakBoardSentence).toHaveBeenCalledExactlyOnceWith('저는 물을 마셔요.', 'latest');
});
