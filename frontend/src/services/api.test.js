import { expect, it, vi } from 'vitest';
import { hasToken, request, setToken } from './api';

const response = (status, body) => new Response(body == null ? null : JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', 'X-Request-ID': 'server-request' },
});
it('sends session/request headers and preserves request body ordering', async () => {
  setToken('synthetic-token');
  fetch.mockResolvedValue(response(200, { sentence: '물 마셔요' }));
  const body = JSON.stringify({ cards: ['water', 'drink'], selected_at: ['2026-01-01', null] });
  expect(await request('/sentences', { method: 'POST', body })).toEqual({ sentence: '물 마셔요' });
  const [url, options] = fetch.mock.calls[0];
  expect(url).toBe('/api/sentences'); expect(options.body).toBe(body);
  expect(options.headers.get('Authorization')).toBe('Bearer synthetic-token');
  expect(options.headers.get('X-Request-ID')).toMatch(/^[a-f0-9-]{36}$/);
  setToken(null); expect(hasToken()).toBe(false);
});
it('dispatches expiry only for the current authenticated session', async () => {
  const expired = vi.fn(); window.addEventListener('pesc-mate:session-expired', expired);
  try {
    setToken('old');
    fetch.mockImplementation(async () => { setToken('replacement'); return response(401, { detail: 'expired' }); });
    await expect(request('/cards')).rejects.toMatchObject({ status: 401, requestId: 'server-request' });
    expect(expired).not.toHaveBeenCalled();
    fetch.mockResolvedValue(response(401, { detail: 'expired' }));
    await expect(request('/cards')).rejects.toThrow('expired');
    expect(expired).toHaveBeenCalledTimes(1);
    await expect(request('/auth/login')).rejects.toThrow();
    expect(expired).toHaveBeenCalledTimes(1);
  } finally { window.removeEventListener('pesc-mate:session-expired', expired); }
});
it('announces permission revocation and supports empty logout response', async () => {
  const denied = vi.fn(); window.addEventListener('pesc-mate:access-denied', denied);
  try {
    fetch.mockResolvedValue(response(403, { error: { code: 'forbidden', message: 'denied' } }));
    await expect(request('/records')).rejects.toMatchObject({ message: 'denied', code: 'forbidden', status: 403 });
    expect(denied.mock.calls[0][0].apiPath).toBe('/records');
    fetch.mockResolvedValue(response(204)); expect(await request('/auth/logout', { method: 'POST' })).toBeNull();
  } finally { window.removeEventListener('pesc-mate:access-denied', denied); }
});
