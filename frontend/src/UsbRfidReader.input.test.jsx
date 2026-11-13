import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import UsbRfidReader from './UsbRfidReader';
import { request } from './services/api';
const { connections } = vi.hoisted(() => ({ connections: [] }));
vi.mock('./services/api', () => ({ request: vi.fn() }));
vi.mock('./services/usbRfid', async () => {
  const actual = await vi.importActual('./services/usbRfid');
  return { ...actual, UsbSerialConnection: class {
    constructor(options) { Object.assign(this, options); connections.push(this); }
    connect() { this.onState('connected'); }
    disconnect() { this.onState('disconnected'); }
    dispose() {}
  } };
});
const ids = { AABBCCDD: 'water', '11223344': 'drink', '55667788': 'me' };
const cards = [{ id: 'water', label: '물' }, { id: 'drink', label: '마시다' }, { id: 'me', label: '나' }];
const row = (reader_id, uid) => ({ reader_id, status: uid ? 'PRESENT' : 'EMPTY', uid: uid || null });
const error = reader_id => ({ reader_id, status: 'ERROR', uid: null });
let event;
beforeEach(() => {
  vi.useFakeTimers(); connections.length = 0; event = 0;
  const serial = new EventTarget(); serial.getPorts = async () => [];
  vi.stubGlobal('navigator', { serial, onLine: true }); vi.stubGlobal('isSecureContext', true);
  localStorage.setItem('pesc-mate-token', 'synthetic');
  request.mockImplementation(async (path, options) => path.startsWith('/rfid/usb/resolve')
    ? JSON.parse(options.body).uids.map(uid => ids[uid] ? { status: 'PRESENT', card_id: ids[uid] } : { status: 'UNMAPPED' }) : {});
});
async function mount(extra = {}) {
  const onAppend = vi.fn(), onActivateAudio = vi.fn();
  const view = render(<UsbRfidReader targetId="one" cards={cards} autoAppend appendScope="scope"
    connectionTarget={document.body} onAppend={onAppend} onActivateAudio={onActivateAudio} {...extra} />);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '기기 연결' })));
  return { ...view, onAppend, onActivateAudio };
}
async function input(readers) {
  await act(async () => connections[0].onLine(JSON.stringify({ type: 'snapshot', protocol_version: 1,
    boot_id: 'synthetic', event_id: ++event, reader_count: readers.length, readers })));
}
async function waitWindow() { await act(async () => vi.advanceTimersByTimeAsync(150)); }
it('unlocks audio from connect click and appends one healthy reader without auto speech', async () => {
  const h = await mount(); expect(h.onActivateAudio).toHaveBeenCalledTimes(1);
  await input([error(1), row(2, 'AABBCCDD'), error(3)]); await waitWindow();
  expect(h.onAppend).toHaveBeenCalledTimes(1);
  expect(h.onAppend.mock.calls[0][0].map(c => c.id)).toEqual(['water']);
  expect(h.onAppend.mock.calls[0][1]).toEqual({ autoSpeak: false });
});
it('appends three simultaneous cards once in reader order with automatic speech intent', async () => {
  const h = await mount();
  await input([row(3, '11223344'), row(1, '55667788'), row(2, 'AABBCCDD')]); await waitWindow();
  expect(h.onAppend.mock.calls[0][0].map(c => c.id)).toEqual(['me', 'water', 'drink']);
  expect(h.onAppend.mock.calls[0][1]).toEqual({ autoSpeak: true });
  await input([row(1, '55667788'), row(2, 'AABBCCDD'), row(3, '11223344')]); await waitWindow();
  expect(h.onAppend).toHaveBeenCalledTimes(1);
});
it('keeps separate presentations in tag order and accepts a retag', async () => {
  const h = await mount();
  await input([row(1), row(2), row(3, '11223344')]); await waitWindow();
  await input([row(1, '55667788'), row(2), row(3, '11223344')]); await waitWindow();
  await input([row(1), row(2), row(3, '11223344')]);
  await input([row(1, '55667788'), row(2), row(3, '11223344')]); await waitWindow();
  expect(h.onAppend.mock.calls.map(([selected]) => selected[0].id)).toEqual(['drink', 'me', 'me']);
  expect(h.onAppend.mock.calls.every(([, metadata]) => !metadata.autoSpeak)).toBe(true);
});
it('does not auto speak an incomplete group with an unmapped UID', async () => {
  const onReadError = vi.fn();
  const h = await mount({ onReadError }); await input([row(1, 'AABBCCDD'), row(2, 'FFFFFFFF'), row(3)]); await waitWindow();
  expect(h.onAppend.mock.calls[0][0].map(c => c.id)).toEqual(['water']);
  expect(h.onAppend.mock.calls[0][1].autoSpeak).toBe(false);
  expect(onReadError.mock.invocationCallOrder[0]).toBeGreaterThan(h.onAppend.mock.invocationCallOrder[0]);
});
it('ignores a delayed resolution after switching the account scope', async () => {
  let finish;
  const h = await mount(); request.mockImplementation(path => path.startsWith('/rfid/usb/resolve')
    ? new Promise(resolve => { finish = resolve; }) : Promise.resolve({}));
  await input([row(1, 'AABBCCDD')]); await waitWindow();
  h.rerender(<UsbRfidReader targetId="two" cards={cards} autoAppend appendScope="other"
    connectionTarget={document.body} onAppend={h.onAppend} />);
  await act(async () => finish([{ status: 'PRESENT', card_id: 'water' }]));
  expect(h.onAppend).not.toHaveBeenCalled();
});
it('drops a pending batch when disconnected before its grouping window closes', async () => {
  const h = await mount(); await input([row(1, 'AABBCCDD'), row(2, '11223344')]);
  await act(async () => connections[0].disconnect()); await waitWindow();
  expect(h.onAppend).not.toHaveBeenCalled();
});
