import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test, expect, apiPath, login, installSpeechStub } from './workflow-fixtures.js';

test.use({ serviceWorkers: 'block' });
const caregiver = { username: 'caregiver', password: 'caregiver1234' };

async function linkForRecords(request, communicator, permissions) {
  const response = await request.post(apiPath('/support/links'), {
    headers: communicator.headers, data: { username: caregiver.username, permissions },
  });
  expect(response.ok()).toBe(true);
}

async function selectChild(page, communicator) {
  await login(page, caregiver);
  await page.getByLabel('지원할 사용자').selectOption(communicator.id);
}

test('보호자는 의사소통·학습 탭에서 실제로 분리된 집계와 키보드 전환을 확인한다', async ({ page, request, communicator }) => {
  await linkForRecords(request, communicator, ['records_read', 'learning_manage']);
  const result = await request.post(apiPath('/learning/attempts'), {
    headers: communicator.headers, data: {
      request_id: randomUUID(), activity_type: 'word_picture_match', category_id: 'food',
      total_questions: 1, correct_answers: 0, duration_seconds: 2,
      items: [{ card_id: 'apple', label: '사과', first_try_correct: false }],
    },
  });
  expect(result.status()).toBe(201);
  const recordReads = [];
  page.on('request', request => {
    const url = new URL(request.url());
    if (/^\/api\/(dashboard|learning)\b/.test(url.pathname)) recordReads.push(url);
  });
  await selectChild(page, communicator);
  expect(recordReads).toHaveLength(0);
  await page.getByRole('navigation', { name: '주 메뉴' }).getByRole('button', { name: '의사소통 기록', exact: true }).click();
  const communication = page.getByRole('tabpanel', { name: '의사소통 기록', exact: true });
  await expect(communication.locator('.metrics')).toContainText('저장한 문장0개');
  await expect(communication.locator('.metrics')).toContainText('사용한 카드0장');
  expect(recordReads.map(url => url.pathname)).toEqual(['/api/dashboard']);
  await page.getByRole('tab', { name: '의사소통 기록', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: '학습 기록', exact: true })).toBeFocused();
  const learning = page.getByRole('tabpanel', { name: '학습 기록', exact: true });
  await expect(learning.locator('.learning-metrics').locator('div').first()).toHaveText('1참여 횟수');
  await expect(learning).toContainText('의사소통 능력의 평가나 진단이 아닙니다.');
  expect(recordReads.every(url => url.searchParams.get('user_id') === communicator.id)).toBe(true);
  expect(recordReads.map(url => url.pathname)).toEqual(['/api/dashboard', '/api/learning/settings', '/api/learning/progress']);
  await page.keyboard.press('Home');
  await expect(page.getByRole('tab', { name: '의사소통 기록', exact: true })).toBeFocused();
  await expect(communication.locator('.metrics')).toContainText('저장한 문장0개');
});

for (const [permission, allowed, denied, deniedPaths] of [
  ['records_read', '의사소통 기록', '학습 기록', ['/learning/settings', '/learning/progress']],
  ['learning_manage', '학습 기록', '의사소통 기록', ['/dashboard']],
]) {
  test(`${permission} 연결 권한만 있으면 다른 기록 탭과 API는 허용하지 않는다`, async ({ page, request, communicator }) => {
    await linkForRecords(request, communicator, [permission]);
    const blockedRequests = [];
    page.on('request', request => {
      const url = new URL(request.url());
      if (deniedPaths.some(path => url.pathname === `/api${path}`)) blockedRequests.push(url);
    });
    await selectChild(page, communicator);
    await page.getByRole('navigation', { name: '주 메뉴' }).getByRole('button', { name: allowed, exact: true }).click();
    await expect(page.getByRole('tabpanel', { name: allowed, exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: new RegExp(denied) })).toBeDisabled();
    await expect(page.getByRole('navigation', { name: '주 메뉴' }).getByRole('button', { name: denied, exact: true })).toHaveCount(0);
    expect(blockedRequests).toHaveLength(0);
    const token = await page.evaluate(() => localStorage.getItem('pesc-mate-token'));
    for (const path of deniedPaths) {
      const response = await request.get(apiPath(`${path}?user_id=${communicator.id}`), {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(response.status()).toBe(403);
    }
  });
}

test('보호자는 카드 조합·재생성 타임라인과 영역별 JSON·CSV 다운로드를 확인한다', async ({ page, request, communicator }) => {
  await linkForRecords(request, communicator, ['records_read', 'learning_manage']);
  const sentence = await request.post(apiPath('/sentences'), {
    headers: communicator.headers, data: { request_id: randomUUID(), cards: ['water', 'drink', 'water'] },
  });
  expect(sentence.ok()).toBe(true);
  const original = await sentence.json();
  const regenerated = await request.post(apiPath(`/sentences/${original.id}/regenerate`), {
    headers: communicator.headers, data: { request_id: randomUUID() },
  });
  expect(regenerated.ok()).toBe(true);
  await selectChild(page, communicator);
  await page.getByRole('navigation', { name: '주 메뉴' }).getByRole('button', { name: '의사소통 기록', exact: true }).click();
  const panel = page.getByRole('tabpanel', { name: '의사소통 기록', exact: true });
  await expect(panel.getByText('재생성 1회차 · 규칙 기반')).toBeVisible();
  await expect(panel.getByText(`원본 기록 번호: ${original.id}`)).toBeVisible();
  await expect(panel.getByRole('region', { name: '함께 사용한 카드 조합' })).toContainText('1개 문장');
  await expect(panel.getByText('실제 발화 여부: 연결된 결과 기록 없음')).toHaveCount(2);
  await panel.getByRole('button', { name: '최근 7일', exact: true }).click();
  const jsonDownload = page.waitForEvent('download');
  await panel.getByRole('region', { name: '기록 내보내기', exact: true }).first().getByRole('button', { name: 'JSON 내보내기' }).click();
  const json = await jsonDownload;
  expect(json.suggestedFilename()).toBe('pesc-mate-communication-7.json');
  const exported = JSON.parse(await readFile(await json.path(), 'utf8'));
  expect(exported.domain).toBe('communication');
  expect(exported.user_id).toBe(communicator.id);
  expect(exported.count).toBe(2);
  expect(exported.records[0].cards).toEqual(['water', 'drink', 'water']);
  expect(exported.records.every(row => row.speech_status === 'unknown')).toBe(true);
  const csvDownload = page.waitForEvent('download');
  await panel.getByRole('region', { name: '기록 내보내기', exact: true }).first().getByRole('button', { name: 'CSV 내보내기' }).click();
  const csv = await csvDownload;
  expect((await readFile(await csv.path(), 'utf8'))).toContain('saved_at,cards,card_labels,sentence');
  await page.getByRole('tab', { name: '학습 기록', exact: true }).click();
  const learningDownload = page.waitForEvent('download');
  await page.getByRole('tabpanel', { name: '학습 기록', exact: true }).getByRole('button', { name: 'JSON 내보내기' }).click();
  const learning = JSON.parse(await readFile(await (await learningDownload).path(), 'utf8'));
  expect(learning.domain).toBe('learning');
  expect(learning.count).toBe(0);
});

test('선택·발화·상황·복구 흐름과 메모 수정·삭제 이력을 실제 화면에서 확인한다', async ({ page, request, communicator }) => {
  await linkForRecords(request, communicator, ['records_read', 'notes_write']);
  await installSpeechStub(page);
  await login(page, communicator);
  await page.getByRole('navigation', { name: '주 메뉴' }).getByRole('button', { name: /그림으로 말하기/ }).click();
  await page.getByLabel('기록 상황 (선택)').selectOption('school');
  const workspace = page.locator('.workspace');
  await workspace.getByRole('button', { name: '물 문장에 담기', exact: true }).click();
  await workspace.getByRole('button', { name: '마시다 문장에 담기', exact: true }).click();
  await page.getByRole('button', { name: '자연스러운 문장 만들기 · 저장', exact: true }).click();
  await page.getByRole('button', { name: '✓ 문장을 확인했어요' }).click();
  await page.getByRole('button', { name: '🔊 확인한 문장 읽기' }).click();
  await expect.poll(async () => {
    const report = await (await request.get(apiPath('/records/activity'), { headers: communicator.headers })).json();
    return report.recent.filter(event => event.session_id && event.speech_status === 'succeeded').length;
  }).toBe(1);
  await page.getByRole('button', { name: '잘못 눌렀어요 복구 표현 말하기' }).click();
  await workspace.getByRole('button', { name: '물 문장에 담기', exact: true }).click();
  await expect.poll(async () => {
    const report = await (await request.get(apiPath('/records/activity'), { headers: communicator.headers })).json();
    return Boolean(report.recovery_flows[0]?.after);
  }).toBe(true);
  await page.getByRole('button', { name: '로그아웃', exact: true }).click();
  await selectChild(page, communicator);
  await page.getByRole('navigation', { name: '주 메뉴' }).getByRole('button', { name: '의사소통 기록', exact: true }).click();
  const panel = page.getByRole('tabpanel', { name: '의사소통 기록', exact: true });
  await expect(panel.getByRole('table', { name: '직접 지정한 상황별 활동' })).toContainText('학교');
  await expect(panel.locator('.session-details')).toContainText('기기 재생 완료');
  await expect(panel.locator('.recovery-flow-list')).toContainText('잘못 눌렀어요');
  const note = panel.getByRole('textbox', { name: /지원 메모/ });
  await note.fill('합성 최초 메모');
  await panel.getByRole('button', { name: '메모 저장', exact: true }).click();
  await expect(panel.locator('.note-history')).toContainText('작성자:');
  await expect(panel.getByRole('button', { name: '메모 저장', exact: true })).toBeEnabled();
  await note.fill('합성 수정 메모');
  await panel.getByRole('button', { name: '메모 저장', exact: true }).click();
  await expect(panel.getByRole('button', { name: '메모 저장', exact: true })).toBeEnabled();
  await panel.getByRole('button', { name: '메모 수정·삭제 이력 보기' }).click();
  await expect(panel.locator('.note-history')).toContainText('합성 최초 메모');
  await expect(panel.locator('.note-history')).toContainText('합성 수정 메모');
  page.once('dialog', dialog => dialog.accept());
  await panel.getByRole('button', { name: '삭제', exact: true }).click();
  await expect(panel.locator('.note-history')).toContainText('메모 삭제 완료');
  await panel.getByRole('button', { name: '메모 수정·삭제 이력 보기' }).click();
  await expect(panel.locator('.note-history')).not.toContainText('합성 최초 메모');
  await expect(panel.locator('.note-history')).not.toContainText('합성 수정 메모');
});

test('이용 데이터 삭제 결과에 건수·유지 항목·백업 한계를 표시한다', async ({ page, request, communicator }) => {
  const saved = await request.post(apiPath('/sentences'), {
    headers: communicator.headers, data: { cards: ['help'], request_id: randomUUID() },
  });
  expect(saved.ok()).toBe(true);
  await login(page, communicator);
  await page.getByRole('button', { name: /마이페이지 열기/ }).click();
  await page.getByRole('button', { name: '보호자 설정', exact: true }).click();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '이용 데이터 삭제', exact: true }).click();
  const receipt = page.getByRole('region', { name: '이용 데이터 삭제 처리 결과' });
  await expect(receipt.getByText('삭제 완료', { exact: true })).toBeVisible();
  await expect(receipt).toContainText('저장 문장: 1건');
  await expect(receipt).toContainText('로그인 계정, 삭제 확인 기록');
  await expect(receipt).toContainText('별도 백업');
  await expect(page.getByText('이 기기의 임시 기록 삭제 완료', { exact: true })).toBeVisible();
});
