import { test, expect, apiPath, login, linkCaregiver } from './workflow-fixtures.js';

test('개인 카드 사진만 교체해도 카드 ID와 문구·위치·발화 설정은 유지된다', async ({ page, request, communicator }) => {
  const images = await page.evaluate(() => ['#ddaa33', '#3377cc'].map((color, index) => {
    const canvas = document.createElement('canvas'); canvas.width = 160 + index * 32; canvas.height = 160;
    const context = canvas.getContext('2d'); context.fillStyle = color; context.fillRect(0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png').split(',')[1];
  }));
  const categories = await (await request.get(apiPath('/categories'), { headers: communicator.headers })).json();
  const created = await request.post(apiPath('/cards/submissions'), { headers: communicator.headers, multipart: {
    label: '검증 사진 교체 연필', meaning: '그림을 그리는 연필', category: categories[0].name, visibility: 'private',
    image: { name: '원래_연필.png', mimeType: 'image/png', buffer: Buffer.from(images[0], 'base64') },
  } });
  expect(created.status()).toBe(201);
  const initial = await created.json();
  // Compare persisted values: BSON stores timestamps at millisecond precision.
  const card = (await (await request.get(apiPath('/cards/submissions'), { headers: communicator.headers })).json()).find(item => item.id === initial.id);
  const caregiver = await linkCaregiver(request, communicator);
  const before = await (await request.get(apiPath('/board/layout'), { headers: communicator.headers })).json();
  const configured = await request.put(apiPath(`/board/layout/slots?user_id=${communicator.id}`), {
    headers: caregiver, data: { expected_revision: before.revision, card_ids: ['custom:' + card.id] },
  });
  expect(configured.ok()).toBe(true);
  const layout = await (await request.get(apiPath('/board/layout'), { headers: communicator.headers })).json();
  const voice = await (await request.get(apiPath('/tts/settings'), { headers: communicator.headers })).json();
  const imageBefore = await request.get(apiPath(card.image_url.replace(/^\/api/, '')), { headers: communicator.headers });
  await request.post(apiPath('/auth/logout'), { headers: caregiver });
  await login(page, { username: 'caregiver', password: 'caregiver1234' });
  await page.getByLabel('지원할 사용자').selectOption(communicator.id);
  await page.getByRole('navigation').getByRole('button', { name: '개인 카드 관리', exact: true }).click();
  await page.getByRole('button', { name: '검증 사진 교체 연필 사진 교체', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '개인 카드 사진 교체' });
  await expect(dialog.getByRole('button', { name: '사진만 교체 저장' })).toBeDisabled();
  await dialog.getByLabel('교체할 사진').setInputFiles({
    name: '새_연필.png', mimeType: 'image/png', buffer: Buffer.from(images[1], 'base64'),
  });
  await expect(dialog.getByRole('img', { name: '교체할 사진 미리보기' })).toBeVisible();
  const saving = page.waitForResponse(response => new URL(response.url()).pathname === `/api/cards/submissions/${card.id}/image`
    && response.request().method() === 'PUT');
  await dialog.getByRole('button', { name: '사진만 교체 저장' }).click();
  const response = await saving; expect(response.status()).toBe(200);
  await expect(dialog).toHaveCount(0);
  const saved = await response.json();
  for (const key of ['id', 'label', 'meaning', 'category', 'visibility', 'status', 'owner_id', 'created_at']) expect(saved[key]).toEqual(card[key]);
  expect(saved.image_revision).toBe(1);
  expect(saved.thumbnail_url).not.toBe(card.thumbnail_url);
  const imageAfter = await request.get(apiPath(saved.image_url.replace(/^\/api/, '')), { headers: communicator.headers });
  expect(imageAfter.headers().etag).not.toBe(imageBefore.headers().etag);
  expect(await imageAfter.body()).not.toEqual(await imageBefore.body());
  const afterLayout = await (await request.get(apiPath('/board/layout'), { headers: communicator.headers })).json();
  for (const key of ['slots', 'quick_expression_ids', 'recovery_expression_ids', 'revision', 'updated_at']) expect(afterLayout[key]).toEqual(layout[key]);
  expect(await (await request.get(apiPath('/tts/settings'), { headers: communicator.headers })).json()).toEqual(voice);
});
