import { test, expect, apiPath, login, linkCaregiver, installSpeechStub } from './workflow-fixtures.js';

test('USB 선택과 진단 UID 수신은 장치 로그에 표시되고 명시 추가 뒤 기존 문장과 TTS로 이어진다', async ({ page, request, communicator }) => {
  const guardian = await linkCaregiver(request, communicator);
  for (const [uid, card_id] of [['01010101', 'me'], ['02020202', 'water'], ['03030303', 'drink']]) {
    expect((await request.put(apiPath(`/rfid/bindings?user_id=${communicator.id}`), { headers: guardian,
      data: { uid, card_id, expected_revision: null } })).ok()).toBe(true);
  }
  await installSpeechStub(page);
  await page.addInitScript(() => {
    const serial = new EventTarget(); let controller;
    const port = { async open() { this.readable = new ReadableStream({ start(value) { controller = value; } }); },
      async close() { window.__usbClosed = true; } };
    serial.requestPort = async () => { window.__usbRequested = true; return port; };
    serial.getPorts = async () => [];
    Object.defineProperty(navigator, 'serial', { configurable: true, value: serial });
    window.__usbLine = text => controller.enqueue(new TextEncoder().encode(text));
  });
  await login(page, communicator);
  await page.getByRole('navigation').getByRole('button', { name: /그림으로 말하기/ }).click();
  const usb = page.getByRole('region', { name: 'USB 카드 리더기', exact: true });
  expect(await page.evaluate(() => window.__usbRequested)).toBeUndefined();
  await usb.getByRole('button', { name: 'USB 장치 연결', exact: true }).click();
  await expect(usb.getByText('USB 연결됨', { exact: true })).toBeVisible();
  await page.evaluate(() => window.__usbLine('RC522 Version: 0x82\r\nRFID Reader Connected\nUID: 01 01'));
  await page.evaluate(() => window.__usbLine(' 01 01\nUID: 02 02 02 02\nUID: 03 03 03 03\n'));
  await expect(usb.getByRole('list', { name: 'USB로 읽은 카드' }).getByRole('listitem')).toHaveCount(3);
  await expect(page.locator('section.board').getByRole('listitem')).toHaveCount(0);
  await usb.getByRole('button', { name: '읽은 카드를 문장에 추가' }).click();
  await expect(page.locator('section.board').getByRole('listitem')).toHaveCount(3);
  await page.getByRole('button', { name: '자연스러운 문장 만들기 · 저장', exact: true }).click();
  await page.getByRole('button', { name: '✓ 문장을 확인했어요', exact: true }).click();
  await page.getByRole('button', { name: '🔊 확인한 문장 읽기', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__spokenTexts.length)).toBe(1);
  expect(await page.evaluate(() => window.__spokenTexts[0])).toContain('물');
  await expect(usb.getByRole('list', { name: 'USB 장치 로그' })).not.toContainText('01010101');
  await usb.getByRole('button', { name: 'USB 연결 해제', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__usbClosed)).toBe(true);
  const exported = await (await request.get(apiPath('/privacy/export'), { headers: communicator.headers })).json();
  expect(exported.rfid_devices).toEqual([]); expect(exported.learning_attempts).toEqual([]);
  await request.post(apiPath('/auth/logout'), { headers: guardian });
});
