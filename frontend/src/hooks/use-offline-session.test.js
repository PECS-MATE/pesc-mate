import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { request } from '../services/api';
import { useNetworkSessionEvents } from './use-offline-session';

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

it('clears private support data without adding a duplicate global offline warning', async () => {
  request.mockRejectedValue(new TypeError('Failed to fetch'));
  const h = harness({ id: 'synthetic-support', role: 'support_staff', account_permissions: ['content_manage'] });
  await waitFor(() => expect(h.setOffline).toHaveBeenCalledWith(true));
  expect(h.clearSupportTargetData).toHaveBeenCalledOnce();
  expect(h.setTab).toHaveBeenCalledWith('admin');
  expect(h.setError).not.toHaveBeenCalled();
});
