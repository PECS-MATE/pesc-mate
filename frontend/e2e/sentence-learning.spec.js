import { test, expect, apiPath, login, configureShortPractice, offlineValue } from './workflow-fixtures.js';

test.use({ serviceWorkers: 'block' });
const current = async (page, account) => (await offlineValue(page, 'learning', `${account.id}:game`))?.game;
async function openPractice(page) {
  await page.getByRole('navigation').getByRole('button', { name: '연습하기', exact: true }).click();
  await page.getByLabel('연습 종류').selectOption('sentence_card_order');
  await page.getByRole('button', { name: '연습 시작', exact: true }).click();
}
async function fillOrder(page) {
  const labels = await page.getByRole('list', { name: '예문 카드 순서' }).locator('strong').allTextContents();
  for (const label of labels) {
    const button = page.getByRole('button', { name: `${label} 순서에 담기`, exact: true });
    if (await button.isEnabled()) await button.click();
  }
  await page.getByRole('button', { name: '순서 확인', exact: true }).click();
}
async function next(page, final) {
  await expect(page.getByText('잘 찾았어요! 다음 문제로 가 볼까요?', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: final ? '연습 마치기' : '다음 문제', exact: true }).click();
}

test('문장 순서 연습은 오답 재도전과 선택 중 재개를 유지하며 학습에만 저장한다', async ({ page, request, communicator }) => {
  await configureShortPractice(request, communicator); await login(page, communicator);
  const boardBefore = await (await request.get(apiPath('/board/layout'), { headers: communicator.headers })).json();
  await openPractice(page);
  await expect.poll(async () => (await current(page, communicator))?.questions?.length).toBe(5);
  const identity = (await current(page, communicator)).requestId;
  const labels = await page.getByRole('list', { name: '예문 카드 순서' }).locator('strong').allTextContents();
  for (const label of labels.toReversed()) await page.getByRole('button', { name: `${label} 순서에 담기`, exact: true }).click();
  await page.getByRole('button', { name: '순서 확인', exact: true }).click();
  await expect(page.getByText('괜찮아요. 카드를 빼고 예문의 순서로 다시 놓아 보세요.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '순서 확인', exact: true })).toBeDisabled();
  const selected = page.getByRole('list', { name: '선택한 카드 순서' });
  while (await selected.getByRole('button').count()) await selected.getByRole('button').first().click();
  await fillOrder(page); await next(page, false);
  await expect.poll(async () => (await current(page, communicator))?.questionIndex).toBe(1);
  const first = (await current(page, communicator)).questions[1].sequence[0];
  await page.getByRole('button', { name: `${first.label} 순서에 담기`, exact: true }).click();
  await expect.poll(async () => (await current(page, communicator))?.sequenceIds).toEqual([first.id]);
  await page.reload(); await expect(page.getByText('저장된 문제부터 이어서 연습해요.')).toBeVisible();
  await expect(page.getByRole('button', { name: `1번째 ${first.label} 빼기`, exact: true })).toBeVisible();
  expect((await current(page, communicator)).requestId).toBe(identity);
  for (let index = 1; index < 5; index += 1) { await fillOrder(page); await next(page, index === 4); }
  await expect(page.getByRole('heading', { name: '연습을 마쳤어요!' })).toBeVisible();
  const exported = await (await request.get(apiPath('/privacy/export'), { headers: communicator.headers })).json();
  for (const key of ['communication_sessions', 'tts_events', 'offline_events']) expect(exported[key]).toEqual([]);
  expect(exported.learning_attempts).toHaveLength(1);
  expect(exported.learning_attempts[0]).toMatchObject({ _id: identity, activity_type: 'sentence_card_order', content_version: 'sentence-order-v1', correct_answers: 4 });
  expect(exported.learning_attempts[0].items).toHaveLength(5);
  expect(exported.learning_attempts[0].items.every(item => item.content_id && item.card_ids.length >= 2)).toBe(true);
  const progress = await (await request.get(apiPath('/learning/progress'), { headers: communicator.headers })).json();
  for (const key of ['familiar_words', 'repeat_words', 'practicing_words']) expect(progress[key]).toEqual([]);
  expect(await (await request.get(apiPath('/board/layout'), { headers: communicator.headers })).json()).toEqual(boardBefore);
});

test('문장 순서 연습을 오프라인에서 완료한 뒤 같은 결과와 요청 ID로 한 번만 동기화한다', async ({ page, request, communicator }) => {
  await configureShortPractice(request, communicator); await login(page, communicator); await openPractice(page);
  await expect.poll(async () => (await current(page, communicator))?.activity_type).toBe('sentence_card_order');
  const identity = (await current(page, communicator)).requestId;
  await page.evaluate(() => { Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false }); window.dispatchEvent(new Event('offline')); });
  await page.route('**/api/**', route => route.abort('internetdisconnected'));
  for (let index = 0; index < 5; index += 1) { await fillOrder(page); await next(page, index === 4); }
  await expect(page.getByText('결과를 기기에 저장했습니다. 온라인 연결 후 자동으로 동기화합니다.', { exact: true })).toBeVisible();
  const queued = await offlineValue(page, 'learningAttempts'); expect(queued).toHaveLength(1);
  expect(queued[0]).toMatchObject({ request_id: identity, activity_type: 'sentence_card_order', content_version: 'sentence-order-v1' });
  await page.unroute('**/api/**');
  await page.evaluate(() => { Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true }); window.dispatchEvent(new Event('online')); });
  await expect.poll(async () => (await offlineValue(page, 'learningAttempts')).length).toBe(0);
  const progress = await (await request.get(apiPath('/learning/progress'), { headers: communicator.headers })).json();
  expect(progress.attempts).toBe(1); expect(progress.recent[0]).toMatchObject({ id: identity, content_version: 'sentence-order-v1', correct_answers: 5 });
});

test('동의 없는 문장 연습은 말하기를 유지하고 완료해도 결과·진행·대기열을 만들지 않는다', async ({ page, request, communicator }) => {
  expect((await request.put(apiPath('/privacy/settings'), { headers: communicator.headers,
    data: { guardian_consent: false, retention_days: 365 } })).ok()).toBe(true);
  await login(page, communicator);
  const writes = [];
  page.on('request', outgoing => { if (/\/api\//.test(outgoing.url()) && ['POST', 'PATCH'].includes(outgoing.method())) writes.push(new URL(outgoing.url()).pathname); });
  await openPractice(page);
  await page.getByRole('button', { name: '말하기로 이동' }).click();
  await expect(page.getByRole('heading', { name: '무엇을 말하고 싶나요?' })).toBeVisible();
  await page.getByRole('navigation').getByRole('button', { name: '연습하기', exact: true }).click();
  for (let index = 0; index < 10; index += 1) { await fillOrder(page); await next(page, index === 9); }
  await expect(page.getByText('기록 없이 연습했어요. 결과는 서버나 기기에 저장하지 않았습니다.', { exact: true })).toBeVisible();
  expect(writes).toEqual([]);
  expect(await offlineValue(page, 'learning', `${communicator.id}:game`)).toBeUndefined();
  expect(await offlineValue(page, 'learningAttempts')).toEqual([]);
  const exported = await (await request.get(apiPath('/privacy/export'), { headers: communicator.headers })).json();
  for (const key of ['communication_sessions', 'learning_attempts', 'tts_events', 'offline_events']) expect(exported[key]).toEqual([]);
});
