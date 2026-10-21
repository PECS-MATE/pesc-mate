import { test, expect, apiPath, login, linkCaregiver, installSpeechStub } from './workflow-fixtures.js';

test.use({ serviceWorkers: 'block' });
const caregiver = { username: 'caregiver', password: 'caregiver1234' };
const panel = page => page.getByRole('region', { name: '추천 후보', exact: true });
const board = page => page.getByRole('list', { name: '선택한 카드', exact: true });
const exportData = async (request, communicator) => (await request.get(apiPath('/privacy/export'), { headers: communicator.headers })).json();

async function openCommunication(page) {
  await page.getByRole('navigation', { name: '주 메뉴' }).getByRole('button', { name: /그림으로 말하기/ }).click();
  await expect(page.getByRole('heading', { name: '무엇을 말하고 싶나요?' })).toBeVisible();
  await page.getByRole('button', { name: '선택 카드 그대로', exact: true }).click();
}

test('보호자가 승인·숨김을 저장해도 고정 카드판과 전체 카드북은 유지하고 실제 추천 선택만 기록한다', async ({ page, request, communicator }) => {
  const headers = await linkCaregiver(request, communicator);
  const link = await request.post(apiPath('/support/links'), { headers: communicator.headers,
    data: { username: caregiver.username, permissions: ['board_manage', 'records_read'] } });
  expect(link.ok()).toBe(true);
  const saved = await request.put(apiPath(`/board/layout/slots?user_id=${communicator.id}`), {
    headers, data: { expected_revision: 0, card_ids: ['help'] },
  });
  expect(saved.ok()).toBe(true);
  // Mongo stores milliseconds; compare read-to-read, not the unpersisted microseconds of a PUT response.
  const fixed = await (await request.get(apiPath('/board/layout'), { headers: communicator.headers })).json();
  await request.post(apiPath('/auth/logout'), { headers });
  await login(page, caregiver);
  await page.getByLabel('지원할 사용자').selectOption(communicator.id);
  await page.getByRole('navigation').getByRole('button', { name: '빠른 표현·카드판', exact: true }).click();
  const settings = page.getByRole('region', { name: '추천 통제 설정', exact: true });
  await settings.getByLabel('추천 허용 방식').selectOption('approval');
  await settings.getByLabel('물 추천 승인', { exact: true }).check();
  await settings.getByLabel('도와주세요 추천 숨김', { exact: true }).check();
  await settings.getByRole('button', { name: '추천 설정 저장', exact: true }).click();
  await expect(settings).toContainText('고정 카드판은 바꾸지 않았습니다.');
  await settings.getByRole('button', { name: '추천 반복 노출 점검', exact: true }).click();
  await expect(settings).toContainText('50개 중 0개 표본');
  const unchanged = await (await request.get(apiPath('/board/layout'), { headers: communicator.headers })).json();
  expect(unchanged).toEqual(fixed);
  await page.getByRole('button', { name: '로그아웃', exact: true }).click();
  await installSpeechStub(page);
  await login(page, communicator);
  await openCommunication(page);
  await expect(panel(page).locator('[data-recommendation-card]')).toHaveCount(1);
  await expect(panel(page)).toContainText('승인한 카드만 표시');
  await expect(panel(page).locator('.card > small')).toBeVisible();
  await expect(page.locator('#card-library [data-scan-group="cards"] .card')).toHaveCount(1);
  await panel(page).getByRole('button', { name: '물 문장에 담기', exact: true }).click();
  await expect(board(page)).toContainText('물');
  await expect.poll(async () => (await exportData(request, communicator)).recommendation_batches
    .filter(row => row.selected_card_ids.includes('water')).length).toBe(1);
  const exported = await exportData(request, communicator);
  const selected = exported.recommendation_batches.find(row => row.selected_card_ids.includes('water'));
  expect(selected.exposed_card_ids).toContain('water');
  expect(selected.response.cards[0]).toHaveProperty('reason');
  expect(selected.algorithm_version).toBe('aac-candidates-v1');
  expect(exported.communication_sessions).toHaveLength(0);
  expect(exported.learning_attempts).toHaveLength(0);
  await panel(page).getByRole('button', { name: '전체 카드에서 고르기' }).click();
  await page.getByLabel('카드 검색').fill('밥');
  await page.locator('.catalog-grid .catalog-card').first().click();
  await page.getByRole('button', { name: '문장에 사용하기', exact: true }).click();
  await expect(board(page)).toContainText('물');
  await expect(board(page)).toContainText('밥');
  expect((await (await request.get(apiPath('/board/layout'), { headers: communicator.headers })).json()).revision).toBe(fixed.revision);
});

test('추천 장애와 오프라인에서도 로그인·전체 카드 탐색·선택·복구 발화를 계속 사용할 수 있다', async ({ page, request, communicator }) => {
  await installSpeechStub(page);
  await page.route('**/api/recommendations/feed', route => route.fulfill({
    status: 503, contentType: 'application/json', body: JSON.stringify({ detail: '합성 추천 장애' }),
  }));
  await login(page, communicator);
  await openCommunication(page);
  await expect(panel(page)).toContainText('추천을 불러오지 못했습니다. 전체 카드에서 계속 선택할 수 있어요.');
  await page.getByRole('button', { name: '물 문장에 담기', exact: true }).click();
  await expect(board(page)).toContainText('물');
  await page.getByRole('button', { name: /그 뜻이 아니에요/ }).click();
  await expect.poll(() => page.evaluate(() => window.__spokenTexts)).toContain('그 뜻이 아니에요');
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
    window.dispatchEvent(new Event('offline'));
  });
  await expect(panel(page)).toContainText('오프라인에서는 저장된 추천 대신');
  await expect(panel(page).locator('[data-recommendation-card]')).toHaveCount(0);
  await panel(page).getByRole('button', { name: '전체 카드에서 고르기' }).click();
  await page.getByLabel('카드 검색').fill('사과');
  await page.locator('.catalog-grid .catalog-card').first().click();
  await page.getByRole('button', { name: '문장에 사용하기', exact: true }).click();
  await expect(board(page)).toContainText('사과');
  expect((await exportData(request, communicator)).recommendation_batches).toHaveLength(0);
});

test('기록 조회 권한 없는 보호자도 추천을 끌 수 있지만 반복 노출 기록은 조회하지 않는다', async ({ page, request, communicator }) => {
  const headers = await linkCaregiver(request, communicator);
  await request.post(apiPath('/auth/logout'), { headers });
  const recordReads = [];
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/recommendations/monitoring') recordReads.push(request.url()); });
  await login(page, caregiver);
  await page.getByLabel('지원할 사용자').selectOption(communicator.id);
  await page.getByRole('navigation').getByRole('button', { name: '빠른 표현·카드판', exact: true }).click();
  const settings = page.getByRole('region', { name: '추천 통제 설정', exact: true });
  await settings.getByLabel('추천 사용', { exact: true }).uncheck();
  await settings.getByRole('button', { name: '추천 설정 저장', exact: true }).click();
  await expect(settings).toContainText('추천 설정을 저장했습니다.');
  await expect(settings.getByRole('button', { name: '추천 반복 노출 점검', exact: true })).toHaveCount(0);
  expect(recordReads).toHaveLength(0);
  await page.getByRole('button', { name: '로그아웃', exact: true }).click();
  await login(page, communicator);
  await openCommunication(page);
  await expect(panel(page)).toContainText('추천을 껐습니다. 전체 카드는 그대로 사용할 수 있어요.');
  await page.getByRole('button', { name: '물 문장에 담기', exact: true }).click();
  await expect(board(page)).toContainText('물');
});
