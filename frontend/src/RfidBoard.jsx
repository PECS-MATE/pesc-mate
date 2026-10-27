import { useEffect, useRef, useState } from 'react';
import { request } from './services/api';
import { rfidFingerprint, rfidSelection } from './services/rfidBoard';
import UsbRfidReader from './UsbRfidReader';

const statusText = { EMPTY: '카드 없음', ERROR: '리더기 오류', STALE: '새 상태를 기다려 주세요',
  UNMAPPED: '등록되지 않은 카드', UNAVAILABLE: '사용할 수 없는 카드', PRESENT: '카드 인식' };

export default function RfidBoard({ targetId, manager = false, canMap = false, cards = [], artStyle = () => ({}), onApply, onAppend, disabled = false }) {
  const [open, setOpen] = useState(manager);
  const [devices, setDevices] = useState([]), [deviceId, setDeviceId] = useState('');
  const [snapshot, setSnapshot] = useState(null), [bindings, setBindings] = useState([]), [choices, setChoices] = useState([]);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  const [secret, setSecret] = useState(''), [uid, setUid] = useState(''), [cardId, setCardId] = useState('');
  const [newId, setNewId] = useState('pecsmate-01'), [newName, setNewName] = useState('실물 카드판');
  const [name, setName] = useState(''), [labels, setLabels] = useState(['', '', '']);
  const [applied, setApplied] = useState('');
  const [pollVersion, setPollVersion] = useState(0);
  const epoch = useRef(0);
  const token = localStorage.getItem('pesc-mate-token');
  const query = `?user_id=${encodeURIComponent(targetId)}`;
  const sameSession = sequence => epoch.current === sequence && token
    && localStorage.getItem('pesc-mate-token') === token;
  const current = sequence => sameSession(sequence) && navigator.onLine;
  const selected = devices.find(item => item.device_id === deviceId);

  useEffect(() => {
    epoch.current += 1;
    setDevices([]); setDeviceId(''); setSnapshot(null); setBindings([]); setChoices([]); setSecret(''); setApplied('');
    setBusy(false); setError(''); setNotice('');
    return () => { epoch.current += 1; };
  }, [targetId, token, manager, canMap]);

  async function reload() {
    const sequence = epoch.current;
    setBusy(true); setError('');
    try {
      const [rows, saved, mappingCards] = await Promise.all([
        request(`/rfid/devices${query}`),
        manager && canMap ? request(`/rfid/bindings${query}`) : [],
        manager && canMap ? request(`/rfid/cards${query}`) : [],
      ]);
      if (current(sequence)) { setDevices(rows); setBindings(saved); setChoices(mappingCards); }
    } catch (failure) { if (current(sequence)) { setError(failure.message); setSnapshot(null); } }
    finally { if (sameSession(sequence)) setBusy(false); }
  }
  useEffect(() => { if (open) reload(); }, [open, targetId, token, manager, canMap]);
  useEffect(() => {
    if (selected) { setName(selected.name); setLabels(selected.reader_labels); }
  }, [deviceId, selected?.revision]);

  useEffect(() => {
    setSnapshot(null); setApplied('');
    if (!open || !deviceId) return;
    let disposed = false, timer, inFlight = false;
    const sequence = epoch.current;
    const alive = () => !disposed && current(sequence) && document.visibilityState !== 'hidden';
    async function poll() {
      clearTimeout(timer);
      if (!alive() || inFlight) return;
      inFlight = true;
      try {
        const state = await request(`/rfid/devices/${encodeURIComponent(deviceId)}/state${query}`);
        if (alive()) { setSnapshot(state); setError(''); }
      } catch (failure) { if (alive()) { setSnapshot(null); setError(failure.message); } }
      finally { inFlight = false; if (alive()) timer = setTimeout(poll, 1000); }
    }
    function visibility() { setSnapshot(null); clearTimeout(timer); if (alive()) poll(); }
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('offline', visibility); window.addEventListener('online', visibility);
    poll();
    return () => { disposed = true; clearTimeout(timer); document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('offline', visibility); window.removeEventListener('online', visibility); };
  }, [open, deviceId, targetId, token, canMap, pollVersion]);

  async function mutate(path, method, body, onSuccess) {
    const sequence = epoch.current;
    setBusy(true); setError(''); setNotice(''); setSnapshot(null);
    try {
      const result = await request(path + query, { method, body: JSON.stringify(body) });
      if (current(sequence)) { onSuccess?.(result); setNotice('변경 내용을 저장했습니다.'); await reload(); }
    } catch (failure) { if (current(sequence)) setError(failure.message + ' 최신 상태를 확인한 뒤 다시 시도해 주세요.'); }
    finally { if (sameSession(sequence)) { setBusy(false); setPollVersion(value => value + 1); } }
  }
  function editDevice(operation) {
    if (!selected) return;
    if (operation !== 'configure' && !window.confirm(operation === 'revoke' ? '장치 수신을 중단할까요?' : '이전 장치 키를 폐기하고 새 키를 만들까요?')) return;
    setSecret('');
    mutate(`/rfid/devices/${encodeURIComponent(deviceId)}`, 'PUT', { operation, expected_revision: selected.revision,
      ...(operation === 'configure' ? { name, reader_labels: labels } : {}) }, result => setSecret(result.device_key || ''));
  }
  function saveBinding(event) {
    event.preventDefault();
    const normalized = uid.replace(/[\s:-]/g, '').toUpperCase();
    const existing = bindings.find(item => item.uid === normalized);
    if (existing && existing.card_id !== cardId && !window.confirm('기존 태그 연결을 선택한 카드로 교체할까요?')) return;
    mutate('/rfid/bindings', 'PUT', { uid: normalized, card_id: cardId, expected_revision: existing?.revision ?? null });
  }
  const selection = rfidSelection(snapshot, cards);
  const fingerprint = rfidFingerprint(snapshot);

  return <section className="rfid-panel" aria-label="RFID 실물 카드판">
    <h2>RFID 실물 카드판</h2>
    <UsbRfidReader targetId={targetId} manager={manager} canMap={canMap} cards={cards} disabled={disabled}
      mappingVersion={pollVersion} onUid={setUid} onApply={onApply} onAppend={onAppend} />
    {!open ? <button type="button" onClick={() => setOpen(true)}>RFID 상태 열기</button> : <>
      <p>리더기 1 → 2 → 3 순서입니다. 상태는 자동 갱신하지만 현재 문장은 직접 적용하기 전까지 바뀌지 않아요.</p>
      <button type="button" onClick={() => { setOpen(false); setSecret(''); }}>RFID 상태 닫기</button>
      <button type="button" disabled={busy} onClick={reload}>장치·등록 목록 새로고침</button>
      {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
      <label>RFID 장치<select value={deviceId} onChange={event => { setDeviceId(event.target.value); setSecret(''); }}>
        <option value="">장치를 선택해 주세요</option>
        {devices.map(item => <option key={item.device_id} value={item.device_id}>{item.name} ({item.device_id}){item.active ? '' : ' · 비활성'}</option>)}
      </select></label>
      {deviceId && <>
        <p role="status">{snapshot?.online ? '리더기 상태 수신 중' : '연결이 없거나 오래된 상태입니다. 기존 문장은 유지됩니다.'}</p>
        <ol className="rfid-readers" aria-label="리더기 위치별 카드">
          {(snapshot?.readers || [1, 2, 3].map(reader_id => ({ reader_id, status: 'STALE' }))).map(row => {
            const picture = cards.find(card => card.id === row.card_id);
            return <li key={row.reader_id}><strong>{row.name || `위치 ${row.reader_id}`}</strong>
              {picture && <span className="learning-option-art" aria-hidden="true" style={artStyle(picture)} />}
              <p>{row.label || statusText[row.status]}</p>
              {manager && canMap && row.uid && <><code>{row.uid}</code>
                <button type="button" onClick={() => setUid(row.uid)}>이 태그 등록하기</button></>}
            </li>;
          })}
        </ol>
        {!manager && <><button type="button" className="primary" disabled={disabled || busy || selection === null}
          onClick={() => { if (onApply?.(selection) !== false) setApplied(fingerprint); }}>현재 RFID 배열을 문장에 적용</button>
          {applied && applied !== fingerprint && <p role="status">리더기 내용이 달라졌어요. 필요하면 다시 적용해 주세요.</p>}
          <small>미등록·오류·끊긴 상태는 적용하지 않습니다. 적용 뒤 기존 문장 만들기·내용 확인·읽기를 사용하세요.</small></>}
      </>}
      {manager && <>
        <form onSubmit={event => { event.preventDefault(); setSecret(''); mutate('/rfid/devices', 'POST', { device_id: newId, name: newName }, result => { setDeviceId(result.device_id); setSecret(result.device_key); }); }}>
          <h3>장치 등록</h3><label>장치 ID<input required maxLength="64" pattern="[A-Za-z0-9][A-Za-z0-9_-]*" value={newId} onChange={e => setNewId(e.target.value)} /></label>
          <label>장치 이름<input required maxLength="40" value={newName} onChange={e => setNewName(e.target.value)} /></label>
          <button disabled={busy}>장치 등록하기</button>
        </form>
        {secret && <div role="status"><p>장치 키는 지금 한 번만 표시합니다. Arduino의 로컬 비밀 설정에 보관하고 Git에 올리지 마세요.</p>
          <code className="rfid-secret">{secret}</code><button type="button" onClick={() => setSecret('')}>키 숨기기</button></div>}
        {selected && <fieldset disabled={busy}><legend>장치와 위치 설정</legend>
          <label>표시 이름<input maxLength="40" value={name} onChange={e => setName(e.target.value)} /></label>
          {labels.map((value, index) => <label key={index}>리더기 {index + 1} 이름<input maxLength="30" value={value}
            onChange={event => setLabels(items => items.map((item, position) => position === index ? event.target.value : item))} /></label>)}
          <button type="button" onClick={() => editDevice('configure')}>장치 설정 저장</button>
          <button type="button" onClick={() => editDevice('rotate_key')}>키 재발급·활성화</button>
          <button type="button" onClick={() => editDevice('revoke')}>장치 비활성화</button>
        </fieldset>}
        {canMap && <><form onSubmit={saveBinding}><h3>RFID 태그와 그림카드 연결</h3>
          <label>태그 UID<input required maxLength="64" value={uid} onChange={e => setUid(e.target.value)} /></label>
          <label>연결할 그림카드<select required value={cardId} onChange={e => setCardId(e.target.value)}><option value="">카드를 선택해 주세요</option>
            {choices.map(card => <option key={card.id} value={card.id}>{card.label}</option>)}
          </select></label><button disabled={busy || !uid || !cardId}>태그 연결 저장</button>
        </form><ul aria-label="등록된 RFID 태그">{bindings.map(item => <li key={item.uid}>
          <code>{item.uid}</code> → {choices.find(card => card.id === item.card_id)?.label || '사용 불가 카드'}
          <button type="button" disabled={busy} onClick={() => { if (window.confirm('이 태그 연결을 해제할까요?')) mutate('/rfid/bindings', 'PUT', { uid: item.uid, card_id: null, expected_revision: item.revision }); }}>연결 해제</button>
        </li>)}</ul></>}
      </>}
    </>}
  </section>;
}
