import { test, expect, apiPath, login, installSpeechStub, offlineValue } from './workflow-fixtures.js';

test.use({ serviceWorkers: 'block' });
test('동의가 없거나 미저장 상태여도 기록 없이 말하고 저장한 동의는 다음 로그인에 유지된다', async ({ page, request, communicator }) => {
  expect((await request.put(apiPath('/privacy/settings'), { headers: communicator.headers,
    data: { guardian_consent: false, retention_days: 365 },
  })).ok()).toBe(true);
  await installSpeechStub(page); await login(page, communicator);
  await expect(page.getByRole('navigation', { name: '주 메뉴' }).getByRole('button', { name: '개인정보', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '개인정보와 열람 권한' })).toHaveCount(0);
  const writes = [];
  page.on('request', outgoing => { if (/\/api\//.test(outgoing.url()) && ['POST', 'PATCH'].includes(outgoing.method())) writes.push(new URL(outgoing.url()).pathname); });
  await page.getByRole('navigation').getByRole('button', { name: /그림으로 말하기/ }).click();
  await page.getByRole('button', { name: '물 문장에 담기', exact: true }).click();
  await page.getByRole('button', { name: '선택 카드 그대로 말하기' }).click();
  await expect.poll(() => page.evaluate(() => window.__spokenTexts)).toContain('물');
  expect(writes).toEqual([]);
  expect(await page.evaluate(id => localStorage.getItem(`pesc-mate-board:${id}`), communicator.id)).toBeNull();
  expect(await offlineValue(page, 'events')).toEqual([]);
  await page.getByRole('button', { name: /마이페이지 열기/ }).click();
  await page.getByRole('button', { name: '보호자 설정', exact: true }).click();
  await page.getByLabel('법정대리인이 개인정보 수집·이용에 동의했음을 확인합니다.').check();
  await page.getByRole('button', { name: '마이페이지 닫기' }).click();
  await page.getByRole('navigation').getByRole('button', { name: /그림으로 말하기/ }).click();
  await page.getByRole('button', { name: '도와주세요 바로 말하기', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__spokenTexts)).toContain('도와주세요');
  expect(writes).toEqual([]);
  const state = await (await request.get(apiPath('/privacy/settings'), { headers: communicator.headers })).json();
  expect(state.guardian_consent).toBe(false);
  // Cached false consent must also avoid a redirect or accidental recording after reload offline.
  await page.route('**/api/**', route => route.abort('internetdisconnected'));
  await page.reload();
  await page.getByRole('navigation').getByRole('button', { name: /그림으로 말하기/ }).click();
  await expect(page.getByText(/기록 없이 말하기/)).toBeVisible();
  await page.getByRole('button', { name: '물 문장에 담기', exact: true }).click();
  await page.getByRole('button', { name: '선택 카드 그대로 말하기' }).click();
  await expect.poll(() => page.evaluate(() => window.__spokenTexts)).toContain('물');
  expect(writes).toEqual([]);
  await page.unroute('**/api/**'); await page.reload();
  await page.getByRole('button', { name: /마이페이지 열기/ }).click();
  await page.getByRole('button', { name: '보호자 설정', exact: true }).click();
  await page.getByLabel('법정대리인이 개인정보 수집·이용에 동의했음을 확인합니다.').check();
  const saving = page.waitForResponse(response => new URL(response.url()).pathname === '/api/privacy/settings' && response.request().method() === 'PUT');
  await page.getByRole('button', { name: '동의 및 기간 저장' }).click();
  expect((await saving).status()).toBe(200);
  await page.getByRole('button', { name: '마이페이지 닫기' }).click();
  await page.getByRole('button', { name: '로그아웃', exact: true }).click();
  await login(page, communicator);
  await expect(page.getByRole('heading', { name: '개인정보와 열람 권한' })).toHaveCount(0);
  const saved = await (await request.get(apiPath('/privacy/settings'), { headers: communicator.headers })).json();
  expect(saved.guardian_consent).toBe(true);
});
