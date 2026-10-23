import { test, expect, apiPath, login, configureShortPractice, offlineValue, installSpeechStub } from './workflow-fixtures.js';

test.use({ serviceWorkers: 'block' });
const current = async (page, account) => (await offlineValue(page, 'learning', `${account.id}:game`))?.game;
async function listenAndAnswer(page, account, index) {
  const game = await current(page, account); const target = game.questions[index].target;
  const options = page.getByRole('group', { name: '카드 보기' });
  await expect(options.getByRole('button', { name: target.label, exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '문제 소리 듣기' }).click();
  await expect(options.getByRole('button', { name: target.label, exact: true })).toBeEnabled();
  await options.getByRole('button', { name: target.label, exact: true }).click();
  await expect(page.getByText('잘 찾았어요! 다음 문제로 가 볼까요?', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: index === 4 ? '연습 마치기' : '다음 문제', exact: true }).click();
}

test('소리 카드 연습은 문제를 명시 재생하고 새로고침 후 같은 활동으로 재개해 학습에만 저장한다', async ({ page, request, communicator }) => {
  await configureShortPractice(request, communicator); await installSpeechStub(page); await login(page, communicator);
  await page.getByRole('navigation').getByRole('button', { name: '연습하기', exact: true }).click();
  await page.getByLabel('연습 종류').selectOption('sound_picture_match');
  await page.getByRole('button', { name: '연습 시작', exact: true }).click();
  await expect.poll(async () => (await current(page, communicator))?.activity_type).toBe('sound_picture_match');
  expect(await page.evaluate(() => window.__spokenTexts)).toEqual([]);
  await listenAndAnswer(page, communicator, 0);
  await expect.poll(async () => (await current(page, communicator))?.questionIndex).toBe(1);
  const identity = (await current(page, communicator)).requestId;
  await page.reload(); await expect(page.getByText('저장된 문제부터 이어서 연습해요.')).toBeVisible();
  expect((await current(page, communicator)).requestId).toBe(identity);
  for (let index = 1; index < 5; index += 1) await listenAndAnswer(page, communicator, index);
  await expect(page.getByRole('heading', { name: '연습을 마쳤어요!' })).toBeVisible();
  const exported = await (await request.get(apiPath('/privacy/export'), { headers: communicator.headers })).json();
  expect(exported.communication_sessions).toEqual([]); expect(exported.tts_events).toEqual([]); expect(exported.offline_events).toEqual([]);
  expect(exported.learning_attempts).toHaveLength(1);
  expect(exported.learning_attempts[0]).toMatchObject({ _id: identity, activity_type: 'sound_picture_match', content_version: 'sound-picture-v1', correct_answers: 5 });
});

test('소리 카드 연습을 오프라인에서 마치면 같은 버전과 요청 ID로 한 번 동기화한다', async ({ page, request, communicator }) => {
  await configureShortPractice(request, communicator); await installSpeechStub(page); await login(page, communicator);
  await page.getByRole('navigation').getByRole('button', { name: '연습하기', exact: true }).click();
  await page.getByLabel('연습 종류').selectOption('sound_picture_match');
  await page.getByRole('button', { name: '연습 시작', exact: true }).click();
  await expect.poll(async () => (await current(page, communicator))?.questions?.length).toBe(5);
  const identity = (await current(page, communicator)).requestId;
  await page.evaluate(() => { Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false }); window.dispatchEvent(new Event('offline')); });
  await page.route('**/api/**', route => route.abort('internetdisconnected'));
  for (let index = 0; index < 5; index += 1) await listenAndAnswer(page, communicator, index);
  await expect(page.getByText('결과를 기기에 저장했습니다. 온라인 연결 후 자동으로 동기화합니다.', { exact: true })).toBeVisible();
  const queued = await offlineValue(page, 'learningAttempts'); expect(queued).toHaveLength(1);
  expect(queued[0]).toMatchObject({ request_id: identity, activity_type: 'sound_picture_match', content_version: 'sound-picture-v1' });
  await page.unroute('**/api/**');
  await page.evaluate(() => { Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true }); window.dispatchEvent(new Event('online')); });
  await expect.poll(async () => (await offlineValue(page, 'learningAttempts')).length).toBe(0);
  const progress = await (await request.get(apiPath('/learning/progress'), { headers: communicator.headers })).json();
  expect(progress.attempts).toBe(1); expect(progress.recent[0]).toMatchObject({ id: identity, activity_type: 'sound_picture_match', content_version: 'sound-picture-v1' });
});

test('문제 음성은 마지막 말에 넣지 않고 긴급 발화가 대체한 뒤 화면을 나가도 중단하지 않는다', async ({ page, communicator }) => {
  await installSpeechStub(page); await login(page, communicator);
  await page.evaluate(() => {
    window.__cancelCalls = 0;
    window.speechSynthesis.cancel = () => { window.__cancelCalls += 1; };
    window.speechSynthesis.speak = utterance => { window.__spokenTexts.push(utterance.text); utterance.onstart?.(); };
  });
  await page.getByRole('navigation').getByRole('button', { name: '연습하기', exact: true }).click();
  await page.getByLabel('연습 종류').selectOption('sound_picture_match');
  await page.getByRole('button', { name: '연습 시작', exact: true }).click();
  await page.getByRole('button', { name: '문제 소리 듣기' }).click();
  await expect(page.getByRole('button', { name: '마지막 말 다시 듣기', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '도와주세요 바로 말하기', exact: true }).click();
  const cancels = await page.evaluate(() => window.__cancelCalls);
  await page.getByRole('navigation').getByRole('button', { name: /그림으로 말하기/ }).click();
  expect(await page.evaluate(() => window.__cancelCalls)).toBe(cancels);
  await expect(page.locator('.speech-player')).toContainText('도와주세요');
  await expect(page.getByRole('button', { name: '마지막 말 다시 듣기', exact: true })).toBeEnabled();
});
