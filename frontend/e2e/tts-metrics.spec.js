import { randomUUID } from 'node:crypto';
import { test, expect, apiPath } from './workflow-fixtures.js';

async function login(request, username, password) {
  const response = await request.post(apiPath('/auth/login'), { data: { username, password } });
  expect(response.status()).toBe(200);
  return { Authorization: `Bearer ${(await response.json()).access_token}` };
}

async function report(request, headers) {
  const response = await request.get(apiPath('/admin/tts-metrics?hours=168'), { headers });
  expect(response.status()).toBe(200);
  expect(response.headers()['cache-control']).toBe('no-store');
  return response.json();
}

test('TTS 집계는 운영 계정에만 제공하고 조회 기간을 검증한다', async ({ request }) => {
  expect((await request.get(apiPath('/admin/tts-metrics'))).status()).toBe(401);
  for (const [username, password, status] of [
    ['demo', 'demo1234', 403], ['caregiver', 'caregiver1234', 403],
    ['support', 'support1234', 403], ['admin', 'admin1234', 200],
  ]) {
    const headers = await login(request, username, password);
    try {
      expect((await request.get(apiPath('/admin/tts-metrics'), { headers })).status()).toBe(status);
      if (status === 200) {
        for (const period of ['0', '169', 'bad']) {
          expect((await request.get(apiPath(`/admin/tts-metrics?hours=${period}`), { headers })).status()).toBe(422);
        }
      }
    } finally { await request.post(apiPath('/auth/logout'), { headers }); }
  }
});

test('성공·실패·취소·결과 미수신과 0ms를 구분하고 재전송·동시 완료를 중복 집계하지 않는다', async ({ request, communicator }) => {
  const operator = await login(request, 'admin', 'admin1234');
  try {
    const before = await report(request, operator);
    const ids = Array.from({ length: 5 }, () => randomUUID());
    const marker = `private-${randomUUID()}`;
    for (const [index, content_type] of ['card', 'sentence', 'recovery', 'preview', 'recovery'].entries()) {
      const response = await request.post(apiPath('/tts/events'), {
        headers: communicator.headers, data: { request_id: ids[index], content_type, char_count: 5 },
      });
      expect(response.status()).toBe(201);
    }
    const complete = (index, data) => request.patch(apiPath(`/tts/events/${ids[index]}`), { headers: communicator.headers, data });
    expect((await complete(0, { status: 'succeeded', startup_ms: 0 })).status()).toBe(200);
    expect((await complete(1, { status: 'failed', startup_ms: 350, error_code: marker })).status()).toBe(200);
    expect((await complete(2, { status: 'cancelled', error_code: 'user-stopped' })).status()).toBe(200);

    const repeatedStart = await request.post(apiPath('/tts/events'), {
      headers: communicator.headers, data: { request_id: ids[0], content_type: 'preview', char_count: 20 },
    });
    expect(await repeatedStart.json()).toMatchObject({ status: 'succeeded', startup_ms: 0 });
    const repeatedEnd = await complete(0, { status: 'failed', startup_ms: 999, error_code: 'late-result' });
    expect(await repeatedEnd.json()).toMatchObject({ status: 'succeeded', startup_ms: 0 });

    const races = await Promise.all([
      complete(4, { status: 'succeeded', startup_ms: 200 }),
      complete(4, { status: 'failed', startup_ms: 1000, error_code: 'voice-unavailable' }),
    ]);
    expect(races.map(response => response.status())).toEqual([200, 200]);
    const outcomes = await Promise.all(races.map(response => response.json()));
    expect(outcomes[1]).toEqual(outcomes[0]);

    const after = await report(request, operator);
    expect(after.scope).toBe('stored_events');
    expect(after.source).toBe('client_reported');
    expect(after.totals.requests - before.totals.requests).toBe(5);
    expect(after.totals.cancelled - before.totals.cancelled).toBe(1);
    expect(after.totals.requested - before.totals.requested).toBe(1);
    expect(after.totals.resolved - before.totals.resolved).toBe(3);
    expect(after.totals.startup_ms.samples - before.totals.startup_ms.samples).toBe(3);
    expect(after.totals.startup_ms.buckets.at(-1).count).toBe(after.totals.startup_ms.samples);
    expect(after.totals.failure_rate).toBeCloseTo(after.totals.failed / after.totals.resolved, 6);
    expect(after.failure_codes.some(item => item.code === 'other' && item.count > 0)).toBe(true);
    expect(JSON.stringify(after)).not.toContain(marker);
    expect(JSON.stringify(after)).not.toContain(communicator.id);
    for (const id of ids) expect(JSON.stringify(after)).not.toContain(id);
    const exported = await (await request.get(apiPath('/privacy/export'), { headers: communicator.headers })).json();
    expect(exported.tts_events).toHaveLength(5);
    expect(exported.tts_events.find(item => item._id === ids[0])).toMatchObject({ status: 'succeeded', startup_ms: 0, content_type: 'card' });
  } finally { await request.post(apiPath('/auth/logout'), { headers: operator }); }
});

test('다른 계정이 같은 TTS 요청 ID를 시작하거나 완료할 수 없다', async ({ request, communicator }) => {
  const id = randomUUID();
  expect((await request.post(apiPath('/tts/events'), {
    headers: communicator.headers, data: { request_id: id, content_type: 'card', char_count: 3 },
  })).status()).toBe(201);
  const registration = await request.post(apiPath('/auth/register'), { data: {
    username: `tts_${randomUUID().replaceAll('-', '').slice(0, 20)}`, password: 'Tts-test-1234',
    name: '별도 검증 사용자', guardian_consent: true,
  } });
  expect(registration.status()).toBe(201);
  const headers = { Authorization: `Bearer ${(await registration.json()).access_token}` };
  try {
    expect((await request.post(apiPath('/tts/events'), {
      headers, data: { request_id: id, content_type: 'card', char_count: 3 },
    })).status()).toBe(409);
    expect((await request.patch(apiPath(`/tts/events/${id}`), { headers, data: { status: 'succeeded' } })).status()).toBe(404);
  } finally {
    await request.delete(apiPath('/privacy/data'), { headers, data: { confirmation: 'DELETE' } });
    await request.post(apiPath('/auth/logout'), { headers });
  }
});
