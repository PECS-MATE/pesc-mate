import { randomUUID } from 'node:crypto';
import { test, expect, apiPath, login, linkCaregiver, installSpeechStub } from './workflow-fixtures.js';

test('Wi-Fi 보드 스냅샷은 위치별 갱신과 제거를 표시하고 명시 적용 뒤 기존 문장과 TTS로 이어진다', async ({ page, request, communicator }) => {
  const guardian = await linkCaregiver(request, communicator);
  const id = 'e2e-' + randomUUID().slice(0, 16);
  const created = await request.post(apiPath(`/rfid/devices?user_id=${communicator.id}`), {
    headers: guardian, data: { device_id: id, name: '자동 검증 실물 카드판' } });
  expect(created.status()).toBe(201);
  const hardware = { 'X-Device-Key': (await created.json()).device_key };
  for (const [uid, card_id] of [['01010101', 'me'], ['02020202', 'water'], ['03030303', 'drink']]) {
    expect((await request.put(apiPath(`/rfid/bindings?user_id=${communicator.id}`), {
      headers: guardian, data: { uid, card_id, expected_revision: null } })).ok()).toBe(true);
  }
  const session = await request.post(apiPath(`/rfid/devices/${id}/session`), { headers: hardware });
  expect(session.status()).toBe(201);
  const session_id = (await session.json()).session_id;
  const readers = [1, 2, 3].map((reader_id, index) => ({ reader_id, status: 'PRESENT', uid: ['01010101', '02020202', '03030303'][index] }));
  const send = async (event_id, rows) => expect((await request.post(apiPath(`/rfid/devices/${id}/snapshot`), {
    headers: hardware, data: { protocol_version: 1, session_id, event_id, readers: rows } })).ok()).toBe(true);
  await send(1, readers);
  await installSpeechStub(page); await login(page, communicator);
  await page.getByRole('navigation').getByRole('button', { name: /그림으로 말하기/ }).click();
  const sentence = page.locator('section.board');
  await page.getByRole('button', { name: 'RFID 상태 열기' }).click();
  await send(2, readers); // Simulate the device heartbeat after login instead of extending the stale limit.
  await page.getByRole('combobox', { name: 'RFID 장치', exact: true }).selectOption(id);
  const board = page.getByRole('region', { name: 'RFID 실물 카드판' });
  await expect(board.getByText('리더기 상태 수신 중', { exact: true })).toBeVisible();
  await expect(sentence.getByRole('listitem')).toHaveCount(0);
  const before = await (await request.get(apiPath('/privacy/export'), { headers: communicator.headers })).json();
  expect(before.communication_sessions).toEqual([]); expect(before.tts_events).toEqual([]);
  await board.getByRole('button', { name: '현재 RFID 배열을 문장에 적용' }).click();
  await expect(sentence.getByRole('listitem')).toHaveCount(3);
  await page.getByRole('button', { name: '자연스러운 문장 만들기 · 저장', exact: true }).click();
  await page.getByRole('button', { name: '✓ 문장을 확인했어요', exact: true }).click();
  await page.getByRole('button', { name: '🔊 확인한 문장 읽기', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__spokenTexts.length)).toBe(1);
  expect(await page.evaluate(() => window.__spokenTexts[0])).toContain('물');
  await send(3, readers.map(row => row.reader_id === 2 ? { reader_id: 2, status: 'EMPTY', uid: null } : row));
  await expect(board.getByText('카드 없음', { exact: true })).toBeVisible();
  await expect(sentence.getByRole('listitem')).toHaveCount(3); // Manual draft is not silently overwritten.
  page.once('dialog', dialog => dialog.accept());
  await board.getByRole('button', { name: '현재 RFID 배열을 문장에 적용' }).click();
  await expect(sentence.getByRole('listitem')).toHaveCount(2);
  const exported = await (await request.get(apiPath('/privacy/export'), { headers: communicator.headers })).json();
  expect(exported.learning_attempts).toEqual([]); expect(exported.communication_sessions).toHaveLength(1);
  expect(exported.rfid_devices[0].key_hash).toBeUndefined();
  await request.post(apiPath('/auth/logout'), { headers: guardian });
});
