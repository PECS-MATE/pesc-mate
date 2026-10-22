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
