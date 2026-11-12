import { StrictMode } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import UsbRfidReader from './UsbRfidReader';
import { request } from './services/api';
vi.mock('./services/api', () => ({ request: vi.fn(async () => []) }));

it('cleans up serial listeners and polling under StrictMode', async () => {
  const serial = new EventTarget(); serial.getPorts = vi.fn(async () => []);
  const add = vi.spyOn(serial, 'addEventListener'), remove = vi.spyOn(serial, 'removeEventListener');
  vi.stubGlobal('navigator', { serial, onLine: true }); vi.stubGlobal('isSecureContext', true);
  localStorage.setItem('pesc-mate-token', 'synthetic');
  const interval = vi.spyOn(globalThis, 'setInterval'), clear = vi.spyOn(globalThis, 'clearInterval');
  const { unmount } = render(<StrictMode><UsbRfidReader targetId="one" /></StrictMode>);
  await waitFor(() => expect(serial.getPorts).toHaveBeenCalled()); unmount();
  for (const [name, listener] of add.mock.calls) expect(remove).toHaveBeenCalledWith(name, listener);
  for (const result of interval.mock.results) expect(clear).toHaveBeenCalledWith(result.value);
});
it('keeps unmapped cards out of the sentence and disposes the reader on target switch', async () => {
  let read, cancelled = false;
  const reader = { read: vi.fn(() => new Promise(resolve => { read = resolve; })), releaseLock: vi.fn(), cancel: vi.fn(async () => { cancelled = true; read({ done: true }); }) };
  const port = { open: vi.fn(async () => {}), close: vi.fn(async () => {}), readable: { getReader: () => reader } };
  const serial = new EventTarget(); serial.getPorts = vi.fn(async () => [port]); serial.requestPort = vi.fn(async () => port);
  vi.stubGlobal('navigator', { serial, onLine: true }); vi.stubGlobal('isSecureContext', true);
  localStorage.setItem('pesc-mate-token', 'synthetic');
  request.mockImplementation(async path => path.startsWith('/rfid/usb/resolve') ? [{ status: 'UNMAPPED', card_id: null, label: null }] : {});
  const onAppend = vi.fn(), { rerender } = render(<UsbRfidReader targetId="one" onAppend={onAppend} />);
  await userEvent.click(screen.getByRole('button', { name: 'USB 리더기 연결하기' }));
  await waitFor(() => expect(reader.read).toHaveBeenCalled());
  await act(async () => { read({ value: new TextEncoder().encode('UID: AABBCCDD\n'), done: false }); });
  expect(await screen.findByText('미등록·사용 불가 카드')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '읽은 카드를 문장에 추가' })).toBeDisabled();
  expect(onAppend).not.toHaveBeenCalled(); rerender(<UsbRfidReader targetId="two" onAppend={onAppend} />);
  await waitFor(() => expect(port.close).toHaveBeenCalled()); expect(cancelled).toBe(true);
});
