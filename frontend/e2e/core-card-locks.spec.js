import { test, expect, apiPath, login, linkCaregiver } from './workflow-fixtures.js';

test('핵심 카드 잠금은 이웃 이동·제외와 사진 교체를 막고 명시 해제로 복구한다', async ({ page, request, communicator }) => {
  const data = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 160;
    const context = canvas.getContext('2d'); context.fillStyle = '#5577bb'; context.fillRect(0, 0, 160, 160);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  const image = { name: '검증_잠금_연필.png', mimeType: 'image/png', buffer: Buffer.from(data, 'base64') };
  const categories = await (await request.get(apiPath('/categories'), { headers: communicator.headers })).json();
  const created = await request.post(apiPath('/cards/submissions'), { headers: communicator.headers, multipart: {
    label: '검증 잠금 연필', meaning: '글씨를 쓰는 연필', category: categories[0].name, visibility: 'private', image,
  } });
  expect(created.status()).toBe(201); const card = await created.json();
  const headers = await linkCaregiver(request, communicator);
  const before = await (await request.get(apiPath('/board/layout'), { headers: communicator.headers })).json();
  expect((await request.put(apiPath(`/board/layout/slots?user_id=${communicator.id}`), { headers,
    data: { expected_revision: before.revision, card_ids: ['help', 'custom:' + card.id, 'water'] },
  })).ok()).toBe(true);
  await login(page, { username: 'caregiver', password: 'caregiver1234' });
  await page.getByLabel('지원할 사용자').selectOption(communicator.id);
  await page.getByRole('navigation').getByRole('button', { name: '빠른 표현·카드판', exact: true }).click();
  const locks = page.getByRole('article', { name: '핵심 카드 잠금 관리' });
  await locks.getByLabel('검증 잠금 연필', { exact: true }).check();
  await expect(locks.getByRole('button', { name: '핵심 잠금 저장' })).toBeDisabled();
  await locks.getByLabel('잠금 또는 해제가 사진·위치 보호에 미치는 영향을 확인했습니다').check();
  const response = page.waitForResponse(response => new URL(response.url()).pathname === '/api/board/layout/locks' && response.request().method() === 'PUT');
  await locks.getByRole('button', { name: '핵심 잠금 저장' }).click();
  expect((await response).status()).toBe(200);
  const slots = page.getByRole('article', { name: '고정 카드 슬롯 편집' });
  for (const name of ['검증 잠금 연필 앞으로', '검증 잠금 연필 뒤로', '검증 잠금 연필 제외', '도와주세요 뒤로', '도와주세요 제외', '물 앞으로']) {
    await expect(slots.getByRole('button', { name, exact: true })).toBeDisabled();
  }
  const rejected = await request.put(apiPath(`/cards/submissions/${card.id}/image`), { headers,
    multipart: { user_id: communicator.id, expected_revision: '0', image },
  });
  expect(rejected.status()).toBe(409);
  const locked = await (await request.get(apiPath('/board/layout'), { headers: communicator.headers })).json();
  expect(locked.locked_card_ids).toEqual(['custom:' + card.id]);
  await locks.getByLabel('검증 잠금 연필', { exact: true }).uncheck();
  await locks.getByLabel('잠금 또는 해제가 사진·위치 보호에 미치는 영향을 확인했습니다').check();
  const unlockedResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/board/layout/locks' && response.request().method() === 'PUT');
  await locks.getByRole('button', { name: '핵심 잠금 저장' }).click();
  expect((await unlockedResponse).status()).toBe(200);
  await expect(slots.getByRole('button', { name: '검증 잠금 연필 앞으로', exact: true })).toBeEnabled();
  const replaced = await request.put(apiPath(`/cards/submissions/${card.id}/image`), { headers,
    multipart: { user_id: communicator.id, expected_revision: '0', image },
  });
  expect(replaced.status()).toBe(200); expect((await replaced.json()).image_revision).toBe(1);
  const after = await (await request.get(apiPath('/board/layout'), { headers: communicator.headers })).json();
  expect(after.slots).toEqual(locked.slots); expect(after.locked_card_ids).toEqual([]);
  const audits = await (await request.get(apiPath('/board/layout/audit'), { headers: communicator.headers })).json();
  expect(audits.filter(row => row.action === 'core_card_locks_changed')).toHaveLength(2);
});
