import { test, expect, apiPath, login, linkCaregiver } from './workflow-fixtures.js';

test('개인 사진 일괄 등록은 실패 항목만 재시도하며 고정 카드판을 변경하지 않는다', async ({ page, request, communicator }) => {
  const caregiver = await linkCaregiver(request, communicator);
  await request.post(apiPath('/auth/logout'), { headers: caregiver });
  const before = await (await request.get(apiPath('/board/layout'), { headers: communicator.headers })).json();
  await login(page, { username: 'caregiver', password: 'caregiver1234' });
  await page.getByLabel('지원할 사용자').selectOption(communicator.id);
  await page.getByRole('navigation').getByRole('button', { name: '개인 카드 관리', exact: true }).click();
  await page.locator('.bulk-card-import summary').click();
  const panel = page.getByRole('region', { name: '사진 일괄 등록' });
  const image = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 160; canvas.height = 160;
    const context = canvas.getContext('2d');
    context.fillStyle = '#ffd75f'; context.fillRect(0, 0, 160, 160);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await panel.getByLabel('사진 여러 장 선택').setInputFiles(['검증_일괄_연필.png', '검증_일괄_공책.png'].map(name => ({
    name, mimeType: 'image/png', buffer: Buffer.from(image, 'base64'),
  })));
  await expect(panel.getByLabel('카드명 1')).toHaveValue('검증 일괄 연필');
  await expect(panel.getByRole('img')).toHaveCount(2);
  await panel.getByLabel('공통 카테고리').selectOption({ index: 1 });
  await panel.getByRole('button', { name: '미등록 항목에 분류 적용' }).click();
  const labels = [];
  await page.route('**/api/cards/submissions', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    const label = route.request().postDataBuffer().toString('utf8').match(/name="label"\r\n\r\n([^\r]+)/)?.[1];
    labels.push(label);
    if (labels.length === 2) return route.fulfill({ status: 422, json: { detail: '합성 일시 거절' } });
    return route.continue();
  });
  await panel.getByRole('button', { name: '등록 가능한 2개 저장' }).click();
  await expect(panel.getByText('합성 일시 거절', { exact: true })).toBeVisible();
  await expect(panel.getByText('저장 완료', { exact: true })).toHaveCount(1);
  await panel.getByRole('button', { name: '등록 가능한 1개 저장' }).click();
  await expect(panel.getByText('저장 완료', { exact: true })).toHaveCount(2);
  expect(labels).toEqual(['검증 일괄 연필', '검증 일괄 공책', '검증 일괄 공책']);
  const cards = await (await request.get(apiPath('/cards/submissions'), { headers: communicator.headers })).json();
  expect(cards).toHaveLength(2);
  expect(cards.map(card => card.label).sort()).toEqual(['검증 일괄 공책', '검증 일괄 연필']);
  for (const card of cards) expect(card).toMatchObject({ visibility: 'private', owner_id: communicator.id, status: 'approved' });
  const after = await (await request.get(apiPath('/board/layout'), { headers: communicator.headers })).json();
  expect(after.slots).toEqual(before.slots);
  expect(after.revision).toBe(before.revision);
});

test('사진 보정 미리보기의 설정으로 화면용 이미지만 자르고 회전·밝기를 적용한다', async ({ page, request, communicator }) => {
  const caregiver = await linkCaregiver(request, communicator);
  await request.post(apiPath('/auth/logout'), { headers: caregiver });
  await login(page, { username: 'caregiver', password: 'caregiver1234' });
  await page.getByLabel('지원할 사용자').selectOption(communicator.id);
  await page.getByRole('navigation').getByRole('button', { name: '개인 카드 관리', exact: true }).click();
  await page.locator('.bulk-card-import summary').click();
  const panel = page.getByRole('region', { name: '사진 일괄 등록' });
  const original = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 384; canvas.height = 128;
    const context = canvas.getContext('2d');
    for (const [index, color] of ['#c80000', '#787878', '#0000c8'].entries()) {
      context.fillStyle = color; context.fillRect(index * 128, 0, 128, 128);
    }
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await panel.getByLabel('사진 여러 장 선택').setInputFiles({
    name: '검증_보정사진.png', mimeType: 'image/png', buffer: Buffer.from(original, 'base64'),
  });
  await panel.getByLabel('공통 카테고리').selectOption({ index: 1 });
  await panel.getByRole('button', { name: '미등록 항목에 분류 적용' }).click();
  await panel.getByLabel('1번 사진 중앙 정사각형 자르기').check();
  await panel.getByRole('button', { name: '1번 사진 오른쪽 90도 회전' }).click();
  await panel.getByLabel('1번 사진 밝기', { exact: true }).fill('125');
  await expect(panel.getByRole('img')).toHaveCSS('filter', 'brightness(1.25)');
  let submitted = '';
  // Chromium may omit multipart file data from a response's request metadata.
  // Observe the outgoing request via interception, as in the retry workflow above.
  await page.route('**/api/cards/submissions', async route => {
    if (route.request().method() === 'POST') submitted = route.request().postDataBuffer()?.toString('utf8') || '';
    await route.continue();
  });
  const saving = page.waitForResponse(response => new URL(response.url()).pathname === '/api/cards/submissions'
    && response.request().method() === 'POST');
  await panel.getByRole('button', { name: '등록 가능한 1개 저장' }).click();
  const response = await saving;
  expect(response.status()).toBe(201);
  expect(submitted).toContain('"crop":"square","rotation":90,"brightness":125');
  const card = await response.json();
  await expect(panel.getByText('저장 완료', { exact: true })).toBeVisible();
  const served = await request.get(apiPath(card.image_url.replace(/^\/api/, '')), { headers: communicator.headers });
  expect(served.ok()).toBe(true);
  expect(served.headers()['content-type']).toBe('image/webp');
  const data = await served.body();
  const dimensions = await page.evaluate(async bytes => {
    const image = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/webp' }));
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d'); context.drawImage(image, 0, 0); image.close();
    return { width: canvas.width, height: canvas.height, pixel: [...context.getImageData(64, 64, 1, 1).data] };
  }, [...data]);
  expect(dimensions.width).toBe(128); expect(dimensions.height).toBe(128);
  for (const channel of dimensions.pixel.slice(0, 3)) { expect(channel).toBeGreaterThan(140); expect(channel).toBeLessThan(160); }
  expect(dimensions.pixel[3]).toBe(255);
});
