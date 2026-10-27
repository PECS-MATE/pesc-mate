import { randomBytes } from 'node:crypto';
import { test, expect, apiPath, login } from './workflow-fixtures.js';

test('운영 담당자는 USB로 칩 두 개를 순서대로 공용 등록하고 아동은 별도 개인 등록 없이 사용한다', async ({ page, request, communicator }) => {
  const uidA = randomBytes(4).toString('hex').toUpperCase(), uidB = randomBytes(4).toString('hex').toUpperCase();
  expect(uidA).not.toBe(uidB);
  const admin = { username: 'admin', password: 'admin1234' };
  const auth = await request.post(apiPath('/auth/login'), { data: admin }); expect(auth.ok()).toBe(true);
  const headers = { Authorization: `Bearer ${(await auth.json()).access_token}` };
  const registered = new Set();
  try {
    const before = await (await request.get(apiPath('/rfid/admin/catalog'), { headers })).json();
    expect(before.bindings.some(row => [uidA, uidB].includes(row.uid))).toBe(false);
    await page.addInitScript(() => {
      const serial = new EventTarget(); let controller;
      const port = { async open() { this.readable = new ReadableStream({ start(value) { controller = value; } }); }, async close() {} };
      serial.requestPort = async () => port; serial.getPorts = async () => [];
      Object.defineProperty(navigator, 'serial', { configurable: true, value: serial });
      window.__chipLine = text => controller.enqueue(new TextEncoder().encode(text + '\n'));
    });
    await login(page, admin);
    await page.getByRole('navigation').getByRole('button', { name: 'RFID 칩 등록', exact: true }).click();
    const registration = page.getByRole('region', { name: '공용 RFID 칩 등록', exact: true });
    await registration.getByRole('button', { name: 'USB 장치 연결', exact: true }).click();
    await expect(registration.getByText('USB 연결됨', { exact: true })).toBeVisible();
    for (const [uid, id] of [[uidA, 'water'], [uidB, 'rice']]) {
      if (registered.size) await registration.getByRole('button', { name: '다음 칩 인식', exact: true }).click();
      await page.evaluate(uid => window.__chipLine('UID: ' + uid), uid);
      await expect(registration.getByLabel('인식한 칩 UID')).toHaveText(uid);
      await registration.getByRole('combobox', { name: '연결할 공용 그림카드' }).selectOption(id);
      await registration.getByRole('button', { name: '칩 등록 저장', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: '운영 작업 확인' });
      await dialog.getByLabel('본인 비밀번호').fill(admin.password);
      await dialog.getByRole('button', { name: '확인 후 실행' }).click();
      await expect(registration.getByText(new RegExp(`${uid}.*저장 완료`))).toBeVisible();
      registered.add(uid);
    }
    await page.getByRole('button', { name: '로그아웃', exact: true }).click();
    await login(page, communicator);
    await expect(page.getByRole('navigation').getByRole('button', { name: 'RFID 칩 등록', exact: true })).toHaveCount(0);
    await page.getByRole('navigation').getByRole('button', { name: /그림으로 말하기/ }).click();
    const usb = page.getByRole('region', { name: 'USB 카드 리더기', exact: true });
    await usb.getByRole('button', { name: 'USB 장치 연결', exact: true }).click();
    await expect(usb.getByText('USB 연결됨', { exact: true })).toBeVisible();
    await page.evaluate(uid => window.__chipLine('UID: ' + uid), uidA);
    await page.evaluate(uid => window.__chipLine('UID: ' + uid), uidB);
    await expect(usb.getByRole('list', { name: 'USB로 읽은 카드' }).getByRole('listitem')).toHaveCount(2);
    await usb.getByRole('button', { name: '읽은 카드를 문장에 추가' }).click();
    await expect(page.locator('section.board').getByRole('listitem')).toHaveCount(2);
    const exported = await (await request.get(apiPath('/privacy/export'), { headers: communicator.headers })).json();
    expect(exported.rfid_bindings).toEqual([]); expect(exported.communication_sessions).toEqual([]);
    await usb.getByRole('button', { name: 'USB 연결 해제', exact: true }).click();
  } finally {
    const latest = await request.get(apiPath('/rfid/admin/catalog'), { headers });
    if (latest.ok()) for (const row of (await latest.json()).bindings.filter(row => registered.has(row.uid))) {
      expect((await request.put(apiPath('/rfid/admin/bindings'), { headers, data: {
        uid: row.uid, card_id: null, expected_revision: row.revision, password: admin.password } })).ok()).toBe(true);
    }
    await request.post(apiPath('/auth/logout'), { headers });
  }
});
