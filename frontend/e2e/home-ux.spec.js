import { test, expect, login, installSpeechStub } from './workflow-fixtures.js';

test.use({ serviceWorkers: 'block' });

async function settlePictures(page) {
  await page.locator('img:visible').evaluateAll(images => Promise.allSettled(images.map(image => image.decode())));
  await page.locator('.expression-visual, .topic-pictures .mini-card, .workspace .card-art').evaluateAll(elements =>
    Promise.allSettled(elements.map(element => {
      const url = getComputedStyle(element).backgroundImage.match(/^url\(["']?(.*?)["']?\)$/)?.[1];
      if (!url) return Promise.resolve();
      const image = new Image(); image.src = url; return image.decode();
    })));
}

test('홈 활동과 주제 탐색은 말하기로 이어지고 태블릿·모바일에서도 주요 조작을 유지한다', async ({ page, communicator }) => {
  await installSpeechStub(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await login(page, communicator);
  const home = page.getByRole('region', { name: '어떤 이야기를 해볼까요?' });
  await expect(home.getByRole('button')).toHaveCount(3);
  const activities = await home.boundingBox();
  const quick = await page.locator('.quick-speech').boundingBox();
  expect(activities.y + activities.height).toBeLessThanOrEqual(quick.y);
  await expect(home.getByRole('button', { name: '말하기 시작' })).toBeInViewport();
  await expect(page.getByRole('button', { name: '카드 리더기 열기', exact: true })).toBeVisible();
  const sidebar = await page.locator('.sidebar').boundingBox();
  await settlePictures(page);
  await page.screenshot({ path: 'test-results/ux-home-desktop.png' });
  const firstTopic = page.locator('.topic-grid > button').first();
  const category = (await firstTopic.getAttribute('aria-label')).replace(/ 카드 살펴보기$/, '');
  await firstTopic.click();
  await expect(page.locator('.categories').getByRole('button', { name: category, exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.locator('.catalog-card').first().click();
  await page.getByRole('button', { name: '문장에 사용하기', exact: true }).click();
  const board = page.locator('.board');
  await expect(board.getByRole('listitem')).toHaveCount(1);
  const selected = await board.getByRole('listitem').textContent();
  await settlePictures(page);
  await page.screenshot({ path: 'test-results/ux-speaking-desktop.png' });
  const afterSidebar = await page.locator('.sidebar').boundingBox();
  expect(afterSidebar.x).toBe(sidebar.x); expect(afterSidebar.width).toBe(sidebar.width);
  await page.getByRole('navigation', { name: '주 메뉴' }).getByRole('button', { name: '홈', exact: true }).click();
  await page.getByRole('button', { name: /고른 카드 1장으로 이어서 말하기/ }).click();
  await expect(board.getByRole('listitem')).toHaveText(selected);
  expect(await page.evaluate(() => window.__spokenTexts)).toEqual([]);
  await page.getByRole('navigation', { name: '주 메뉴' }).getByRole('button', { name: '홈', exact: true }).click();
  for (const viewport of [{ width: 834, height: 1112, name: 'tablet' }, { width: 390, height: 844, name: 'mobile' }]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await home.getByRole('button', { name: '말하기 시작' }).scrollIntoViewIfNeeded();
    await expect(home.getByRole('button', { name: '말하기 시작' })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    if (viewport.name === 'mobile') {
      const homeTab = await page.getByRole('navigation', { name: '주 메뉴' }).getByRole('button', { name: '홈', exact: true }).boundingBox();
      expect(homeTab.width).toBeLessThan(viewport.width / 2);
    }
    await page.screenshot({ path: `test-results/ux-home-${viewport.name}.png` });
  }
  await page.getByRole('button', { name: /마이페이지 열기/ }).click();
  await expect(page.getByRole('dialog', { name: '마이페이지' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: /마이페이지 열기/ })).toBeFocused();
});
