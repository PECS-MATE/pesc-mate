import { test, expect, apiPath, login, configureShortPractice, linkCaregiver,
  offlineValue, installSpeechStub } from './workflow-fixtures.js';

test.use({ serviceWorkers: 'block' });

async function currentGame(page, account) {
  return (await offlineValue(page, 'learning', `${account.id}:game`))?.game;
}

async function answerQuestion(page, account, index) {
  await expect.poll(async () => (await currentGame(page, account))?.questionIndex).toBe(index);
  const game = await currentGame(page, account);
  await page.getByRole('group', { name: '단어 보기' }).getByRole('button', {
    name: game.questions[index].target.label, exact: true,
  }).click();
  await expect(page.getByText('잘 찾았어요! 다음 문제로 가 볼까요?', { exact: true })).toBeVisible();
}

test('학습을 중단하고 새로고침해도 같은 문제부터 재개하고 결과를 한 번 저장한다', async ({ page, request, communicator }) => {
  await configureShortPractice(request, communicator);
  await login(page, communicator);
  await page.getByRole('navigation').getByRole('button', { name: '연습하기', exact: true }).click();
  await page.getByRole('button', { name: '연습 시작', exact: true }).click();
  await answerQuestion(page, communicator, 0);
  await page.getByRole('button', { name: '다음 문제', exact: true }).click();
  await expect.poll(async () => (await currentGame(page, communicator))?.questionIndex).toBe(1);
  const saved = await currentGame(page, communicator);
  await page.getByRole('navigation').getByRole('button', { name: /그림으로 말하기/ }).click();
  await expect(page.locator('.workspace')).toBeVisible();
  await page.reload();
  await expect(page.getByText('저장된 문제부터 이어서 연습해요.')).toBeVisible();
  expect((await currentGame(page, communicator)).requestId).toBe(saved.requestId);
  for (let index = 1; index < 5; index += 1) {
    await answerQuestion(page, communicator, index);
    await page.getByRole('button', { name: index === 4 ? '연습 마치기' : '다음 문제', exact: true }).click();
  }
  await expect(page.getByRole('heading', { name: '연습을 마쳤어요!' })).toBeVisible();
  const progress = await (await request.get(apiPath('/learning/progress'), { headers: communicator.headers })).json();
  expect(progress.attempts).toBe(1);
  expect(progress.recent[0]).toMatchObject({ id: saved.requestId, correct_answers: 5, total_questions: 5 });
  const exported = await (await request.get(apiPath('/privacy/export'), { headers: communicator.headers })).json();
  expect(exported.communication_sessions).toEqual([]);
  await expect.poll(() => offlineValue(page, 'learning', `${communicator.id}:game`)).toBeUndefined();
});

test('오프라인 학습 완료 결과를 재연결 후 같은 요청 ID로 한 번만 반영한다', async ({ page, request, communicator }) => {
  await configureShortPractice(request, communicator);
  await login(page, communicator);
  await page.getByRole('navigation').getByRole('button', { name: '연습하기', exact: true }).click();
  await page.getByRole('button', { name: '연습 시작', exact: true }).click();
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
    window.dispatchEvent(new Event('offline'));
  });
  await page.route('**/api/**', route => route.abort('internetdisconnected'));
  const game = await currentGame(page, communicator);
  for (let index = 0; index < 5; index += 1) {
    await answerQuestion(page, communicator, index);
    await page.getByRole('button', { name: index === 4 ? '연습 마치기' : '다음 문제', exact: true }).click();
  }
  await expect(page.getByText('결과를 기기에 저장했습니다. 온라인 연결 후 자동으로 동기화합니다.', { exact: true })).toBeVisible();
  const queued = await offlineValue(page, 'learningAttempts');
  expect(queued).toHaveLength(1);
  expect(queued[0].request_id).toBe(game.requestId);
  await page.unroute('**/api/**');
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
    window.dispatchEvent(new Event('online'));
  });
  await expect.poll(async () => (await offlineValue(page, 'learningAttempts')).length).toBe(0);
  const replay = { ...queued[0] };
  delete replay.user_id;
  expect((await request.post(apiPath('/learning/attempts'), { headers: communicator.headers, data: replay })).ok()).toBe(true);
  const progress = await (await request.get(apiPath('/learning/progress'), { headers: communicator.headers })).json();
  expect(progress.attempts).toBe(1);
  expect(progress.recent[0].id).toBe(game.requestId);
});

test('발화 기록 동기화 실패 후 원문 없이 같은 이벤트를 재시도하고 중복을 제거한다', async ({ page, request, communicator }) => {
  await installSpeechStub(page);
  await login(page, communicator);
  await page.route('**/api/tts/events', route => route.abort('internetdisconnected'));
  await page.getByRole('button', { name: '도와주세요 바로 말하기', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__spokenTexts)).toContain('도와주세요');
  await expect.poll(async () => (await offlineValue(page, 'events')).length).toBe(1);
  const [queued] = await offlineValue(page, 'events');
  expect(Object.keys(queued).sort()).toEqual(['card_ids', 'event_type', 'id', 'occurred_at', 'user_id']);
  expect(queued.card_ids).toEqual(['help']);
  const batches = [];
  let allowSync = false;
  await page.route('**/api/offline/events/sync', async route => {
    batches.push(route.request().postDataJSON());
    if (!allowSync) await route.fulfill({ status: 503, json: { detail: '일시적인 연결 실패' } });
    else await route.continue();
  });
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  const retry = page.getByTestId('sync-status').getByRole('button', { name: '기록 동기화 다시 시도' });
  await expect(retry).toBeEnabled();
  await expect(page.getByTestId('sync-status')).toContainText('남은 1건은 기기에 보관됩니다.');
  expect(await offlineValue(page, 'events')).toHaveLength(1);
  allowSync = true;
  const acknowledged = page.waitForResponse(response => new URL(response.url()).pathname === '/api/offline/events/sync' && response.status() === 200);
  await retry.click();
  await acknowledged;
  await expect.poll(async () => (await offlineValue(page, 'events')).length, { timeout: 20000 }).toBe(0);
  expect(batches.length).toBeGreaterThanOrEqual(2);
  expect(batches.every(batch => JSON.stringify(batch) === JSON.stringify(batches[0]))).toBe(true);
  const response = await request.post(apiPath('/offline/events/sync'), { headers: communicator.headers, data: batches.at(-1) });
  expect(response.ok()).toBe(true);
  const exported = await (await request.get(apiPath('/privacy/export'), { headers: communicator.headers })).json();
  expect(exported.offline_events).toHaveLength(1);
  expect(exported.offline_events[0]._id).toBe(queued.id);
});

test('205건의 오프라인 이력을 API 한도에 맞춰 나누어 전송한다', async ({ page, request, communicator }) => {
  await login(page, communicator);
  await expect.poll(async () => Boolean(await offlineValue(page, 'snapshots', communicator.id))).toBe(true);
  await page.evaluate(async userId => {
    const database = await new Promise((resolve, reject) => {
      const open = indexedDB.open('pesc-mate-offline');
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    try {
      await new Promise((resolve, reject) => {
        const transaction = database.transaction('events', 'readwrite');
        const store = transaction.objectStore('events');
        for (let index = 0; index < 205; index += 1) store.put({
          id: crypto.randomUUID(), user_id: userId, event_type: 'immediate_speech', card_ids: ['help'],
          occurred_at: new Date(Date.now() - index * 1000).toISOString(),
        });
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
      });
    } finally { database.close(); }
  }, communicator.id);
  const batches = [];
  await page.route('**/api/offline/events/sync', async route => {
    batches.push(route.request().postDataJSON().events);
    await route.continue();
  });
  await page.evaluate(() => { window.dispatchEvent(new Event('online')); window.dispatchEvent(new Event('online')); });
  await expect.poll(async () => (await offlineValue(page, 'events')).length, { timeout: 20000 }).toBe(0);
  expect(batches.map(batch => batch.length)).toEqual([100, 100, 5]);
  const exported = await (await request.get(apiPath('/privacy/export'), { headers: communicator.headers })).json();
  expect(exported.offline_events).toHaveLength(205);
  expect(new Set(exported.offline_events.map(event => event._id)).size).toBe(205);
});

test('보호자가 등록한 개인 PNG 카드를 고정 카드판에 배치하면 아동 화면에 반영된다', async ({ page, request, communicator }) => {
  const caregiverHeaders = await linkCaregiver(request, communicator);
  await request.post(apiPath('/auth/logout'), { headers: caregiverHeaders });
  await login(page, { username: 'caregiver', password: 'caregiver1234' });
  await page.getByLabel('지원할 사용자').selectOption(communicator.id);
  await page.getByRole('navigation').getByRole('button', { name: '개인 카드 관리', exact: true }).click();
  await page.getByRole('button', { name: '+ 개인 카드 등록', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '개인 카드 등록' });
  const label = '검증 연필';
  await dialog.getByLabel('카드명').fill(label);
  await dialog.getByLabel('카드 뜻').fill('글씨를 쓰는 도구');
  await dialog.getByLabel('카테고리').selectOption({ index: 1 });
  const image = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 160; canvas.height = 160;
    const context = canvas.getContext('2d');
    context.fillStyle = '#ffd75f'; context.fillRect(0, 0, 160, 160);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await dialog.getByLabel('카드 이미지').setInputFiles({ name: '검증_연필.png', mimeType: 'image/png', buffer: Buffer.from(image, 'base64') });
  const savedResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/cards/submissions' && response.request().method() === 'POST');
  await dialog.getByRole('button', { name: '카드 저장', exact: true }).click();
  const saved = await savedResponse;
  expect(saved.status()).toBe(201);
  const card = await saved.json();
  expect(card).toMatchObject({ label, visibility: 'private', status: 'approved', owner_id: communicator.id, image_content_type: 'image/webp' });
  await expect(dialog).toBeHidden();
  await page.getByRole('navigation').getByRole('button', { name: '빠른 표현·카드판', exact: true }).click();
  const slots = page.locator('.board-config-grid article').filter({ has: page.getByRole('heading', { name: /고정 카드 슬롯/ }) });
  // The initial board can already contain the maximum 30 slots.
  await slots.locator('.config-order-list li').last().getByRole('button', { name: /제외$/ }).click();
  const choice = slots.locator('.config-card-options').getByRole('button', { name: label });
  await choice.click();
  await expect(choice).toHaveAttribute('aria-pressed', 'true');
  const saveLayout = page.waitForResponse(response => new URL(response.url()).pathname === '/api/board/layout/slots' && response.request().method() === 'PUT');
  await slots.getByRole('button', { name: '카드판 저장', exact: true }).click();
  const layoutResponse = await saveLayout;
  expect(layoutResponse.ok()).toBe(true);
  const savedLayout = await layoutResponse.json();
  const cardId = savedLayout.available_cards.find(item => item.label === label)?.id;
  expect(cardId).toBeTruthy();
  expect(savedLayout.slots.some(slot => slot.card_id === cardId)).toBe(true);
  await page.getByRole('button', { name: '로그아웃', exact: true }).click();
  await login(page, communicator);
  await page.getByRole('navigation').getByRole('button', { name: /그림으로 말하기/ }).click();
  await page.getByRole('textbox', { name: '카드 검색' }).fill(label);
  const cardButton = page.locator('.workspace').getByRole('button', { name: `${label} 문장에 담기`, exact: true });
  await expect(cardButton).toBeVisible();
  await cardButton.click();
  await expect(page.locator('.board ol li')).toContainText(label);
  const layout = await (await request.get(apiPath('/board/layout'), { headers: communicator.headers })).json();
  expect(layout.slots.some(slot => slot.card_id === cardId)).toBe(true);
});
