import { test, expect, login, installSpeechStub } from './workflow-fixtures.js';

test.use({ serviceWorkers: 'block' });

// Use actual sequential keyboard navigation, never locator.focus() or click().
async function tabTo(page, target) {
  for (let count = 0; count < 180; count += 1) {
    if (await target.evaluate(element => element === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  await expect(target).toBeFocused();
}

test('키보드만으로 로그인·본문 이동·카드 선택·순서 변경·발화·삭제를 완료한다', async ({ page, communicator }) => {
  await installSpeechStub(page);
  await page.goto('/');
  await tabTo(page, page.getByLabel('아이디'));
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type(communicator.username);
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('비밀번호', { exact: true })).toBeFocused();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type(communicator.password);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: '로그아웃' })).toBeVisible();
  await tabTo(page, page.getByRole('link', { name: '본문 바로가기' }));
  await page.keyboard.press('Enter');
  await expect(page.locator('#main-content')).toBeFocused();
  await tabTo(page, page.getByRole('navigation', { name: '주 메뉴' }).getByRole('button', { name: /그림으로 말하기/ }));
  await page.keyboard.press('Enter');
  const workspace = page.locator('.workspace');
  const board = workspace.locator('.board');
  const selection = page.getByRole('group', { name: '출력 방식' }).getByRole('button', { name: '선택 카드 그대로', exact: true });
  await tabTo(page, selection);
  await page.keyboard.press('Space');
  await expect(selection).toHaveAttribute('aria-pressed', 'true');
  for (const label of ['나', '물']) {
    const card = workspace.getByRole('button', { name: `${label} 문장에 담기`, exact: true });
    await tabTo(page, card);
    await page.keyboard.press('Enter');
  }
  await expect(board.getByRole('list', { name: '선택한 카드' }).getByRole('listitem')).toHaveCount(2);
  await tabTo(page, board.getByRole('button', { name: '2번째 카드 앞으로' }));
  await page.keyboard.press('Enter');
  // At the start boundary the backwards control is disabled, so focus uses the next enabled control.
  await expect(board.getByRole('button', { name: '1번째 카드 뒤로' })).toBeFocused();
  await expect(board.getByRole('listitem').locator('span')).toHaveText(['💧 물', '🙋 나']);
  await tabTo(page, board.getByRole('button', { name: /선택 카드 그대로 말하기/ }));
  await page.keyboard.press('Space');
  await expect.poll(() => page.evaluate(() => window.__spokenTexts)).toContain('물 나');
  await tabTo(page, board.getByRole('button', { name: '2번째 카드 삭제' }));
  await page.keyboard.press('Enter');
  await expect(board.getByRole('button', { name: '1번째 카드 삭제' })).toBeFocused();
  await page.keyboard.press('Enter');
  const heading = board.getByRole('heading', { name: /나의 문장/ });
  await expect(heading).toBeFocused();
  await expect(heading).toBeInViewport();
  expect(await heading.evaluate(element => getComputedStyle(element).outlineStyle)).not.toBe('none');
});

test('독립 듣기 버튼의 이름·크기·간격과 카드 선택 상태를 확인한다', async ({ page, communicator }) => {
  await installSpeechStub(page);
  await login(page, communicator);
  const menu = page.getByRole('navigation', { name: '주 메뉴' });
  await menu.getByRole('button', { name: /그림으로 말하기/ }).click();
  const workspace = page.locator('.workspace');
  const card = workspace.getByRole('button', { name: '물 문장에 담기', exact: true });
  const listen = workspace.getByRole('button', { name: '물 단어 듣기', exact: true });
  await expect(listen).toHaveJSProperty('tagName', 'BUTTON');
  await expect(page.locator('button button, button [role="button"]')).toHaveCount(0);
  await tabTo(page, card);
  await page.keyboard.press('Tab');
  await expect(listen).toBeFocused();
  await expect(listen).toBeInViewport();
  const selectBox = await card.boundingBox();
  const listenBox = await listen.boundingBox();
  expect(listenBox.width).toBeGreaterThanOrEqual(44);
  expect(listenBox.height).toBeGreaterThanOrEqual(44);
  expect(listenBox.y - (selectBox.y + selectBox.height)).toBeGreaterThanOrEqual(8);
  await page.keyboard.press('Space');
  await expect.poll(() => page.evaluate(() => window.__spokenTexts)).toContain('물');
  await expect(workspace.locator('.board').getByRole('listitem')).toHaveCount(0);
  await page.keyboard.press('Shift+Tab');
  await expect(card).toBeFocused();
  await menu.getByRole('button', { name: '카드', exact: true }).click();
  const catalog = page.locator('.catalog-grid');
  const first = catalog.locator('.catalog-card').first();
  await expect(first).toHaveAttribute('aria-pressed', 'false');
  await first.click();
  await expect(first).toHaveAttribute('aria-pressed', 'true');
  const second = catalog.locator('.catalog-card').nth(1);
  await second.click();
  await expect(first).toHaveAttribute('aria-pressed', 'false');
  await expect(second).toHaveAttribute('aria-pressed', 'true');
  // Listening to a different card must not change the selected detail card.
  await catalog.locator('.card-speaker').first().click();
  await expect(second).toHaveAttribute('aria-pressed', 'true');
});

test('좁은 화면과 두 배 글자 크기에서도 카드·문장 조작을 유지한다', async ({ page, communicator }) => {
  await page.setViewportSize({ width: 640, height: 900 });
  await login(page, communicator);
  await page.getByRole('navigation', { name: '주 메뉴' }).getByRole('button', { name: /그림으로 말하기/ }).click();
  // CSS text enlargement is a regression check, NOT a native 200% browser zoom certification.
  await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
  const workspace = page.locator('.workspace');
  const card = workspace.getByRole('button', { name: '물 문장에 담기', exact: true });
  await card.click();
  const remove = workspace.getByRole('button', { name: '1번째 카드 삭제' });
  await remove.scrollIntoViewIfNeeded();
  await expect(remove).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await tabTo(page, remove);
  await page.keyboard.press('Enter');
  await expect(workspace.locator('.board').getByRole('heading', { name: /나의 문장/ })).toBeFocused();
});
