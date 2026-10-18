import { test, expect, apiPath, login } from './workflow-fixtures.js';

test.use({ serviceWorkers: 'block', profilePreset: null });

test('최초 로그인은 지연된 프로필 목록을 기다리고 순서와 무관하게 지정 프리셋을 저장한다', async ({ page, request, communicator }) => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/api/profile/presets', async route => {
    await gate;
    // Keep direct upload available while loading; pink deliberately is NOT first.
    await route.fulfill({ json: [{ id: 'blue', label: '블루' }, { id: 'pink', label: '핑크' }] });
  });
  const signingIn = login(page, communicator);
  try {
    await expect(page.getByRole('heading', { name: '처음 사용할 프로필을 골라 주세요' })).toBeVisible();
    await expect(page.getByRole('button', { name: '로그아웃', exact: true })).toBeVisible();
    await expect(page.getByRole('radio', { name: '직접 등록', exact: true })).toBeVisible();
    await expect(page.getByRole('radio', { name: '핑크', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '프로필 저장', exact: true })).toBeDisabled();
  } finally {
    release();
    // Always observe the helper promise, including if an assertion above fails.
    await signingIn;
  }
  const stored = await request.get(apiPath('/auth/me'), { headers: communicator.headers });
  expect(stored.ok()).toBe(true);
  expect((await stored.json()).profile).toEqual({ kind: 'preset', preset: 'pink', image_url: null });
});

test.describe('프로필이 이미 저장된 계정', () => {
  test.use({ profilePreset: 'blue' });
  test('로그인은 기존 프로필을 덮어쓰거나 초기 설정을 다시 요청하지 않는다', async ({ page, request, communicator }) => {
    const profileRequests = [];
    page.on('request', outgoing => {
      const path = new URL(outgoing.url()).pathname;
      if (path === '/api/profile/presets' || (path === '/api/profile' && outgoing.method() === 'PUT')) profileRequests.push(path);
    });
    await login(page, communicator);
    await expect(page.getByRole('heading', { name: '처음 사용할 프로필을 골라 주세요' })).toHaveCount(0);
    const stored = await request.get(apiPath('/auth/me'), { headers: communicator.headers });
    expect(stored.ok()).toBe(true);
    expect((await stored.json()).profile).toEqual({ kind: 'preset', preset: 'blue', image_url: null });
    expect(profileRequests).toEqual([]);
  });
});
