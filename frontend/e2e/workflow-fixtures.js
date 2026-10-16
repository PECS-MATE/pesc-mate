import { randomUUID } from 'node:crypto';
import { test as base, expect } from './fixtures.js';

export const apiPath = path => `${process.env.E2E_API_BASE_URL || ''}/api${path}`;

export const test = base.extend({
  communicator: async ({ request }, use) => {
    const account = { username: `e2e_${randomUUID().replaceAll('-', '').slice(0, 20)}`, password: 'E2e-test-1234' };
    const registration = await request.post(apiPath('/auth/register'), {
      data: { ...account, name: '자동 검증 사용자', guardian_consent: true },
    });
    expect(registration.status()).toBe(201);
    const session = await registration.json();
    const headers = { Authorization: `Bearer ${session.access_token}` };
    try {
      expect((await request.put(apiPath('/profile'), { headers, data: { preset: 'pink' } })).ok()).toBe(true);
      await use({ ...account, id: session.user.id, headers });
    } finally {
      // Only this test's newly registered user's content is removed.
      await request.delete(apiPath('/privacy/data'), { headers, data: { confirmation: 'DELETE' } });
      await request.post(apiPath('/auth/logout'), { headers });
    }
  },
});

export async function login(page, account) {
  await page.goto('/');
  await page.getByLabel('아이디').fill(account.username);
  await page.getByLabel('비밀번호', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await expect(page.getByRole('button', { name: '로그아웃' })).toBeVisible();
  const profile = page.getByRole('heading', { name: '처음 사용할 프로필을 골라 주세요' });
  if (await profile.isVisible()) {
    await page.getByRole('radio').first().check();
    await page.getByRole('button', { name: '프로필 저장' }).click();
  }
  await expect(page.getByRole('navigation', { name: '주 메뉴' })).toBeVisible();
}

export async function linkCaregiver(request, communicator) {
  const response = await request.post(apiPath('/auth/login'), {
    data: { username: 'caregiver', password: 'caregiver1234' },
  });
  expect(response.ok()).toBe(true);
  const session = await response.json();
  const linked = await request.post(apiPath('/support/links'), {
    headers: communicator.headers,
    data: { username: 'caregiver', permissions: ['cards_manage', 'board_manage', 'quick_speech_manage', 'learning_manage'] },
  });
  expect(linked.ok()).toBe(true);
  return { Authorization: `Bearer ${session.access_token}` };
}

export async function configureShortPractice(request, communicator) {
  const headers = await linkCaregiver(request, communicator);
  const categories = await (await request.get(apiPath('/categories'), { headers: communicator.headers })).json();
  const response = await request.put(apiPath(`/learning/settings?user_id=${communicator.id}`), {
    headers, data: { category_ids: categories.map(category => category.id), question_count: 5,
      option_count: 3, repeat_frequency: 1, time_limit_seconds: 60, retry_enabled: true },
  });
  expect(response.ok()).toBe(true);
  await request.post(apiPath('/auth/logout'), { headers });
}

export async function offlineValue(page, store, key) {
  return page.evaluate(async ({ store, key }) => {
    const database = await new Promise((resolve, reject) => {
      const open = indexedDB.open('pesc-mate-offline');
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    try {
      return await new Promise((resolve, reject) => {
        const read = database.transaction(store).objectStore(store);
        const result = key === undefined ? read.getAll() : read.get(key);
        result.onsuccess = () => resolve(result.result);
        result.onerror = () => reject(result.error);
      });
    } finally { database.close(); }
  }, { store, key });
}

export async function installSpeechStub(page) {
  await page.addInitScript(() => {
    window.__spokenTexts = [];
    class Utterance { constructor(text) { this.text = text; } }
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: Utterance });
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
      getVoices: () => [{ name: '테스트 한국어', lang: 'ko-KR', localService: true }],
      speak: utterance => {
        window.__spokenTexts.push(utterance.text);
        queueMicrotask(() => { utterance.onstart?.(); utterance.onend?.(); });
      },
      cancel() {}, pause() {}, resume() {}, addEventListener() {}, removeEventListener() {},
    } });
  });
}

export { expect };
