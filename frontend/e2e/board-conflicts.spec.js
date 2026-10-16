import { test, expect, apiPath, login, linkCaregiver } from './workflow-fixtures.js';

async function openBoard(page, childId) {
  await login(page, { username: 'caregiver', password: 'caregiver1234' });
  await page.getByLabel('지원할 사용자').selectOption(childId);
  await page.getByRole('navigation').getByRole('button', { name: '빠른 표현·카드판', exact: true }).click();
  await expect(page.getByRole('group', { name: '카드판 구성 편집' })).toBeEnabled();
}

const quickEditor = page => page.locator('.board-config-grid article').filter({ has: page.getByRole('heading', { name: /^빠른 표현/ }) });
const saveResponse = page => page.waitForResponse(response => new URL(response.url()).pathname === '/api/board/layout/quick-expressions' && response.request().method() === 'PUT');

test('두 기기의 카드판 수정 충돌을 막고 초안을 보존한 뒤 최신 버전으로 다시 저장한다', async ({ page, browser, request, communicator }) => {
  const headers = await linkCaregiver(request, communicator);
  await request.post(apiPath('/auth/logout'), { headers });
  await openBoard(page, communicator.id);
  const second = await browser.newContext({ baseURL: new URL(page.url()).origin });
  try {
    const otherPage = await second.newPage();
    await openBoard(otherPage, communicator.id);
    const firstQuick = quickEditor(page);
    const secondQuick = quickEditor(otherPage);
    await firstQuick.getByRole('button', { name: '아파요 뒤로', exact: true }).click();
    const firstResponse = saveResponse(page);
    await firstQuick.getByRole('button', { name: '빠른 표현 저장', exact: true }).click();
    const first = await firstResponse;
    expect(first.status()).toBe(200);
    const firstLayout = await first.json();
    expect(firstLayout.revision).toBe(1);

    await secondQuick.getByRole('button', { name: '도와주세요 앞으로', exact: true }).click();
    const draft = await secondQuick.locator('.config-order-list').innerText();
    const staleResponse = saveResponse(otherPage);
    await secondQuick.getByRole('button', { name: '빠른 표현 저장', exact: true }).click();
    expect((await staleResponse).status()).toBe(409);
    await expect(otherPage.getByTestId('board-conflict')).toContainText('현재 편집 내용은 화면에 남아 있으며 저장하지 않았습니다.');
    expect(await secondQuick.locator('.config-order-list').innerText()).toBe(draft);
    await expect(secondQuick.getByRole('button', { name: '빠른 표현 저장', exact: true })).toBeDisabled();
    const current = await (await request.get(apiPath('/board/layout'), { headers: communicator.headers })).json();
    expect(current.quick_expression_ids).toEqual(firstLayout.quick_expression_ids);
    expect(current.revision).toBe(1);

    await otherPage.getByRole('button', { name: '최신 카드판 불러오기', exact: true }).click();
    await expect(otherPage.getByTestId('board-conflict')).toHaveCount(0);
    await expect(secondQuick.locator('.config-order-list li').first()).toContainText('싫어요');
    await secondQuick.getByRole('button', { name: '도와주세요 앞으로', exact: true }).click();
    const retryResponse = saveResponse(otherPage);
    await secondQuick.getByRole('button', { name: '빠른 표현 저장', exact: true }).click();
    const retried = await retryResponse;
    expect(retried.status()).toBe(200);
    expect((await retried.json()).revision).toBe(2);
    const audit = await (await request.get(apiPath('/board/layout/audit'), { headers: communicator.headers })).json();
    expect(audit).toHaveLength(2);
    expect(audit.map(item => [item.before_revision, item.after_revision]).sort()).toEqual([[0, 1], [1, 2]]);
  } finally { await second.close(); }
});
