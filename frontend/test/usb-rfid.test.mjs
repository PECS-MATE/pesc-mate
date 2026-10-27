import assert from 'node:assert/strict';
import test from 'node:test';
import { parseUsbLine, SerialLineBuffer, UsbPresentationTracker, UsbSerialConnection } from '../src/services/usbRfid.js';

const frame = (event_id, uid = '01020304', boot_id = 'synthetic') => parseUsbLine(JSON.stringify({
  protocol_version: 1, type: 'snapshot', boot_id, event_id, reader_count: 1,
  readers: [{ reader_id: 1, status: uid ? 'PRESENT' : 'EMPTY', uid }],
}));
test('기존 UID 진단 출력과 버전 0x82를 인식하고 다른 문자열을 UID로 해석하지 않는다', () => {
  assert.equal(parseUsbLine('UID: 01 ab cd 02 ').uid, '01ABCD02');
  assert.deepEqual(parseUsbLine('RC522 Version: 0x82'), { type: 'version', version: '82' });
  assert.equal(parseUsbLine('RFID Reader Connected').type, 'reader_ready');
  assert.equal(parseUsbLine('RFID CONNECTION ERROR').type, 'reader_error');
  assert.equal(parseUsbLine('arbitrary private text'), null);
  assert.throws(() => parseUsbLine('UID: bad data'));
});
test('부분 수신과 CRLF를 조합하고 과도한 줄은 다음 개행까지 버린다', () => {
  const buffer = new SerialLineBuffer(), lines = []; let invalid = 0;
  const push = value => buffer.push(value, line => lines.push(line), () => invalid++);
  push('UID: 01'); push('020304\r\nRFID Reader'); push(' Connected\n');
  push('x'.repeat(2000)); push('\nUID: 02030405\n');
  assert.deepEqual(lines, ['UID: 01020304', 'RFID Reader Connected', 'UID: 02030405']);
  assert.equal(invalid, 1); assert.equal(buffer.text.length, 0);
});
test('버전 위치 상태 중복 UID와 과거 이벤트를 검증한다', () => {
  const tracker = new UsbPresentationTracker();
  assert.equal(tracker.accept(frame(1)).rows.length, 1);
  assert.equal(tracker.accept(frame(1)), null);
  assert.equal(tracker.accept(frame(2)).rows.length, 0); // Held card heartbeat.
  assert.equal(tracker.accept(frame(3, null)).rows.length, 0);
  assert.equal(tracker.accept(frame(4)).rows.length, 1); // Same tag after removal.
  assert.equal(tracker.accept(frame(1, '01020304', 'new-boot')).reset, true);
  const bad = JSON.parse(JSON.stringify(frame(1))); bad.protocol_version = 2;
  assert.throws(() => parseUsbLine(JSON.stringify(bad)));
  bad.protocol_version = 1; bad.reader_count = 2; bad.readers.push({ ...bad.readers[0], reader_id: 2 });
  assert.throws(() => parseUsbLine(JSON.stringify(bad)));
});
test('진단 출력의 빠른 중복만 막고 이후 같은 태그의 의도된 반복을 허용한다', () => {
  const tracker = new UsbPresentationTracker(), row = parseUsbLine('UID: 01020304');
  assert.equal(tracker.accept(row, 1000).rows.length, 1);
  assert.equal(tracker.accept(row, 1100), null);
  assert.equal(tracker.accept(row, 2000).rows.length, 1);
});
function serialFixture() {
  let controller, opened = 0, closed = 0;
  const states = [], lines = [];
  const port = {
    async open(options) { assert.equal(options.baudRate, 115200); opened++; this.readable = new ReadableStream({ start(value) { controller = value; } }); },
    async close() { assert.equal(this.readable.locked, false); closed++; },
  };
  const serial = new EventTarget(); serial.requestPort = async () => port;
  const connection = new UsbSerialConnection({ serial, onLine: value => lines.push(value), onState: value => states.push(value), onInvalid: () => {} });
  return { connection, port, serial, states, lines, send: text => controller.enqueue(new TextEncoder().encode(text)), closeStream: () => controller.close(), counts: () => [opened, closed] };
}
test('포트는 클릭 경로에서 열고 부분 수신 후 명시 해제로 읽기 잠금을 해제한다', async () => {
  const f = serialFixture(); await f.connection.connect();
  f.send('UID: 01'); f.send('020304\n');
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(f.lines, ['UID: 01020304']);
  await f.connection.disconnect(); assert.deepEqual(f.counts(), [1, 1]);
  assert.equal(f.states.at(-1), 'disconnected'); await f.connection.dispose();
});
test('수신 종료와 USB 분리도 포트를 닫고 다시 연결할 수 있다', async () => {
  const f = serialFixture(); await f.connection.connect(); f.closeStream();
  await f.connection.loop; assert.deepEqual(f.counts(), [1, 1]);
  await f.connection.connect();
  const unplug = new Event('disconnect'); unplug.port = f.port; f.serial.dispatchEvent(unplug);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(f.counts(), [2, 2]); await f.connection.dispose();
});
test('권한 취소와 사용 중 포트 오류는 원래 오류 문자열 없이 상태로 전달한다', async () => {
  for (const [name, state] of [['NotFoundError', 'cancelled'], ['NetworkError', 'connect_failed']]) {
    const serial = new EventTarget(), states = [];
    serial.requestPort = async () => { throw Object.assign(new Error('private serial path'), { name }); };
    const connection = new UsbSerialConnection({ serial, onLine() {}, onState: value => states.push(value), onInvalid() {} });
    await connection.connect(); assert.equal(states.at(-1), state); await connection.dispose();
  }
});
