import { useEffect, useRef, useState } from 'react';
import { request } from './services/api';
import { parseUsbLine, UsbPresentationTracker, UsbSerialConnection } from './services/usbRfid';

const messages = {
  connected: 'USB 장치를 연결했습니다.', disconnected: 'USB 장치 연결이 해제됐습니다.',
  connect_failed: 'USB 연결 실패: Arduino 시리얼 모니터를 닫고 포트를 다시 선택해 주세요.',
  reader_ready: '카드 리더기가 응답합니다.', reader_error: '카드 리더기 오류: 전원과 배선을 확인해 주세요.',
  tag_read: 'RFID 카드를 읽었습니다.', unmapped: '등록되지 않았거나 사용할 수 없는 카드입니다. 보호자 화면에서 태그를 연결해 주세요.',
  invalid_frame: '장치 데이터 형식을 확인하지 못했습니다.', queue_full: '읽은 카드가 12장입니다. 적용하거나 비운 뒤 다시 읽어 주세요.',
  reset: '장치가 다시 시작돼 이전 읽기 목록을 비웠습니다.',
  unsupported_firmware: 'Wi-Fi용 출력입니다. USB 카드 인식에는 진단 스케치 또는 USB용 펌웨어를 사용해 주세요.',
};

export default function UsbRfidReader({ targetId, manager = false, canMap = false, cards = [], mappingVersion = 0, onUid, onAppend, onApply, disabled = false, registration = false, eventScope = 'personal', compact = false, artStyle = () => ({}), onStatus }) {
  const [state, setState] = useState('disconnected'), [logs, setLogs] = useState([]);
  const [resolved, setResolved] = useState([]), [mode, setMode] = useState('queue');
  const [protocol, setProtocol] = useState(''), [pending, setPending] = useState(false), [unsafe, setUnsafe] = useState(true);
  const [error, setError] = useState(''), [granted, setGranted] = useState(0), [fresh, setFresh] = useState(false);
  const session = useRef(null), handlers = useRef(null);
  const token = localStorage.getItem('pesc-mate-token');
  const available = typeof navigator !== 'undefined' && !!navigator.serial && window.isSecureContext;
  handlers.current = { onUid, onAppend, onApply };

  useEffect(() => {
    let disposed = false, entries = [], revision = 0, currentMode = 'queue', tracker = new UsbPresentationTracker();
    let lastActivity = 0, lastReaderState = '', previousVersion = '', resolvePending = false, needsResolve = false;
    const throttled = new Map();
    const current = () => !disposed && token && localStorage.getItem('pesc-mate-token') === token;
    const query = `?user_id=${encodeURIComponent(targetId)}`;
    setResolved([]); setLogs([]); setError(''); setState('disconnected'); setUnsafe(true); setFresh(false); setPending(false); setProtocol('');
    function log(action) {
      if (!current()) return;
      const now = Date.now();
      if (!['connected', 'disconnected', 'connect_failed'].includes(action)
          && now - (throttled.get(action) || 0) < 3000) return;
      throttled.set(action, now);
      setLogs(rows => [...rows.slice(-39), { at: new Date().toLocaleTimeString(), message: messages[action] }]);
      const eventPath = eventScope === 'shared' ? '/rfid/admin/usb/events' : '/rfid/usb/events' + query;
      if (navigator.onLine) request(eventPath, { method: 'POST', body: JSON.stringify({ action }),
        headers: { Authorization: `Bearer ${token}` } }).catch(() => {}); // Logs never block basic speech.
    }
    async function resolve() {
      if (!current()) return;
      if (resolvePending) { ++revision; needsResolve = true; setResolved([]); setPending(true); return; }
      const sequence = ++revision, reading = [...entries];
      setResolved([]); setPending(true); setError('');
      const present = reading.filter(row => row.uid);
      resolvePending = true;
      try {
        const results = present.length ? await request('/rfid/usb/resolve' + query, { method: 'POST',
          body: JSON.stringify({ uids: present.map(row => row.uid) }), headers: { Authorization: `Bearer ${token}` } }) : [];
        if (!current() || sequence !== revision) return;
        let index = 0;
        const mapped = reading.map(row => row.uid ? { ...row, ...results[index++] } : row);
        if (mapped.some(row => ['UNMAPPED', 'UNAVAILABLE'].includes(row.status))) log('unmapped');
        setResolved(mapped);
      } catch { if (current() && sequence === revision) setError('태그 연결을 조회하지 못했습니다. 연결 복구 후 다시 조회해 주세요.'); }
      finally {
        resolvePending = false;
        if (current() && needsResolve) { needsResolve = false; resolve(); }
        else if (current() && sequence === revision) setPending(false);
      }
    }
    function clear() { entries = []; ++revision; needsResolve = false; setResolved([]); setError(''); setPending(false); }
    function onLine(line) {
      if (!current()) return;
      let frame;
      try { frame = parseUsbLine(line); } catch { setUnsafe(true); log('invalid_frame'); return; }
      if (!frame) return;
      lastActivity = Date.now(); setFresh(true);
      if (frame.type === 'version') {
        if (frame.version !== previousVersion) {
          previousVersion = frame.version;
          setLogs(rows => [...rows.slice(-39), { at: new Date().toLocaleTimeString(), message: `리더기 버전: 0x${frame.version}` }]);
        }
        return;
      }
      if (['reader_ready', 'reader_error', 'unsupported_firmware'].includes(frame.type)) {
        if (frame.type !== lastReaderState) log(frame.type);
        lastReaderState = frame.type;
        if (frame.type !== 'reader_ready') setUnsafe(true);
        return;
      }
      const accepted = tracker.accept(frame);
      if (!accepted) return;
      setProtocol(frame.protocol);
      if (accepted.reset || accepted.mode !== currentMode) { clear(); if (accepted.reset) log('reset'); }
      currentMode = accepted.mode; setMode(currentMode);
      if (accepted.status === 'ERROR' || accepted.rows.some(row => row.status === 'ERROR')) {
        setUnsafe(true); log('reader_error');
      } else setUnsafe(false);
      if (registration) {
        const chips = accepted.rows.filter(row => row.uid);
        if (chips.length > 1) { setError('등록할 칩은 한 번에 하나만 리더기에 올려 주세요.'); return; }
        if (chips.length === 1) { setError(''); log('tag_read'); handlers.current.onUid?.(chips[0].uid); }
        return; // Registration never fills a sentence queue or calls a child's mapping lookup.
      }
      if (currentMode === 'queue') {
        if (!accepted.rows.length) return;
        if (entries.length >= 12) { log('queue_full'); return; }
        entries = [...entries, ...accepted.rows].slice(0, 12);
      } else {
        const changed = JSON.stringify(entries) !== JSON.stringify(accepted.rows);
        entries = accepted.rows;
        if (!changed) return;
      }
      const last = accepted.rows.filter(row => row.uid).at(-1);
      if (last) { log('tag_read'); if (manager && canMap) handlers.current.onUid?.(last.uid); }
      resolve();
    }
    const connection = available ? new UsbSerialConnection({ serial: navigator.serial, onLine,
      onInvalid: () => { if (current()) { setUnsafe(true); log('invalid_frame'); } },
      onState: next => {
        if (!current()) return;
        if (next === 'connected') { clear(); tracker = new UsbPresentationTracker(); lastActivity = Date.now(); setFresh(true); setProtocol(''); discover(); }
        if (next !== 'connected') { setUnsafe(true); setFresh(false); }
        setState(next === 'read_failed' ? 'disconnected' : next === 'cancelled' ? 'disconnected' : next);
        if (messages[next]) log(next);
        if (next === 'read_failed') log('reader_error');
      } }) : null;
    session.current = { connection, clear, refresh: resolve };
    const serial = navigator.serial;
    async function discover() {
      try { const ports = await serial?.getPorts(); if (current()) setGranted(ports?.length || 0); } catch { if (current()) setGranted(0); }
    }
    discover(); serial?.addEventListener('connect', discover); serial?.addEventListener('disconnect', discover);
    const timer = setInterval(() => { if (current()) setFresh(lastActivity > 0 && Date.now() - lastActivity < 20000); }, 1000);
    return () => {
      disposed = true; ++revision; clearInterval(timer);
      serial?.removeEventListener('connect', discover); serial?.removeEventListener('disconnect', discover);
      connection?.dispose(); session.current = null;
    };
  }, [targetId, token, manager, canMap, available, registration, eventScope]);

  useEffect(() => { if (mappingVersion) session.current?.refresh(); }, [mappingVersion]);
  useEffect(() => { onStatus?.({ state, fresh, count: resolved.length }); }, [state, fresh, resolved, onStatus]);
  const selection = resolved.filter(row => row.status === 'PRESENT').map(row => cards.find(card => card.id === row.card_id));
  const valid = state === 'connected' && fresh && !unsafe && !pending && !error && resolved.length > 0
    && resolved.every(row => ['PRESENT', 'EMPTY'].includes(row.status)) && selection.every(Boolean);
  function apply() {
    if (!valid || disabled) return;
    const callback = mode === 'positions' ? handlers.current.onApply : handlers.current.onAppend;
    if (callback?.(selection) === true && mode === 'queue') session.current?.clear();
  }

  return <section className="usb-rfid" aria-label="USB 카드 리더기">
    <h3>USB 카드 리더기</h3>
    {!available ? <p role="status">USB 연결은 PC의 Chrome/Edge에서 http://127.0.0.1:5173 또는 HTTPS로 열어 주세요.</p> : <>
      <p role="status">{state === 'connected' ? fresh ? 'USB 연결됨' : 'USB 장치 응답을 기다립니다.' : state === 'connecting' ? 'USB 포트를 여는 중입니다.' : 'USB 연결 버튼을 눌러 Arduino 포트를 선택해 주세요.'}</p>
      {!compact && <p>브라우저가 허용받아 감지한 포트: {granted}개 · 115200bps</p>}
      <button type="button" disabled={state === 'connected' || state === 'connecting'} onClick={() => session.current?.connection?.connect()}>USB 장치 연결</button>
      <button type="button" disabled={!['connected', 'connecting'].includes(state)} onClick={() => session.current?.connection?.disconnect()}>USB 연결 해제</button>
    </>}
    {!compact && protocol === 'legacy' && <p>{registration ? '진단 스케치에서 칩 UID를 읽고 있습니다.' : '진단 스케치에서 카드를 순서대로 모읍니다. 카드 유지·제거 판별은 USB용 펌웨어에서 지원합니다.'}</p>}
    {error && <p role="alert">{error}</p>}
    {pending && <p role="status">읽은 카드 연결을 조회하고 있어요.</p>}
    {!!resolved.length && <ol className="usb-card-list" aria-label={mode === 'positions' ? 'USB 위치별 카드' : 'USB로 읽은 카드'}>{resolved.map((row, index) => {
      const card = cards.find(item => item.id === row.card_id);
      return <li key={index} data-state={row.status}>
        <small>{mode === 'positions' ? `위치 ${row.reader_id}` : `${index + 1}번째 카드`}</small>
        {card && <span className="usb-card-art" aria-hidden="true" style={artStyle(card)} />}
        <strong>{row.label || (row.status === 'EMPTY' ? '카드 없음' : row.status === 'ERROR' ? '리더기 오류' : '미등록·사용 불가 카드')}</strong>
      </li>;
    })}</ol>}
    {!manager && !registration && <button type="button" disabled={disabled || !valid} onClick={apply}>{mode === 'positions' ? 'USB 배열을 문장에 적용' : '읽은 카드를 문장에 추가'}</button>}
    {!registration && <><button type="button" disabled={pending} onClick={() => session.current?.refresh()}>USB 태그 연결 다시 조회</button>
      <button type="button" onClick={() => session.current?.clear()}>USB 읽기 목록 비우기</button></>}
    {manager && canMap && <p>{registration ? '등록할 칩을 하나만 대고 연결할 그림카드를 선택해 주세요.' : '카드를 대면 아래 태그 등록 입력란에 UID가 들어갑니다.'}</p>}
    <details open={!compact}><summary>{compact ? '연결 정보·장치 로그' : '장치 로그'}</summary>
      {compact && <><p>브라우저가 허용받아 감지한 포트: {granted}개 · 115200bps</p>
        {protocol === 'legacy' && <p>진단 스케치에서 카드를 순서대로 모읍니다. 카드 유지·제거 판별은 USB용 펌웨어에서 지원합니다.</p>}</>}
      <ol aria-label="USB 장치 로그">{logs.map((row, index) => <li key={index}><time>{row.at}</time> {row.message}</li>)}</ol>
    </details>
  </section>;
}
