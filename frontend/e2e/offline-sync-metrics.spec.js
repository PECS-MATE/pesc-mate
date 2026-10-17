import { randomUUID } from 'node:crypto';
import { test, expect, apiPath, login, offlineValue } from './workflow-fixtures.js';

test.use({ serviceWorkers: 'block' });

async function operator(request) {
  const response = await request.post(apiPath('/auth/login'), { data: { username: 'admin', password: 'admin1234' } });
  expect(response.status()).toBe(200);
  return { Authorization: `Bearer ${(await response.json()).access_token}` };
}

async function metrics(request, headers) {
  const response = await request.get(apiPath('/admin/offline-sync-metrics'), { headers });
  expect(response.status()).toBe(200);
  expect(response.headers()['cache-control']).toBe('no-store');
  return response.json();
}

function delta(after, before, key) { return after.totals[key] - before.totals[key]; }

test('오프라인 동기화 지표는 운영 권한 계정만 조회한다', async ({ request }) => {
  expect((await request.get(apiPath('/admin/offline-sync-metrics'))).status()).toBe(401);
  for (const [username, password, status] of [
    ['demo', 'demo1234', 403], ['caregiver', 'caregiver1234', 403],
    ['support', 'support1234', 403], ['admin', 'admin1234', 200],
  ]) {
    const response = await request.post(apiPath('/auth/login'), { data: { username, password } });
    expect(response.status()).toBe(200);
    const headers = { Authorization: `Bearer ${(await response.json()).access_token}` };
    try {
      expect((await request.get(apiPath('/admin/offline-sync-metrics'), { headers })).status()).toBe(status);
    } finally { await request.post(apiPath('/auth/logout'), { headers }); }
  }
});

test('저장 응답을 잃어도 새로고침 후 발화·학습을 재시도하고 중복 제거를 집계한다', async ({ page, request, communicator }) => {
  const headers = await operator(request);
  try {
    await login(page, communicator);
    await expect.poll(async () => Boolean(await offlineValue(page, 'snapshots', communicator.id))).toBe(true);
    const before = await metrics(request, headers);
    const eventId = randomUUID();
    const attemptId = randomUUID();
    await page.evaluate(async ({ userId, eventId, attemptId }) => {
      const database = await new Promise((resolve, reject) => {
        const open = indexedDB.open('pesc-mate-offline');
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
      });
      try {
        await new Promise((resolve, reject) => {
          const transaction = database.transaction(['events', 'learningAttempts'], 'readwrite');
          transaction.objectStore('events').put({ id: eventId, user_id: userId,
            event_type: 'immediate_speech', card_ids: ['help'], occurred_at: new Date().toISOString() });
          transaction.objectStore('learningAttempts').put({ request_id: attemptId, user_id: userId,
            activity_type: 'word_picture_match', category_id: 'food', total_questions: 1,
            correct_answers: 1, duration_seconds: 2, items: [] });
          transaction.oncomplete = resolve;
          transaction.onerror = () => reject(transaction.error);
        });
      } finally { database.close(); }
    }, { userId: communicator.id, eventId, attemptId });

    const calls = { communication: [], learning: [] };
    for (const [kind, path] of [['communication', 'offline/events/sync'], ['learning', 'learning/attempts']]) {
      await page.route(`**/api/${path}`, async route => {
        calls[kind].push({ retried: route.request().headers()['x-pesc-sync-retried'],
          offline: route.request().headers()['x-pesc-offline-sync'], body: route.request().postDataJSON() });
        if (calls[kind].length === 1) {
          // Commit through the real API, then lose only the browser's response.
          const response = await route.fetch();
          expect(response.ok()).toBe(true);
          await route.abort('connectionreset');
        } else { await route.continue(); }
      });
    }
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(page.getByTestId('sync-status')).toContainText('남은 2건은 기기에 보관됩니다.', { timeout: 20000 });
    expect((await offlineValue(page, 'events'))[0].sync_attempted).toBe(true);
    expect((await offlineValue(page, 'learningAttempts'))[0].sync_attempted).toBe(true);

    await page.reload();
    await expect.poll(async () => (await offlineValue(page, 'events')).length
      + (await offlineValue(page, 'learningAttempts')).length, { timeout: 20000 }).toBe(0);
    for (const kind of ['communication', 'learning']) {
      expect(calls[kind].map(call => call.retried)).toEqual(['0', '1']);
      expect(calls[kind][0].body).toEqual(calls[kind][1].body);
      expect(JSON.stringify(calls[kind][1].body)).not.toContain('sync_attempted');
      expect(JSON.stringify(calls[kind][1].body)).not.toContain('user_id');
    }
    expect(calls.learning.map(call => call.offline)).toEqual(['true', 'true']);
    const after = await metrics(request, headers);
    for (const [key, value] of Object.entries({ operations: 4, received: 4, inserted: 2, duplicates: 2,
      retried: 2, failed_operations: 0, failed: 0, unprocessed: 0 })) {
      expect(delta(after, before, key), key).toBe(value);
    }
    expect(after.retry_source).toBe('client_marked');
    for (const privateValue of [communicator.id, eventId, attemptId]) expect(JSON.stringify(after)).not.toContain(privateValue);
    const exported = await (await request.get(apiPath('/privacy/export'), { headers: communicator.headers })).json();
    expect(exported.offline_events).toHaveLength(1);
    expect(exported.learning_attempts).toHaveLength(1);
    expect(JSON.stringify(exported)).not.toContain('sync_attempted');
  } finally { await request.post(apiPath('/auth/logout'), { headers }); }
});

test('부분 저장 후 충돌과 미처리 건을 구분하고 정상 재전송은 중복만 제거한다', async ({ request, communicator }) => {
  const headers = await operator(request);
  const registration = await request.post(apiPath('/auth/register'), { data: {
    username: `sync_${randomUUID().replaceAll('-', '').slice(0, 20)}`, password: 'Sync-test-1234',
    name: '충돌 검증 사용자', guardian_consent: true,
  } });
  expect(registration.status()).toBe(201);
  const other = { Authorization: `Bearer ${(await registration.json()).access_token}` };
  try {
    const item = () => ({ id: randomUUID(), event_type: 'immediate_speech', card_ids: ['help'], occurred_at: new Date().toISOString() });
    const collision = item();
    expect((await request.post(apiPath('/offline/events/sync'), { headers: other, data: { events: [collision] } })).status()).toBe(200);
    const before = await metrics(request, headers);
    const first = item(); const last = item();
    const body = { events: [first, collision, last] };
    expect((await request.post(apiPath('/offline/events/sync'), { headers: communicator.headers, data: body })).status()).toBe(409);
    const replay = await request.post(apiPath('/offline/events/sync'), {
      headers: { ...communicator.headers, 'X-Pesc-Sync-Retried': '2' }, data: { events: [first, last] },
    });
    expect(replay.status()).toBe(200);
    expect((await replay.json()).accepted_ids).toEqual([first.id, last.id]);
    const after = await metrics(request, headers);
    for (const [key, value] of Object.entries({ operations: 2, received: 5, inserted: 2, duplicates: 1,
      retried: 2, failed_operations: 1, failed: 1, unprocessed: 1 })) {
      expect(delta(after, before, key), key).toBe(value);
    }
    expect(after.totals.errors.conflict - before.totals.errors.conflict).toBe(1);
    const exported = await (await request.get(apiPath('/privacy/export'), { headers: communicator.headers })).json();
    expect(exported.offline_events).toHaveLength(2);
    expect(exported.offline_events.map(record => record._id)).not.toContain(collision.id);
    for (const id of [first.id, last.id, collision.id]) expect(JSON.stringify(after)).not.toContain(id);
  } finally {
    await request.delete(apiPath('/privacy/data'), { headers: other, data: { confirmation: 'DELETE' } });
    await request.post(apiPath('/auth/logout'), { headers: other });
    await request.post(apiPath('/auth/logout'), { headers });
  }
});

test('동시 발화·학습 재전송도 UUID당 한 건만 저장하고 실제 중복을 집계한다', async ({ request, communicator }) => {
  const headers = await operator(request);
  try {
    const before = await metrics(request, headers);
    const eventId = randomUUID(); const attemptId = randomUUID();
    const item = { id: eventId, event_type: 'immediate_speech', card_ids: ['help'], occurred_at: new Date().toISOString() };
    const attempt = { request_id: attemptId, activity_type: 'word_picture_match', category_id: 'food',
      total_questions: 1, correct_answers: 1, duration_seconds: 2, items: [] };
    const responses = await Promise.all(Array.from({ length: 10 }, () => [
      request.post(apiPath('/offline/events/sync'), { headers: communicator.headers, data: { events: [item] } }),
      request.post(apiPath('/learning/attempts'), {
        headers: { ...communicator.headers, 'X-Pesc-Offline-Sync': 'true' }, data: attempt,
      }),
    ]).flat());
    expect(responses.every(response => response.ok())).toBe(true);
    const after = await metrics(request, headers);
    for (const [key, value] of Object.entries({ operations: 20, received: 20, inserted: 2, duplicates: 18,
      retried: 0, failed_operations: 0, failed: 0, unprocessed: 0 })) {
      expect(delta(after, before, key), key).toBe(value);
    }
    const exported = await (await request.get(apiPath('/privacy/export'), { headers: communicator.headers })).json();
    expect(exported.offline_events).toHaveLength(1);
    expect(exported.learning_attempts).toHaveLength(1);
  } finally { await request.post(apiPath('/auth/logout'), { headers }); }
});
