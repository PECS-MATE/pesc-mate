import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import useCommunication, { useCommunicationState } from './use-communication';

function harness(overrides = {}) {
  const user = { id: 'synthetic', role: 'user' };
  const dependencies = {
    user, activeUserRef: { current: user }, privacy: { guardian_consent: false },
    offline: false, loaded: true, tab: 'home', myPageOpen: false, busy: false,
    compactSidebar: false, sidebarCollapsed: false, speechState: { status: 'idle' },
    setError: vi.fn(), stopSpeech: vi.fn(async () => {}), setSpeechFailure: vi.fn(),
    setTab: vi.fn(), speakText: vi.fn(), ...overrides,
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
