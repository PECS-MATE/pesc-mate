import { randomUUID } from 'node:crypto';
import { test, expect, apiPath, login } from './workflow-fixtures.js';

test.use({ serviceWorkers: 'block' });
const caregiver = { username: 'caregiver', password: 'caregiver1234' };

async function linkForRecords(request, communicator, permissions) {
  const response = await request.post(apiPath('/support/links'), {
    headers: communicator.headers, data: { username: caregiver.username, permissions },
  });
  expect(response.ok()).toBe(true);
}

async function selectChild(page, communicator) {
  await login(page, caregiver);
  await page.getByLabel('지원할 사용자').selectOption(communicator.id);
}

test('보호자는 의사소통·학습 탭에서 실제로 분리된 집계와 키보드 전환을 확인한다', async ({ page, request, communicator }) => {
  await linkForRecords(request, communicator, ['records_read', 'learning_manage']);
  const result = await request.post(apiPath('/learning/attempts'), {
    headers: communicator.headers, data: {
      request_id: randomUUID(), activity_type: 'word_picture_match', category_id: 'food',
      total_questions: 1, correct_answers: 0, duration_seconds: 2,
      items: [{ card_id: 'apple', label: '사과', first_try_correct: false }],
    },
  });
  expect(result.status()).toBe(201);
  const recordReads = [];
  page.on('request', request => {
    const url = new URL(request.url());
    if (/^\/api\/(dashboard|learning)\b/.test(url.pathname)) recordReads.push(url);
  });
  await selectChild(page, communicator);
  expect(recordReads).toHaveLength(0);
  await page.getByRole('navigation', { name: '주 메뉴' }).getByRole('button', { name: '의사소통 기록', exact: true }).click();
  const communication = page.getByRole('tabpanel', { name: '의사소통 기록', exact: true });
  await expect(communication.locator('.metrics')).toContainText('저장한 문장0개');
  await expect(communication.locator('.metrics')).toContainText('사용한 카드0장');
  expect(recordReads.map(url => url.pathname)).toEqual(['/api/dashboard']);
  await page.getByRole('tab', { name: '의사소통 기록', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: '학습 기록', exact: true })).toBeFocused();
  const learning = page.getByRole('tabpanel', { name: '학습 기록', exact: true });
  await expect(learning.locator('.learning-metrics').locator('div').first()).toHaveText('1참여 횟수');
  await expect(learning).toContainText('의사소통 능력의 평가나 진단이 아닙니다.');
  expect(recordReads.every(url => url.searchParams.get('user_id') === communicator.id)).toBe(true);
  expect(recordReads.map(url => url.pathname)).toEqual(['/api/dashboard', '/api/learning/settings', '/api/learning/progress']);
  await page.keyboard.press('Home');
  await expect(page.getByRole('tab', { name: '의사소통 기록', exact: true })).toBeFocused();
  await expect(communication.locator('.metrics')).toContainText('저장한 문장0개');
});

for (const [permission, allowed, denied, deniedPaths] of [
  ['records_read', '의사소통 기록', '학습 기록', ['/learning/settings', '/learning/progress']],
  ['learning_manage', '학습 기록', '의사소통 기록', ['/dashboard']],
]) {
  test(`${permission} 연결 권한만 있으면 다른 기록 탭과 API는 허용하지 않는다`, async ({ page, request, communicator }) => {
    await linkForRecords(request, communicator, [permission]);
    const blockedRequests = [];
    page.on('request', request => {
      const url = new URL(request.url());
      if (deniedPaths.some(path => url.pathname === `/api${path}`)) blockedRequests.push(url);
    });
    await selectChild(page, communicator);
    await page.getByRole('navigation', { name: '주 메뉴' }).getByRole('button', { name: allowed, exact: true }).click();
    await expect(page.getByRole('tabpanel', { name: allowed, exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: new RegExp(denied) })).toBeDisabled();
    await expect(page.getByRole('navigation', { name: '주 메뉴' }).getByRole('button', { name: denied, exact: true })).toHaveCount(0);
    expect(blockedRequests).toHaveLength(0);
    const token = await page.evaluate(() => localStorage.getItem('pesc-mate-token'));
    for (const path of deniedPaths) {
      const response = await request.get(apiPath(`${path}?user_id=${communicator.id}`), {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(response.status()).toBe(403);
    }
  });
}
