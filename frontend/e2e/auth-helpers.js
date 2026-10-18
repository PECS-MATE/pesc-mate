import { expect } from './fixtures.js';

export async function login(page, account) {
  await page.goto('/');
  await page.getByLabel('아이디').fill(account.username);
  await page.getByLabel('비밀번호', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  // Both the initial profile screen and the main screen have ONE logout button.
  // An .or(profileHeading) locator would match two elements on first login.
  await expect(page.getByRole('button', { name: '로그아웃', exact: true })).toBeVisible();
  const initialProfile = page.getByRole('heading', { name: '처음 사용할 프로필을 골라 주세요', exact: true });
  if (await initialProfile.isVisible()) {
    // Until presets load, the only radio is "직접 등록". Never select by position.
    const preset = page.getByRole('radio', { name: '핑크', exact: true });
    await preset.check();
    await expect(preset).toBeChecked();
    const save = page.getByRole('button', { name: '프로필 저장', exact: true });
    await expect(save).toBeEnabled();
    const [saved] = await Promise.all([
      page.waitForResponse(response => new URL(response.url()).pathname === '/api/profile'
        && response.request().method() === 'PUT'),
      save.click(),
    ]);
    expect(saved.ok()).toBe(true);
    await expect(initialProfile).toBeHidden();
  }
  await expect(page.getByRole('navigation', { name: '주 메뉴' })).toBeVisible();
  await expect(page.getByText('서비스 연결됨', { exact: true })).toBeVisible();
}
