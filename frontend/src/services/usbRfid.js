export function normalizeUsbUid(value) {
  if (typeof value !== 'string') throw new Error('invalid_uid');
  const uid = value.replace(/[\s:-]/g, '').toUpperCase();
  if (!/^(?:[\dA-F]{8}|[\dA-F]{14}|[\dA-F]{20})$/.test(uid)) throw new Error('invalid_uid');
  return uid;
}

export function parseUsbLine(line) {
  const text = line.trim();
  if (!text) return null;
  if (text.startsWith('UID:')) return { type: 'scan', uid: normalizeUsbUid(text.slice(4)), protocol: 'legacy' };
  if (/^RC522 Version: 0x[\dA-F]{1,2}$/i.test(text)) return { type: 'version', version: text.split('0x')[1].toUpperCase() };
  if (text === 'RFID Reader Connected') return { type: 'reader_ready' };
  if (text === 'RFID CONNECTION ERROR') return { type: 'reader_error' };
  if (/^(Configure the ignored|WiFi connecting|RFID session ready|Session unavailable|Snapshot pending)/.test(text)) return { type: 'unsupported_firmware' };
  if (!text.startsWith('{')) return null; // Never echo arbitrary serial text into logs.
  const frame = JSON.parse(text);
  if (frame.protocol_version !== 1 || frame.type !== 'snapshot' || typeof frame.boot_id !== 'string'
      || !/^[\w-]{1,40}$/.test(frame.boot_id) || !Number.isSafeInteger(frame.event_id) || frame.event_id < 1
      || ![1, 2, 3].includes(frame.reader_count) || !Array.isArray(frame.readers) || frame.readers.length !== frame.reader_count) throw new Error('invalid_frame');
  const readers = frame.readers.map(row => {
    if (!Number.isInteger(row.reader_id) || !['PRESENT', 'EMPTY', 'ERROR'].includes(row.status)
        || (row.status !== 'PRESENT' && row.uid != null)) throw new Error('invalid_reader');
    return { reader_id: row.reader_id, status: row.status, uid: row.status === 'PRESENT' ? normalizeUsbUid(row.uid) : null };
  }).sort((a, b) => a.reader_id - b.reader_id);
  if (!readers.every((row, index) => row.reader_id === index + 1)
      || new Set(readers.filter(row => row.uid).map(row => row.uid)).size !== readers.filter(row => row.uid).length) throw new Error('ambiguous_readers');
  return { ...frame, readers, protocol: 'jsonl' };
}

export class SerialLineBuffer {
  constructor() { this.text = ''; this.dropping = false; }
  push(text, onLine, onInvalid) {
    for (const char of text) {
      if (char === '\n') {
        if (!this.dropping) onLine(this.text.replace(/\r$/, ''));
        this.text = ''; this.dropping = false;
      } else if (!this.dropping) {
        this.text += char;
        if (this.text.length > 1024) { this.text = ''; this.dropping = true; onInvalid(); }
      }
    }
  }
}

export class UsbPresentationTracker {
  constructor() { this.boot = null; this.sequence = 0; this.previous = null; this.legacy = null; }
  accept(frame, now = Date.now()) {
    if (frame.type === 'scan') {
      if (this.legacy?.uid === frame.uid && now - this.legacy.at < 800) return null;
      this.legacy = { uid: frame.uid, at: now };
      return { mode: 'queue', rows: [{ reader_id: 1, status: 'PRESENT', uid: frame.uid }], reset: false };
    }
    if (frame.type !== 'snapshot') return null;
    const reset = this.boot !== null && this.boot !== frame.boot_id;
    if (this.boot === frame.boot_id && frame.event_id <= this.sequence) return null;
    if (this.boot !== frame.boot_id) this.previous = null;
    this.boot = frame.boot_id; this.sequence = frame.event_id;
    if (frame.reader_count === 1) {
      const row = frame.readers[0], changed = row.uid && row.uid !== this.previous;
      this.previous = row.uid;
      return { mode: 'queue', rows: changed ? [row] : [], reset, status: row.status };
    }
    return { mode: 'positions', rows: frame.readers, reset };
  }
}

export class UsbSerialConnection {
  constructor({ serial, onLine, onState, onInvalid }) {
    Object.assign(this, { serial, onLine, onState, onInvalid });
    this.generation = 0; this.disposed = false;
    this.unplug = event => { if (event.target === this.port || event.port === this.port) this.disconnect(); };
    serial?.addEventListener('disconnect', this.unplug);
  }
  async connect() {
    if (this.disposed || this.connecting || this.port) return;
    this.connecting = true;
    const generation = ++this.generation;
    this.onState('connecting');
    let port;
    let opening = false;
    try {
      port = await this.serial.requestPort(); // Keep this call within the user's click activation.
      if (this.disposed || generation !== this.generation) return;
      opening = true;
      await port.open({ baudRate: 115200 });
      if (this.disposed || generation !== this.generation) { await port.close(); return; }
      this.port = port;
      this.onState('connected');
      const reader = port.readable.getReader(); this.reader = reader;
      const decoder = new TextDecoder(), buffer = new SerialLineBuffer();
      this.loop = (async () => {
        try {
          while (!this.disposed && generation === this.generation) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer.push(decoder.decode(value, { stream: true }), line => {
              if (!this.disposed && generation === this.generation) this.onLine(line);
            }, this.onInvalid);
          }
        } catch { if (!this.disposed && generation === this.generation) this.onState('read_failed'); }
        finally {
          reader.releaseLock();
          if (this.reader === reader) this.reader = null;
        }
        if (generation === this.generation) await this.disconnect();
      })();
    } catch (error) {
      if (!this.disposed && generation === this.generation) {
        this.onState(error.name === 'NotFoundError' ? 'cancelled' : opening ? 'open_failed' : 'connect_failed');
      }
      if (this.port === port && port) {
        this.port = null;
        try { await port.close(); } catch { /* Failed or removed port. */ }
      }
    } finally { this.connecting = false; }
  }
  async disconnect() {
    ++this.generation;
    const port = this.port, reader = this.reader;
    this.port = null;
    if (reader) { try { await reader.cancel(); } catch { /* Already unplugged. */ } }
    // reader.cancel resolves read(); wait for releaseLock before closing the port.
    if (reader && this.loop) await this.loop;
    if (port) { try { await port.close(); } catch { /* Removed ports can already be closed. */ } }
    if (!this.disposed) this.onState('disconnected');
  }
  dispose() {
    this.disposed = true;
    this.serial?.removeEventListener('disconnect', this.unplug);
    return this.disconnect();
  }
}
