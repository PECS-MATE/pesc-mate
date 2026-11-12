import { describe, expect, it, vi } from 'vitest';
import { normalizeUsbUid, parseUsbLine, SerialLineBuffer, UsbPresentationTracker, UsbSerialConnection } from './usbRfid';
import { rfidSelection } from './rfidBoard';

const frame = (event_id, readers, boot_id = 'synthetic-boot') => parseUsbLine(JSON.stringify({
  type: 'snapshot', protocol_version: 1, boot_id, event_id, reader_count: readers.length, readers,
}));
const present = (reader_id, uid = 'AABBCCDD') => ({ reader_id, uid, status: 'PRESENT' });
const empty = reader_id => ({ reader_id, status: 'EMPTY' });

describe('USB serial protocol', () => {
  it.each(['aa:bb:cc:dd', 'aa bb cc dd', 'aa-bb-cc-dd'])('normalizes %s', uid => {
    expect(normalizeUsbUid(uid)).toBe('AABBCCDD');
  });
  it.each(['', '123', 'GG112233', null])('rejects invalid UID %s', uid => {
    expect(() => normalizeUsbUid(uid)).toThrow('invalid_uid');
  });
  it('buffers split and consecutive lines and recovers from oversized frames', () => {
    const buffer = new SerialLineBuffer(), lines = [], invalid = vi.fn();
    buffer.push('Reader 1 UID: AA', line => lines.push(line), invalid);
    buffer.push('BBCCDD\r\nUID: 11223344\n', line => lines.push(parseUsbLine(line)), invalid);
    expect(lines.map(line => line.uid)).toEqual(['AABBCCDD', '11223344']);
    buffer.push('x'.repeat(1025) + '\nUID: AABBCCDD\n', line => lines.push(parseUsbLine(line)), invalid);
    expect(invalid).toHaveBeenCalledTimes(1);
    expect(lines).toHaveLength(3);
  });
  it('orders three physical positions and rejects ambiguous UID duplication', () => {
    expect(frame(1, [present(3, '11223344'), empty(2), present(1)]).readers.map(r => r.reader_id)).toEqual([1, 2, 3]);
    expect(() => frame(1, [present(1), present(2), empty(3)])).toThrow('ambiguous_readers');
  });
  it('ignores stale snapshots, accepts removal/retag and recognizes reboot', () => {
    const tracker = new UsbPresentationTracker();
    expect(tracker.accept(frame(1, [present(1)])).rows).toHaveLength(1);
    expect(tracker.accept(frame(1, [present(1)]))).toBeNull();
    expect(tracker.accept(frame(2, [present(1)])).rows).toEqual([]);
    tracker.accept(frame(3, [empty(1)]));
    expect(tracker.accept(frame(4, [present(1)])).rows).toHaveLength(1);
    expect(tracker.accept(frame(1, [present(1)], 'reboot')).reset).toBe(true);
  });
  it('suppresses only rapid repeats from the same legacy reader', () => {
    const tracker = new UsbPresentationTracker(), scan = parseUsbLine('Reader 1 UID: AABBCCDD');
    expect(tracker.accept(scan, 1000)).not.toBeNull();
    expect(tracker.accept(scan, 1799)).toBeNull();
    expect(tracker.accept({ ...scan, reader_id: 2 }, 1799)).not.toBeNull();
    expect(tracker.accept(scan, 1800)).not.toBeNull();
  });
  it('removes disconnect listener on disposal and discards a late port selection', async () => {
    let resolvePort;
    const serial = { addEventListener: vi.fn(), removeEventListener: vi.fn(), requestPort: vi.fn(() => new Promise(r => { resolvePort = r; })) };
    const connection = new UsbSerialConnection({ serial, onLine: vi.fn(), onState: vi.fn(), onInvalid: vi.fn() });
    const connecting = connection.connect();
    await connection.dispose();
    const port = { open: vi.fn() }; resolvePort(port); await connecting;
    expect(port.open).not.toHaveBeenCalled();
    expect(serial.removeEventListener).toHaveBeenCalledWith('disconnect', serial.addEventListener.mock.calls[0][1]);
  });
});

describe('Wi-Fi board selection', () => {
  const cards = [{ id: 'water' }, { id: 'drink' }];
  const snapshot = { online: true, readers: [
    { reader_id: 3, status: 'PRESENT', card_id: 'water' },
    { reader_id: 1, status: 'PRESENT', card_id: 'water' },
    { reader_id: 2, status: 'PRESENT', card_id: 'drink' },
  ] };
  it('preserves position order and repeated concepts', () => expect(rfidSelection(snapshot, cards)).toEqual([cards[0], cards[1], cards[0]]));
  it('rejects stale, unknown and faulty boards', () => {
    expect(rfidSelection({ ...snapshot, online: false }, cards)).toBeNull();
    expect(rfidSelection(snapshot, [])).toBeNull();
    expect(rfidSelection({ ...snapshot, readers: [...snapshot.readers.slice(0, 2), { reader_id: 2, status: 'ERROR' }] }, cards)).toBeNull();
  });
});
