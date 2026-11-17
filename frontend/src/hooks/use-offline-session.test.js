import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { request } from '../services/api';
import useOfflineSession, { useNetworkSessionEvents } from './use-offline-session';

vi.mock('../services/api', () => ({ request: vi.fn(), setToken: vi.fn() }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); });

function harness(user = { id: 'synthetic', role: 'user' }) {
  const props = {
    user, setOffline: vi.fn(),
    syncPendingEvents: vi.fn(), load: vi.fn(), clearSupportTargetData: vi.fn(),
    setTab: vi.fn(), setError: vi.fn(),
  };
  const hook = renderHook(() => useNetworkSessionEvents(props));
  return { ...props, ...hook };
}

it('keeps a reachable local server online even when the device reports no internet', async () => {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  request.mockResolvedValue({ status: 'ok' });
  const h = harness();
  await waitFor(() => expect(h.setOffline).toHaveBeenCalledWith(false));
  act(() => window.dispatchEvent(new Event('offline')));
  await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  expect(h.setOffline).not.toHaveBeenCalledWith(true);
  expect(h.load).toHaveBeenCalledTimes(1);
});

it('enters offline mode on server failure and recovers on focus', async () => {
  request.mockRejectedValueOnce(new TypeError('Failed to fetch'));
  const h = harness();
  await waitFor(() => expect(h.setOffline).toHaveBeenCalledWith(true));
  request.mockResolvedValue({ status: 'ok' });
  act(() => window.dispatchEvent(new Event('focus')));
  await waitFor(() => expect(h.setOffline).toHaveBeenLastCalledWith(false));
  expect(h.syncPendingEvents).toHaveBeenCalledWith(h.user);
});

it('ignores a pending server check after unmount', async () => {
  let resolve;
  request.mockImplementation(() => new Promise(done => { resolve = done; }));
  const h = harness();
  h.unmount();
  await act(async () => resolve({ status: 'ok' }));
  expect(h.setOffline).not.toHaveBeenCalled();
});

it('preserves support selection and navigation during a temporary connection failure', async () => {
  request.mockRejectedValue(new TypeError('Failed to fetch'));
  const h = harness({ id: 'synthetic-support', role: 'support_staff', account_permissions: ['content_manage'] });
  await waitFor(() => expect(h.setOffline).toHaveBeenCalledWith(true));
  expect(h.clearSupportTargetData).not.toHaveBeenCalled();
  expect(h.setTab).not.toHaveBeenCalled();
  expect(h.setError).not.toHaveBeenCalled();
});

function supportLoader() {
  localStorage.setItem('pesc-mate-token', 'synthetic-token');
  const target = { id: 'two', name: '두 번째 아이', permissions: ['cards_manage'] };
  const props = { user: { id: 'caregiver', role: 'caregiver' }, loaded: true,
    selectedUserRef: { current: target } };
  for (const key of ['setError', 'clearSupportTargetData', 'setLinkedUsers', 'setSelectedUser', 'setCards',
    'setCardCategories', 'setCardSubmissions', 'setAdminSubmissions', 'setAdminCategories', 'setCategoryEdits',
    'setTab', 'setStats', 'setLoaded', 'setOffline', 'setUser']) props[key] = vi.fn();
  return { props, ...renderHook(() => useOfflineSession(props)) };
}

it('keeps existing linked children when a support refresh fails', async () => {
  request.mockRejectedValue(new TypeError('Failed to fetch'));
  const h = supportLoader();
  await act(async () => expect(await h.result.current.load()).toBe(false));
  expect(h.props.clearSupportTargetData).not.toHaveBeenCalled();
  expect(h.props.setLinkedUsers).not.toHaveBeenCalled();
  expect(h.props.setSelectedUser).not.toHaveBeenCalled();
  expect(h.props.setTab).not.toHaveBeenCalled();
  expect(h.props.setOffline).toHaveBeenCalledWith(true);
});

it('preserves the selected child and current page after a successful reconnect', async () => {
  const h = supportLoader();
  const people = [{ id: 'one', permissions: [] }, h.props.selectedUserRef.current];
  request.mockImplementation(path => Promise.resolve(path === '/care/linked-users' ? people : []));
  await act(async () => expect(await h.result.current.load()).toBe(true));
  expect(h.props.setSelectedUser).toHaveBeenCalledWith(people[1]);
  expect(h.props.clearSupportTargetData).not.toHaveBeenCalled();
  expect(h.props.setTab).not.toHaveBeenCalled();
  expect(h.props.setOffline).toHaveBeenCalledWith(false);
});

it('clears support information when the server confirms no linked children', async () => {
  request.mockResolvedValue([]);
  const h = supportLoader();
  await act(async () => h.result.current.load());
  expect(h.props.clearSupportTargetData).toHaveBeenCalledOnce();
  expect(h.props.setLinkedUsers).toHaveBeenCalledWith([]);
  expect(h.props.setSelectedUser).toHaveBeenCalledWith(null);
});

it('still clears support information on a confirmed permission denial', async () => {
  request.mockRejectedValue(Object.assign(new Error('권한 없음'), { status: 403 }));
  const h = supportLoader();
  await act(async () => h.result.current.load());
  expect(h.props.clearSupportTargetData).toHaveBeenCalledOnce();
});

it('retries loading linked data when health succeeds but the refresh fails', async () => {
  request.mockResolvedValue({ status: 'ok' });
  const h = harness();
  h.load.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  await waitFor(() => expect(h.load).toHaveBeenCalledOnce());
  await act(async () => window.dispatchEvent(new Event('focus')));
  await waitFor(() => expect(h.load).toHaveBeenCalledTimes(2));
});

it('uses current refresh callbacks after connection recovery', async () => {
  request.mockRejectedValueOnce(new TypeError('Failed to fetch'));
  const user = { id: 'one', role: 'caregiver' }, oldLoad = vi.fn(), freshLoad = vi.fn();
  const setters = { setOffline: vi.fn(), syncPendingEvents: vi.fn() };
  const h = renderHook(({ load }) => useNetworkSessionEvents({ user, load, ...setters }),
    { initialProps: { load: oldLoad } });
  await waitFor(() => expect(setters.setOffline).toHaveBeenCalledWith(true));
  h.rerender({ load: freshLoad });
  request.mockResolvedValue({ status: 'ok' });
  act(() => window.dispatchEvent(new Event('focus')));
  await waitFor(() => expect(freshLoad).toHaveBeenCalledOnce());
  expect(oldLoad).not.toHaveBeenCalled();
});
