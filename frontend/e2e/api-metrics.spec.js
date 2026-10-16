import { randomUUID } from 'node:crypto';
import { test, expect } from './fixtures.js';

const apiPath = path => `${process.env.E2E_API_BASE_URL || ''}/api${path}`;
const accounts = [
  ['demo', 'demo1234', 403], ['caregiver', 'caregiver1234', 403],
  ['support', 'support1234', 403], ['admin', 'admin1234', 200],
];

async function login(request, username, password) {
  const response = await request.post(apiPath('/auth/login'), { data: { username, password } });
  expect(response.status()).toBe(200);
  const session = await response.json();
  return { Authorization: `Bearer ${session.access_token}` };
}

test('API 지표는 운영 권한 계정만 조회한다', async ({ request }) => {
  expect((await request.get(apiPath('/admin/metrics'))).status()).toBe(401);
  for (const [username, password, status] of accounts) {
    const headers = await login(request, username, password);
    try {
      const response = await request.get(apiPath('/admin/metrics'), { headers });
      expect(response.status()).toBe(status);
      if (status === 200) {
        expect(response.headers()['cache-control']).toBe('no-store');
        expect(response.headers()['x-request-id']).toBeTruthy();
        expect((await response.json()).scope).toBe('process');
      } else expect(await response.json()).not.toHaveProperty('totals');
    } finally { await request.post(apiPath('/auth/logout'), { headers }); }
  }
});

test('실제 API 오류를 집계해도 임의 경로와 검색어는 지표에 노출하지 않는다', async ({ request }) => {
  const headers = await login(request, 'admin', 'admin1234');
  try {
    const marker = `private-metrics-${randomUUID()}`;
    const missing = await request.get(apiPath(`/unknown/${marker}?search=${marker}`), { headers });
    expect(missing.status()).toBe(404);
    const response = await request.get(apiPath('/admin/metrics'), { headers });
    expect(response.status()).toBe(200);
    const result = await response.json();
    expect(JSON.stringify(result)).not.toContain(marker);
    expect(result.totals.requests).toBeGreaterThan(0);
    expect(result.totals.client_errors).toBeGreaterThan(0);
    expect(result.totals.error_rate).toBeGreaterThanOrEqual(0);
    expect(result.totals.error_rate).toBeLessThanOrEqual(1);
    expect(result.totals.duration_ms.mean).toBeGreaterThanOrEqual(0);
    expect(result.totals.duration_ms.buckets.at(-1).count).toBe(result.totals.requests);
    expect(result.routes.some(route => route.route === 'unmatched' && route.client_errors > 0)).toBe(true);
  } finally { await request.post(apiPath('/auth/logout'), { headers }); }
});
