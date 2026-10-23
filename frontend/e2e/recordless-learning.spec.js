import { test, expect, apiPath, login, installSpeechStub, offlineValue } from './workflow-fixtures.js';

test.use({ serviceWorkers: 'block' });
test('동의 없는 소리 연습은 끝까지 진행하되 결과·진행·대기열·발화 기록을 만들지 않는다', async ({ page, request, communicator }) => {
  expect((await request.put(apiPath('/privacy/settings'), { headers: communicator.headers,
    data: { guardian_consent: false, retention_days: 365 },
  })).ok()).toBe(true);
  await installSpeechStub(page); await login(page, communicator);
  const writes = [];
  page.on('request', outgoing => { if (/\/api\//.test(outgoing.url()) && ['POST', 'PATCH'].includes(outgoing.method())) writes.push(new URL(outgoing.url()).pathname); });
  await page.getByRole('navigation').getByRole('button', { name: '연습하기', exact: true }).click();
  await page.getByLabel('연습 종류').selectOption('sound_picture_match');
  await page.getByRole('button', { name: '연습 시작', exact: true }).click();
  for (let index = 0; index < 10; index += 1) {
    await page.getByRole('button', { name: '문제 소리 듣기' }).click();
    await expect.poll(() => page.evaluate(() => window.__spokenTexts.length)).toBe(index + 1);
    const label = await page.evaluate(() => window.__spokenTexts.at(-1));
    await page.getByRole('group', { name: '카드 보기' }).getByRole('button', { name: label, exact: true }).click();
    await page.getByRole('button', { name: index === 9 ? '연습 마치기' : '다음 문제', exact: true }).click();
  }
  await expect(page.getByText('기록 없이 연습했어요. 결과는 서버나 기기에 저장하지 않았습니다.', { exact: true })).toBeVisible();
  expect(writes).toEqual([]);
  expect(await offlineValue(page, 'learning', `${communicator.id}:game`)).toBeUndefined();
  expect(await offlineValue(page, 'learningAttempts')).toEqual([]);
  const exported = await (await request.get(apiPath('/privacy/export'), { headers: communicator.headers })).json();
  for (const key of ['communication_sessions', 'learning_attempts', 'tts_events', 'offline_events']) expect(exported[key]).toEqual([]);
});
