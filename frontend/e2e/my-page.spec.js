import { test, expect, apiPath, login, installSpeechStub } from './workflow-fixtures.js';

test.use({ serviceWorkers: 'block' });

test('마이페이지는 키보드 초점·선택 카드를 유지하며 좁은 화면에서 설정을 저장하고 복원한다', async ({ page, request, communicator }) => {
  await installSpeechStub(page);
  await login(page, communicator);
  await page.getByRole('navigation', { name: '주 메뉴' }).getByRole('button', { name: /그림으로 말하기/ }).click();
  await page.locator('.workspace').getByRole('button', { name: '물 문장에 담기', exact: true }).click();
  const trigger = page.getByRole('button', { name: /마이페이지 열기/ });
  await trigger.focus(); await page.keyboard.press('Enter');
  const modal = page.getByRole('dialog', { name: '마이페이지' });
  await expect(modal).toBeVisible();
  expect(await modal.evaluate(element => element.matches(':modal'))).toBe(true);
  await expect(modal.getByRole('button', { name: '마이페이지 닫기' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  expect(await modal.evaluate(element => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(modal).toHaveCount(0); await expect(trigger).toBeFocused();
  await page.keyboard.press('Enter');
  await modal.getByRole('radio', { name: '블루', exact: true }).check();
  const profileSaved = page.waitForResponse(response => new URL(response.url()).pathname === '/api/profile'
    && response.request().method() === 'PUT');
  await modal.getByRole('button', { name: '프로필 저장' }).click();
  expect((await profileSaved).status()).toBe(200);
  await expect(modal.getByText('프로필을 저장했습니다.', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await modal.getByRole('button', { name: '접근 설정', exact: true }).click();
  await modal.getByLabel('카드 표시').selectOption('image');
  await modal.getByLabel('카드 크기').selectOption('large');
  await modal.getByLabel('고대비 표시').check();
  const accessSaved = page.waitForResponse(response => new URL(response.url()).pathname === '/api/accessibility/settings'
    && response.request().method() === 'PUT');
  await modal.getByRole('button', { name: '설정 저장' }).click();
  expect((await accessSaved).status()).toBe(200);
  await expect(modal.getByRole('button', { name: '저장됨' })).toBeDisabled();
  expect(await modal.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await modal.evaluate(element => { element.scrollTop = 0; });
  const menuButton = await modal.getByRole('button', { name: '프로필 설정', exact: true }).boundingBox();
  expect(menuButton.width).toBeGreaterThanOrEqual(120);
  expect(menuButton.height).toBeLessThan(70);
  const heading = await modal.locator('.my-page-heading').boundingBox();
  expect(menuButton.y).toBeGreaterThanOrEqual(heading.y + heading.height);
  await page.screenshot({ path: 'test-results/my-page-mobile.png' });
  await modal.getByRole('button', { name: '음성 설정', exact: true }).click();
  await modal.getByLabel('음성 느낌').selectOption('man');
  const voiceSaved = page.waitForResponse(response => new URL(response.url()).pathname === '/api/tts/settings'
    && response.request().method() === 'PUT');
  await modal.getByRole('button', { name: '설정 저장' }).click();
  expect((await voiceSaved).status()).toBe(200);
  await expect(modal.getByRole('button', { name: '저장됨' })).toBeDisabled();
  await modal.getByRole('button', { name: '보호자 설정', exact: true }).click();
  await expect(modal.getByRole('heading', { name: '개인정보와 열람 권한' })).toBeVisible();
  expect(await modal.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await modal.getByRole('button', { name: '마이페이지 닫기' }).click();
  const board = page.locator('.board');
  await expect(board.getByRole('listitem')).toHaveCount(1);
  await expect(board.getByRole('listitem')).toContainText('물');
  await expect(page.locator('.app')).toHaveClass(/high-contrast/);
  const settings = await (await request.get(apiPath('/accessibility/settings'), { headers: communicator.headers })).json();
  expect(settings.display_mode).toBe('image'); expect(settings.card_size).toBe('large'); expect(settings.high_contrast).toBe(true);
  await page.reload();
  await page.getByRole('button', { name: /마이페이지 열기/ }).click();
  await expect(modal.getByRole('radio', { name: '블루', exact: true })).toBeChecked();
  await modal.getByRole('button', { name: '접근 설정', exact: true }).click();
  await expect(modal.getByLabel('카드 표시')).toHaveValue('image');
  await modal.getByRole('button', { name: '음성 설정', exact: true }).click();
  await expect(modal.getByLabel('음성 느낌')).toHaveValue('man');
});
