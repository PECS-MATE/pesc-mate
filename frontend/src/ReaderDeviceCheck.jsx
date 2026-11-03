import { useEffect, useRef, useState } from 'react';
import { parseUsbLine, UsbSerialConnection } from './services/usbRfid';
import IconButton from './IconButton';
import './assets/readerDeviceCheck.css';

const empty = () => [1, 2, 3].map(reader_id => ({ reader_id, status: 'UNKNOWN' }));
const labels = { OK: '정상', ERROR: '비정상', UNKNOWN: '확인 안 됨', STALE: '재확인 필요' };

export default function ReaderDeviceCheck({ disabled = false }) {
  const [state, setState] = useState('disconnected'), [rows, setRows] = useState(empty);
  const [checking, setChecking] = useState(false), [message, setMessage] = useState('');
  const connection = useRef(null), pending = useRef(null), timeout = useRef(null), checkedAt = useRef(0), counter = useRef(0);
  const token = localStorage.getItem('pesc-mate-token');
  const available = !!navigator.serial && window.isSecureContext;
  useEffect(() => {
    let live = true;
    const current = () => live && token === localStorage.getItem('pesc-mate-token');
    function reset() {
      pending.current = null; checkedAt.current = 0; clearTimeout(timeout.current);
      setChecking(false); setRows(empty());
    }
    const serial = available ? new UsbSerialConnection({ serial: navigator.serial,
      onState: next => {
        if (!current()) return;
        reset(); setState(next === 'connected' || next === 'connecting' ? next : 'disconnected');
        setMessage(['open_failed', 'connect_failed', 'read_failed'].includes(next)
          ? 'USB 연결을 확인해 주세요. 시리얼 모니터와 다른 탭의 연결을 닫고 다시 시도해 주세요.' : '');
      },
      onInvalid: () => { if (current() && pending.current) { reset(); setMessage('장치 응답 형식을 확인해 주세요.'); } },
      onLine: line => {
        if (!current() || !pending.current) return;
        let frame;
        try {
          if (!line.trim().startsWith('{') || JSON.parse(line).type !== 'diagnostics') return;
          frame = parseUsbLine(line);
        } catch { reset(); setMessage('장치 응답 형식을 확인해 주세요.'); return; }
        if (frame?.type !== 'diagnostics' || frame.request_id !== pending.current) return;
        pending.current = null; clearTimeout(timeout.current); setChecking(false); checkedAt.current = Date.now();
        setRows(empty().map(row => frame.readers.find(item => item.reader_id === row.reader_id) || row));
        setMessage(frame.reader_count !== 3 ? `장치가 리더기 ${frame.reader_count}개만 보고했습니다. 펌웨어의 리더기 개수를 확인해 주세요.` : '');
      } }) : null;
    connection.current = serial;
    const timer = setInterval(() => {
      if (current() && checkedAt.current && Date.now() - checkedAt.current >= 20000) {
        checkedAt.current = 0; setRows(previous => previous.map(row => ({ ...row, status: 'STALE' })));
      }
    }, 1000);
    return () => { live = false; clearTimeout(timeout.current); clearInterval(timer); pending.current = null; serial?.dispose(); connection.current = null; };
  }, [available, token]);
  async function check() {
    if (state !== 'connected' || checking || disabled) return;
    const id = `${Date.now()}-${++counter.current}`;
    pending.current = id; checkedAt.current = 0; setRows(empty()); setChecking(true); setMessage('');
    timeout.current = setTimeout(() => {
      if (pending.current !== id) return;
      pending.current = null; setChecking(false);
      setMessage('응답이 없습니다. 전원·배선과 USB용 펌웨어 업로드를 확인한 뒤 다시 눌러 주세요.');
    }, 8000);
    try { await connection.current.requestDiagnostics(id); }
    catch { if (pending.current === id) { pending.current = null; clearTimeout(timeout.current); setChecking(false); setMessage('상태 확인 요청을 보내지 못했습니다. USB를 다시 연결해 주세요.'); } }
  }
  return <section className="reader-device-check" aria-label="장치 연결 확인">
    <header><h2>기기 연결</h2><span role="status">{state === 'connected' ? 'USB 연결됨' : state === 'connecting' ? '연결 중' : '연결 안 됨'}</span></header>
    {!available ? <p role="status">USB 연결은 지원되는 PC 브라우저에서 사용해 주세요.</p> : <div className="reader-check-actions">
      <button type="button" className="primary" disabled={disabled || state !== 'disconnected'} onClick={() => connection.current?.connect()}>기기 연결</button>
      <button type="button" disabled={disabled || state !== 'connected' || checking} aria-busy={checking} onClick={check}>{checking ? '확인 중…' : '장치 상태 확인'}</button>
      <IconButton icon="logout" label="USB 연결 해제" disabled={state === 'disconnected'} onClick={() => connection.current?.disconnect()} />
    </div>}
    <ol className="reader-check-lights" aria-label="리더기별 응답 상태" aria-live="polite">{rows.map(row => <li key={row.reader_id}>
      <strong>리더기 {row.reader_id}</strong><span className={`reader-check-light state-${row.status.toLowerCase()}`} aria-hidden="true" />
      <span>{checking ? '확인 중' : labels[row.status]}</span>
    </li>)}</ol>
    {message && <p role="status">{message}</p>}
  </section>;
}
