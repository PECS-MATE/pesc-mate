import { randomUUID } from 'node:crypto';
import { test, expect, apiPath } from './workflow-fixtures.js';

test.use({ serviceWorkers: 'block' });

test('랜딩은 먼저 소개를 보여 주고 입력 초점·반응형 화면·로그인 복원과 로그아웃을 연결한다', async ({ page, communicator }) => {
  const writes = [];
  page.on('request', outgoing => { if (new URL(outgoing.url()).pathname.startsWith('/api/') && outgoing.method() !== 'GET') writes.push(outgoing.method()); });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  const title = page.getByRole('heading', { level: 1, name: /그림을 고르고/ });
  await expect(title).toBeInViewport();
  await expect(page.getByLabel('아이디')).not.toBeFocused();
  expect(writes).toEqual([]);
  await page.locator('.landing-hero img').evaluateAll(images => Promise.allSettled(images.map(image => image.decode())));
  const firstStep = page.locator('.landing-steps > li').first();
  const [number, stepTitle, explanation] = await Promise.all([
    firstStep.locator(':scope > span').boundingBox(), firstStep.getByRole('heading').boundingBox(), firstStep.locator('p').boundingBox(),
  ]);
  expect(stepTitle.y).toBeGreaterThanOrEqual(number.y + number.height);
  expect(explanation.y).toBeGreaterThanOrEqual(stepTitle.y + stepTitle.height);
  await page.screenshot({ path: 'test-results/landing-desktop.png', fullPage: true });
  for (const viewport of [{ width: 834, height: 1112, name: 'tablet' }, { width: 390, height: 844, name: 'mobile' }]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await expect(title).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/landing-${viewport.name}.png` });
  }
  const question = page.getByText('카드 리더기가 꼭 필요한가요?', { exact: true });
  await question.click();
  await expect(question.locator('..')).toHaveAttribute('open', '');
  await page.getByRole('link', { name: '시작하기', exact: false }).first().click();
  await expect(page.getByLabel('이름', { exact: true })).toBeFocused();
  await expect(page.getByRole('checkbox')).not.toBeChecked();
  await page.getByRole('link', { name: '로그인', exact: true }).click();
  await expect(page.getByLabel('아이디')).toBeFocused();
  await expect(page.getByLabel('아이디')).toBeInViewport();
  await page.getByLabel('아이디').fill(communicator.username);
  await page.getByLabel('비밀번호', { exact: true }).fill(communicator.password);
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  const home = page.getByRole('heading', { level: 1, name: '오늘은 무엇을 해볼까요?' });
  await expect(home).toBeInViewport();
  await expect(title).toHaveCount(0);
  await page.reload();
  await expect(home).toBeInViewport();
  await expect(title).toHaveCount(0);
  await page.getByRole('button', { name: '로그아웃', exact: true }).click();
  await expect(title).toBeInViewport();
});

test('랜딩의 시작하기에서 명시 동의 후 가입하고 최초 프로필을 선택해 앱으로 진입한다', async ({ page, request }) => {
  const username = `e2e_${randomUUID().replaceAll('-', '').slice(0, 20)}`;
  let headers;
  try {
    await page.goto('/');
    await page.getByRole('link', { name: /나의 소통 공간 만들기/ }).click();
    await page.getByLabel('이름', { exact: true }).fill('랜딩 검증 사용자');
    await page.getByLabel('아이디').fill(username);
    await page.getByLabel('비밀번호', { exact: true }).fill('E2e-test-1234');
    await page.getByLabel('비밀번호 확인', { exact: true }).fill('E2e-test-1234');
    const consent = page.getByRole('checkbox');
    await expect(consent).not.toBeChecked();
    expect(await consent.evaluate(element => element.validity.valueMissing)).toBe(true);
    await consent.check();
    const signingUp = page.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/register' && response.request().method() === 'POST');
    await page.getByRole('button', { name: '가입하고 시작하기', exact: true }).click();
    const response = await signingUp;
    const session = await response.json();
    if (session.access_token) headers = { Authorization: `Bearer ${session.access_token}` };
    expect(response.status()).toBe(201);
    await expect(page.getByRole('heading', { name: '처음 사용할 프로필을 골라 주세요', exact: true })).toBeInViewport();
    await page.getByRole('radio', { name: '핑크', exact: true }).check();
    const saving = page.waitForResponse(result => new URL(result.url()).pathname === '/api/profile' && result.request().method() === 'PUT');
    await page.getByRole('button', { name: '프로필 저장' }).click();
    expect((await saving).status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1, name: '오늘은 무엇을 해볼까요?' })).toBeInViewport();
  } finally {
    if (headers) {
      expect((await request.delete(apiPath('/privacy/data'), { headers, data: { confirmation: 'DELETE' } })).ok()).toBe(true);
      expect((await request.post(apiPath('/auth/logout'), { headers })).ok()).toBe(true);
    }
  }
});
