import { test, expect, apiPath, login, linkCaregiver, offlineValue } from './workflow-fixtures.js';

test.use({ serviceWorkers: 'block' });
async function configure(request, communicator, headers, revision, operation, fields) {
  const response = await request.put(apiPath(`/board/layout/situations?user_id=${communicator.id}`), {
    headers, data: { expected_revision: revision, operation, ...fields },
  });
  expect(response.status()).toBe(200); return response.json();
}
async function baseSlots(request, communicator, headers) {
  const before = await (await request.get(apiPath('/board/layout'), { headers: communicator.headers })).json();
  const response = await request.put(apiPath(`/board/layout/slots?user_id=${communicator.id}`), {
    headers, data: { expected_revision: before.revision, card_ids: ['help', 'water'] },
  });
  expect(response.status()).toBe(200); return response.json();
}
const waitSave = page => page.waitForResponse(response => new URL(response.url()).pathname === '/api/board/layout/situations' && response.request().method() === 'PUT');

test('보호자는 위치만 복사해 상황을 독립 편집·삭제하고 원래 카드와 기본 보드를 보존한다', async ({ page, request, communicator }) => {
  const headers = await linkCaregiver(request, communicator);
  const initial = await baseSlots(request, communicator, headers);
  await request.post(apiPath('/auth/logout'), { headers });
  await login(page, { username: 'caregiver', password: 'caregiver1234' });
  await page.getByLabel('지원할 사용자').selectOption(communicator.id);
  await page.getByRole('navigation').getByRole('button', { name: '빠른 표현·카드판', exact: true }).click();
  const manager = page.getByRole('article', { name: '상황별 카드판 관리', exact: true });
  await manager.getByLabel('기본 상황 이름').selectOption('집');
  await manager.getByLabel('복사할 위치와 새 상황 이름을 확인했습니다').check();
  let response = waitSave(page);
  await manager.getByRole('button', { name: '확인한 카드판으로 상황 만들기' }).click();
  const home = (await (await response).json()).situations[0];
  await manager.getByLabel('기본 상황 이름').selectOption('학교');
  await manager.getByLabel('복사할 카드판').selectOption(home.id);
  await manager.getByLabel('복사할 위치와 새 상황 이름을 확인했습니다').check();
  response = waitSave(page);
  await manager.getByRole('button', { name: '확인한 카드판으로 상황 만들기' }).click();
  const school = (await (await response).json()).situations[1];
  await manager.getByLabel('편집할 상황').selectOption(school.id);
  const editor = manager.getByRole('article', { name: '상황 슬롯 편집', exact: true });
  await editor.getByRole('button', { name: '물 앞으로', exact: true }).click();
  await expect(editor.getByRole('button', { name: '확인한 상황 저장' })).toBeDisabled();
  await manager.getByLabel('이 상황의 이름과 변경할 슬롯 순서를 확인했습니다').check();
  response = waitSave(page); await editor.getByRole('button', { name: '확인한 상황 저장' }).click();
  const edited = await (await response).json();
  expect(edited.slots).toEqual(initial.slots); expect(edited.situations[0]).toEqual(home);
  expect(edited.situations[1].slots.map(slot => slot.card_id)).toEqual(['water', 'help']);
  await manager.getByLabel('학교 상황 구성만 삭제하는 것을 확인했습니다').check();
  response = waitSave(page); await manager.getByRole('button', { name: '선택한 상황만 삭제' }).click();
  const removed = await (await response).json(); expect(removed.situations).toEqual([home]);
  expect(removed.slots).toEqual(initial.slots);
  expect(removed.available_cards.map(card => card.id)).toEqual(initial.available_cards.map(card => card.id));
});

test('아동은 확인 후에만 상황을 바꾸고 오프라인·다시 접속에서도 저장된 보드를 사용할 수 있다', async ({ page, request, communicator }) => {
  const headers = await linkCaregiver(request, communicator);
  const initial = await baseSlots(request, communicator, headers);
  const first = await configure(request, communicator, headers, initial.revision, 'create', { name: '집' });
  const home = first.situations[0];
  const configured = await configure(request, communicator, headers, first.revision, 'update', {
    situation_id: home.id, name: '집', card_ids: ['water', 'help'],
  });
  await request.post(apiPath('/auth/logout'), { headers });
  await login(page, communicator);
  await expect.poll(async () => (await offlineValue(page, 'snapshots', communicator.id))?.board_layout?.situations?.length).toBe(1);
  await page.getByRole('navigation').getByRole('button', { name: /그림으로 말하기/ }).click();
  const picker = page.getByRole('region', { name: '상황 카드판 전환' });
  const labels = () => page.locator('#card-library .cards .card').evaluateAll(elements => elements.map(element => element.getAttribute('aria-label')));
  const original = await labels(); expect(original[0]).toContain('도와주세요');
  await page.getByRole('button', { name: '선택 카드 그대로', exact: true }).click();
  await page.getByRole('button', { name: '도와주세요 문장에 담기', exact: true }).click();
  const phrase = await page.getByRole('list', { name: '선택한 카드', exact: true }).textContent();
  await picker.locator('summary').click();
  await picker.getByLabel('사용할 상황 카드판').selectOption(home.id);
  expect(await labels()).toEqual(original);
  await picker.getByLabel('바뀔 카드판과 위치를 확인했어요').check();
  await picker.getByRole('button', { name: '확인한 상황 카드판 사용' }).click();
  expect((await labels())[0]).toContain('물');
  expect(await page.getByRole('list', { name: '선택한 카드', exact: true }).textContent()).toBe(phrase);
  const current = await (await request.get(apiPath('/board/layout'), { headers: communicator.headers })).json();
  expect(current.revision).toBe(configured.revision); expect(current.slots).toEqual(initial.slots);
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
    window.dispatchEvent(new Event('offline'));
  });
  await page.route('**/api/**', route => route.abort('internetdisconnected'));
  await picker.getByLabel('사용할 상황 카드판').selectOption('default');
  await picker.getByLabel('바뀔 카드판과 위치를 확인했어요').check();
  await picker.getByRole('button', { name: '확인한 상황 카드판 사용' }).click();
  expect((await labels())[0]).toContain('도와주세요');
  await page.reload();
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
    window.dispatchEvent(new Event('offline'));
  });
  await page.getByRole('navigation').getByRole('button', { name: /그림으로 말하기/ }).click();
  const restored = page.getByRole('region', { name: '상황 카드판 전환' });
  await restored.locator('summary').click(); await restored.getByLabel('사용할 상황 카드판').selectOption(home.id);
  await restored.getByLabel('바뀔 카드판과 위치를 확인했어요').check();
  await restored.getByRole('button', { name: '확인한 상황 카드판 사용' }).click();
  expect((await labels())[0]).toContain('물');
});
