import { randomUUID } from 'node:crypto';
import { test, expect, apiPath, login } from './workflow-fixtures.js';

test.use({ serviceWorkers: 'block' });

async function operator(request) {
  const response = await request.post(apiPath('/auth/login'), { data: { username: 'admin', password: 'admin1234' } });
  expect(response.status()).toBe(200);
  return { Authorization: `Bearer ${(await response.json()).access_token}` };
}

async function alerts(request, headers) {
  const response = await request.get(apiPath('/admin/alerts'), { headers });
  expect(response.status()).toBe(200);
  expect(response.headers()['cache-control']).toBe('no-store');
  return response.json();
}

test('운영 알림 API는 운영 권한 계정만 조회한다', async ({ request }) => {
  expect((await request.get(apiPath('/admin/alerts'))).status()).toBe(401);
  for (const [username, password, status] of [
    ['demo', 'demo1234', 403], ['caregiver', 'caregiver1234', 403],
    ['support', 'support1234', 403], ['admin', 'admin1234', 200],
  ]) {
    const response = await request.post(apiPath('/auth/login'), { data: { username, password } });
    expect(response.status()).toBe(200);
    const headers = { Authorization: `Bearer ${(await response.json()).access_token}` };
    try {
      expect((await request.get(apiPath('/admin/alerts'), { headers })).status()).toBe(status);
    } finally { await request.post(apiPath('/auth/logout'), { headers }); }
  }
});

test('공개 카드 검수 알림에서 승인한 뒤 대기 건수를 갱신하고 좁은 화면에서도 숫자를 분리한다', async ({ page, request, communicator }) => {
  const headers = await operator(request);
  try {
    const before = await alerts(request, headers);
    const categories = await (await request.get(apiPath('/categories'), { headers: communicator.headers })).json();
    const label = `알림검증${randomUUID().replaceAll('-', '').slice(0, 12)}`;
    const png = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 160; canvas.height = 160;
      canvas.getContext('2d').fillRect(0, 0, 160, 160);
      return canvas.toDataURL('image/png').split(',')[1];
    });
    const submitted = await request.post(apiPath('/cards/submissions'), {
      headers: communicator.headers, multipart: {
        label, meaning: '공용 카드 알림 검증', category: categories[0].name, visibility: 'shared',
        image: { name: '검증.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') },
      },
    });
    expect(submitted.status()).toBe(201);
    const card = await submitted.json();
    const pending = before.sources.review_queue.pending;
    const created = await alerts(request, headers);
    expect(created.sources.review_queue.pending).toBe(pending + 1);
    for (const value of [label, card.id, communicator.id]) expect(JSON.stringify(created)).not.toContain(value);

    await page.setViewportSize({ width: 390, height: 844 });
    await login(page, { username: 'admin', password: 'admin1234' });
    const panel = page.getByRole('region', { name: '운영 알림' });
    const notice = panel.getByRole('listitem').filter({ has: page.getByText('공용 카드 검수 대기', { exact: true }) });
    await expect(notice.locator('.operational-alert-count')).toHaveText(`${pending + 1}건`);
    const titleBox = await notice.getByText('공용 카드 검수 대기', { exact: true }).boundingBox();
    const countBox = await notice.locator('.operational-alert-count').boundingBox();
    expect(Boolean(titleBox && countBox)).toBe(true);
    expect(countBox.x >= titleBox.x + titleBox.width || countBox.y >= titleBox.y + titleBox.height).toBe(true);
    await notice.getByRole('button', { name: '검수 목록 열기' }).click();
    const cardRow = page.locator('.review-card').filter({ has: page.getByRole('heading', { name: label, exact: true }) });
    const reviewed = page.waitForResponse(response => new URL(response.url()).pathname === `/api/admin/card-submissions/${card.id}`
      && response.request().method() === 'PATCH');
    await cardRow.getByRole('button', { name: '승인', exact: true }).click();
    expect((await reviewed).status()).toBe(200);
    if (pending) await expect(notice.locator('.operational-alert-count')).toHaveText(`${pending}건`);
    else await expect(notice).toHaveCount(0);
    expect((await alerts(request, headers)).sources.review_queue.pending).toBe(pending);
    await page.getByRole('button', { name: '로그아웃', exact: true }).click();
    await expect(panel).toHaveCount(0);
  } finally { await request.post(apiPath('/auth/logout'), { headers }); }
});

test('음성·동기화 반복 실패는 고정 알림으로 집계하고 오류 원문과 사용자 ID를 제외한다', async ({ request, communicator }) => {
  const headers = await operator(request);
  try {
    const ids = Array.from({ length: 3 }, () => randomUUID());
    const privateValue = `private-${randomUUID()}`;
    for (const id of ids) {
      expect((await request.post(apiPath('/tts/events'), { headers: communicator.headers,
        data: { request_id: id, content_type: 'card', char_count: 5 } })).status()).toBe(201);
      expect((await request.patch(apiPath(`/tts/events/${id}`), { headers: communicator.headers,
        data: { status: 'failed', error_code: privateValue } })).status()).toBe(200);
      expect((await request.post(apiPath('/learning/attempts'), {
        headers: { ...communicator.headers, 'X-Pesc-Offline-Sync': 'true' },
        data: { request_id: randomUUID(), activity_type: 'word_picture_match', category_id: 'food',
          total_questions: 1, correct_answers: 2, duration_seconds: 1, items: [] },
      })).status()).toBe(422);
    }
    const result = await alerts(request, headers);
    for (const code of ['tts_repeated_failure', 'offline_sync_repeated_failure']) {
      const matching = result.alerts.filter(alert => alert.code === code);
      expect(matching).toHaveLength(1);
      expect(matching[0].count).toBeGreaterThanOrEqual(3);
    }
    for (const value of [privateValue, communicator.id, ...ids]) expect(JSON.stringify(result)).not.toContain(value);
  } finally { await request.post(apiPath('/auth/logout'), { headers }); }
});
