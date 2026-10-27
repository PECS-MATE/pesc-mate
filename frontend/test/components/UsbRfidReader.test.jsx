import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import UsbRfidReader from '../../src/UsbRfidReader';
import { request } from '../../src/services/api';

const ports = vi.hoisted(() => []);
vi.mock('../../src/services/api', () => ({ request: vi.fn() }));
vi.mock('../../src/services/usbRfid', async original => ({ ...await original(), UsbSerialConnection: class {
  constructor(options) { this.options = options; this.dispose = vi.fn(); ports.push(this); }
  async connect() { this.options.onState('connected'); }
  async disconnect() { this.options.onState('disconnected'); }
} }));
const cards = [{ id: 'water', label: '물' }];
beforeEach(() => {
  ports.length = 0;
  localStorage.setItem('pesc-mate-token', 'synthetic');
  vi.stubGlobal('isSecureContext', true);
  Object.defineProperty(navigator, 'serial', { configurable: true, value: { getPorts: async () => [], addEventListener() {}, removeEventListener() {} } });
  request.mockReset().mockImplementation(async (path, options) => {
    if (path.startsWith('/rfid/usb/events')) return null;
    if (path.startsWith('/rfid/usb/resolve')) return JSON.parse(options.body).uids.map(() => ({ status: 'PRESENT', card_id: 'water', label: '물' }));
    throw new Error('Unexpected USB request');
  });
});
afterEach(() => { delete navigator.serial; });
async function scan(text) { await act(async () => { ports.at(-1).options.onLine(text); }); }
async function connect() { await userEvent.setup().click(screen.getByRole('button', { name: 'USB 장치 연결', exact: true })); }

test('연결 버튼으로 시작하고 UID 진단 출력은 명시 추가 전까지 문장을 바꾸지 않는다', async () => {
  const append = vi.fn(() => true);
  render(<UsbRfidReader targetId="child" cards={cards} onAppend={append} />);
  expect(request).not.toHaveBeenCalled();
  navigator.serial.getPorts = vi.fn(async () => [{}]);
  await connect(); await screen.findByText('브라우저가 허용받아 감지한 포트: 1개 · 115200bps');
  await scan('UID: 01020304');
  await within(screen.getByRole('list', { name: 'USB로 읽은 카드' })).findByText('물');
  expect(append).not.toHaveBeenCalled();
  await userEvent.setup().click(screen.getByRole('button', { name: '읽은 카드를 문장에 추가' }));
  expect(append).toHaveBeenCalledWith(cards);
  expect(screen.queryByRole('list', { name: 'USB로 읽은 카드' })).toBeNull();
  expect(screen.getByRole('list', { name: 'USB 장치 로그' }).textContent).toContain('카드를 읽었습니다');
  expect(screen.getByRole('list', { name: 'USB 장치 로그' }).textContent).not.toContain('01020304');
  await userEvent.setup().click(screen.getByRole('button', { name: 'USB 연결 해제', exact: true }));
  await connect();
  expect(within(screen.getByRole('list', { name: 'USB 장치 로그' })).getAllByText(/USB 장치를 연결했습니다\./)).toHaveLength(2);
});
test('미등록 태그와 연결 해제는 적용을 막고 보호자만 등록 입력으로 UID를 전달한다', async () => {
  const onUid = vi.fn();
  request.mockImplementation(async path => path.startsWith('/rfid/usb/resolve') ? [{ status: 'UNMAPPED', card_id: null, label: null }] : null);
  render(<UsbRfidReader targetId="child" manager canMap onUid={onUid} />);
  await connect(); await scan('UID: 01020304');
  await screen.findByText('미등록·사용 불가 카드'); expect(onUid).toHaveBeenCalledWith('01020304');
  await userEvent.setup().click(screen.getByRole('button', { name: 'USB 연결 해제', exact: true }));
  await screen.findByText('USB 장치 연결이 해제됐습니다.', { exact: true });
});
test('사용자 전환 뒤의 늦은 UID 조회는 새 화면을 덮어쓰지 않으며 포트를 닫는다', async () => {
  let finish;
  request.mockImplementation(async path => path.startsWith('/rfid/usb/resolve') ? new Promise(resolve => { finish = resolve; }) : null);
  const view = render(<UsbRfidReader targetId="old" cards={cards} />);
  await connect(); await scan('UID: 01020304'); await waitFor(() => expect(finish).toBeTypeOf('function'));
  const original = ports[0]; view.rerender(<UsbRfidReader targetId="new" cards={cards} />);
  await act(async () => finish([{ status: 'PRESENT', card_id: 'water', label: '물' }]));
  expect(original.dispose).toHaveBeenCalled(); expect(screen.queryByText('물')).toBeNull();
});
test('지원하지 않는 브라우저는 안전한 출처 안내를 보여 주며 포트 권한을 요청하지 않는다', () => {
  delete navigator.serial;
  render(<UsbRfidReader targetId="child" />);
  expect(screen.getByText(/USB 연결은 PC의 Chrome\/Edge/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'USB 장치 연결', exact: true })).toBeNull();
});
test('세 위치 JSON은 순서대로 적용하고 같은 이벤트는 중복 조회하지 않는다', async () => {
  const apply = vi.fn(() => true);
  render(<UsbRfidReader targetId="child" cards={cards} onApply={apply} />); await connect();
  const text = JSON.stringify({ protocol_version: 1, type: 'snapshot', boot_id: 'boot', event_id: 1, reader_count: 3, readers: [
    { reader_id: 3, status: 'EMPTY', uid: null }, { reader_id: 1, status: 'PRESENT', uid: '01020304' }, { reader_id: 2, status: 'EMPTY', uid: null },
  ] });
  await scan(text); await screen.findByText('위치 1: 물'); await scan(text);
  expect(request.mock.calls.filter(([path]) => path.startsWith('/rfid/usb/resolve'))).toHaveLength(1);
  await userEvent.setup().click(screen.getByRole('button', { name: 'USB 배열을 문장에 적용' }));
  expect(apply).toHaveBeenCalledWith(cards);
});

test('연속 스캔은 조회를 하나씩 처리하고 목록을 비운 뒤 늦은 결과를 되살리지 않는다', async () => {
  const completions = [];
  request.mockImplementation(async (path, options) => {
    if (!path.startsWith('/rfid/usb/resolve')) return null;
    return new Promise(resolve => completions.push(() => resolve(JSON.parse(options.body).uids.map(() => ({ status: 'PRESENT', card_id: 'water', label: '물' })))));
  });
  render(<UsbRfidReader targetId="child" cards={cards} />); await connect();
  await scan('UID: 01020304'); await scan('UID: 02030405'); await scan('UID: 03040506');
  expect(completions).toHaveLength(1);
  await act(async () => completions[0]());
  await waitFor(() => expect(completions).toHaveLength(2));
  await userEvent.setup().click(screen.getByRole('button', { name: 'USB 읽기 목록 비우기' }));
  await act(async () => completions[1]());
  expect(screen.queryByRole('list', { name: 'USB로 읽은 카드' })).toBeNull();
  expect(screen.getByRole('button', { name: '읽은 카드를 문장에 추가' }).disabled).toBe(true);
});
